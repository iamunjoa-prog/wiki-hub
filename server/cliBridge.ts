import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, type Plugin } from 'vite'
import { readGeminiKey } from './env.js'
import { askGemini, editGemini } from './gemini.js'
import {
  type AskInput,
  buildAskRequest,
  buildDocsBlock,
  buildEditRequest,
  checkEditReply,
  EDIT_SCHEMA,
  parseAskInput,
  parseEditInput,
  REPLY_SCHEMA,
  type CliReply,
  type EditInput,
  type EditReply,
} from './knowledge.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * 로컬 개발 전용 — 브라우저의 /api/* 요청을 내 PC에 로그인된 CLI(Claude Code 또는 Codex)로 넘긴다.
 * 배포본(Vercel)에는 이 경로가 없으므로 프론트엔드가 규칙 기반 답변으로 대체한다.
 */

export type Engine = 'claude' | 'codex'

const ROOT = resolve(__dirname, '..')
const KNOWLEDGE_DIR = resolve(ROOT, '지식')
const PROMPT_FILE = resolve(__dirname, 'assistant-prompt.md')
const EDIT_PROMPT_FILE = resolve(__dirname, 'edit-prompt.md')

const TIMEOUT_MS: Record<Engine, number> = { claude: 120_000, codex: 180_000 }
/** 문서 편집은 본문 전체를 다시 써서 돌려주므로 답변보다 오래 걸린다 */
const EDIT_TIMEOUT_MS: Record<Engine, number> = { claude: 240_000, codex: 300_000 }

/** Windows의 npm 셸 래퍼(claude.cmd, codex.cmd)는 cmd.exe를 거쳐야 실행되므로 인자 속 따옴표를 이스케이프한다. */
const IS_WIN = process.platform === 'win32'
const quote = (arg: string) => (IS_WIN ? `"${arg.replace(/"/g, '\\"')}"` : arg)

function isInstalled(cmd: Engine): boolean {
  return spawnSync(IS_WIN ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0
}

export interface EngineStatus {
  installed: boolean
  loggedIn: boolean
}

const ENGINES: Engine[] = ['claude', 'codex']

/** 각 CLI의 status 명령으로 로그인 여부를 확인한다. 오류·시간 초과는 미로그인으로 본다. */
function checkLogin(engine: Engine): Promise<boolean> {
  const args = engine === 'claude' ? ['auth', 'status'] : ['login', 'status']
  return new Promise((done) => {
    const child = spawn(engine, args, { shell: IS_WIN, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      done(false)
    }, 15_000)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', () => {
      clearTimeout(timer)
      done(false)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (engine === 'claude') {
        try {
          done(JSON.parse(out).loggedIn === true)
        } catch {
          done(false)
        }
      } else {
        // codex는 "Logged in using ..." / "Not logged in" 을 출력한다
        done(code === 0 && /logged in/i.test(out) && !/not logged in/i.test(out))
      }
    })
  })
}

async function getEngineStatus(): Promise<Record<Engine, EngineStatus>> {
  const entries = await Promise.all(
    ENGINES.map(async (e) => {
      const installed = isInstalled(e)
      return [e, { installed, loggedIn: installed && (await checkLogin(e)) }] as const
    }),
  )
  return Object.fromEntries(entries) as Record<Engine, EngineStatus>
}

const LOGIN_ARGS: Record<Engine, string[]> = { claude: ['claude', 'auth', 'login'], codex: ['codex', 'login'] }

/** 로그인은 브라우저 OAuth를 거치므로 페이지 안에서 처리할 수 없다 — 이 PC에 로그인용 터미널 창을 띄운다. */
function openLoginTerminal(engine: Engine): boolean {
  const args = LOGIN_ARGS[engine]
  if (IS_WIN) {
    spawn('cmd.exe', ['/c', 'start', 'CLI login', 'cmd', '/k', ...args], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
  if (process.platform === 'darwin') {
    spawn('osascript', ['-e', `tell application "Terminal" to do script "${args.join(' ')}"`], {
      detached: true,
      stdio: 'ignore',
    }).unref()
    return true
  }
  return false
}

/** CLI를 실행하고 stdout을 돌려준다. 한글 입력은 인자 대신 stdin으로 넘겨 셸 인코딩·줄바꿈 문제를 피한다. */
function run(engine: Engine, args: string[], stdin: string, cwd: string, timeoutMs = TIMEOUT_MS[engine]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(engine, args.map(quote), { cwd, shell: IS_WIN })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${engine} CLI 응답이 ${timeoutMs / 1000}초를 넘었습니다`))
    }, timeoutMs)

    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolvePromise(stdout)
      else reject(new Error(`${engine} CLI 오류 (exit ${code})\n${stderr.slice(-800)}`))
    })
    child.stdin.end(stdin)
  })
}

/** claude -p 를 JSON 스키마 모드로 실행한다. 도구는 읽기 전용(Read·Grep·Glob)만 열어 파일을 고치지 못하게 한다. */
async function claudeJson(input: string, promptArgs: string[], schema: object, timeoutMs?: number): Promise<unknown> {
  const stdout = await run(
    'claude',
    [
      '-p',
      '--output-format', 'json',
      '--no-session-persistence',
      '--tools', 'Read,Grep,Glob',
      ...promptArgs,
      '--json-schema', JSON.stringify(schema),
    ],
    input,
    KNOWLEDGE_DIR,
    timeoutMs,
  )
  const out = JSON.parse(stdout)
  if (out.is_error || !out.structured_output) throw new Error(out.result || 'claude CLI가 구조화된 응답을 주지 않았습니다')
  return out.structured_output
}

/**
 * Codex는 Windows 샌드박스가 셸 실행을 막는 환경이 있어(CreateProcessWithLogonW 1385) 문서를 직접 못 읽는다.
 * 샌드박스를 끄는 대신 필요한 문서를 프롬프트에 넣고 read-only 샌드박스를 유지한다.
 */
async function codexJson(prompt: string, schema: object, timeoutMs?: number): Promise<unknown> {
  const work = mkdtempSync(join(tmpdir(), 'wiki-codex-'))
  try {
    const schemaFile = join(work, 'schema.json')
    const lastMessageFile = join(work, 'last.json')
    writeFileSync(schemaFile, JSON.stringify(schema))
    await run(
      'codex',
      [
        'exec',
        '--skip-git-repo-check',
        '--ephemeral',
        '--sandbox', 'read-only',
        '--color', 'never',
        '--output-schema', schemaFile,
        '--output-last-message', lastMessageFile,
        '-',
      ],
      prompt,
      KNOWLEDGE_DIR,
      timeoutMs,
    )
    return JSON.parse(readFileSync(lastMessageFile, 'utf8'))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const askClaude = async (input: AskInput) =>
  (await claudeJson(
    buildAskRequest(input),
    [
      '--system-prompt-file', PROMPT_FILE,
      '--append-system-prompt', '작업 디렉터리가 위키 문서 폴더다. Grep·Glob·Read 도구로 문서를 찾아 읽어라.',
    ],
    REPLY_SCHEMA,
  )) as CliReply

/** 위키 문서 전체(약 100KB)를 프롬프트에 넣는다 */
const askCodex = async (input: AskInput) =>
  (await codexJson(
    [
      readFileSync(PROMPT_FILE, 'utf8'),
      '위키 문서 전체가 아래 <documents>에 들어 있다. 명령이나 도구를 실행하지 말고 이 문서만 읽고 답하라.',
      `<documents>\n${buildDocsBlock(KNOWLEDGE_DIR)}\n</documents>`,
      buildAskRequest(input),
    ].join('\n\n'),
    REPLY_SCHEMA,
  )) as CliReply

const ASK: Record<Engine, (input: AskInput) => Promise<CliReply>> = { claude: askClaude, codex: askCodex }

const editClaude = async (input: EditInput) =>
  checkEditReply(
    await claudeJson(
      buildEditRequest(input),
      [
        '--system-prompt-file', EDIT_PROMPT_FILE,
        '--append-system-prompt', '작업 디렉터리가 위키 문서 폴더다. 다른 문서를 참고해야 하면 Grep·Glob·Read로 찾아 읽어라.',
      ],
      EDIT_SCHEMA,
      EDIT_TIMEOUT_MS.claude,
    ),
  )

/** 편집할 문서 본문만 프롬프트에 넣는다 */
const editCodex = async (input: EditInput) =>
  checkEditReply(
    await codexJson(
      [
        readFileSync(EDIT_PROMPT_FILE, 'utf8'),
        '명령이나 도구를 실행하지 말고 아래 문서와 수정 요청만 보고 고쳐라.',
        buildEditRequest(input),
      ].join('\n\n'),
      EDIT_SCHEMA,
      EDIT_TIMEOUT_MS.codex,
    ),
  )

const EDIT: Record<Engine, (input: EditInput) => Promise<EditReply>> = { claude: editClaude, codex: editCodex }

export function cliBridge(): Plugin {
  return {
    name: 'cli-bridge',
    apply: 'serve',
    configureServer(server) {
      const log = server.config.logger
      // CLI가 없거나 실패할 때 쓰는 Gemini API 키 — 허브 폴더의 .env.local 에서 읽는다 (브라우저로는 보내지 않음)
      const env = loadEnv(server.config.mode, server.config.root, '')
      const geminiKey = readGeminiKey(env) || readGeminiKey()
      const geminiModel = env.GEMINI_MODEL || process.env.GEMINI_MODEL
      const installed: Record<Engine, boolean> = { claude: isInstalled('claude'), codex: isInstalled('codex') }
      getEngineStatus().then((s) => {
        const mark = (e: Engine) => (!s[e].installed ? '✗ 미설치' : s[e].loggedIn ? '✓' : '⚠ 로그인 필요')
        log.info(
          `[cli-bridge] claude ${mark('claude')} · codex ${mark('codex')} · gemini ${geminiKey ? '✓ API 키' : '✗ 키 없음'}`,
        )
      })

      server.middlewares.use('/api/engines', async (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        const status = await getEngineStatus()
        for (const e of ENGINES) installed[e] = status[e].installed
        const gemini = Boolean(geminiKey)
        res.end(JSON.stringify({ ...status, gemini: { installed: gemini, loggedIn: gemini } }))
      })

      server.middlewares.use('/api/login', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          const { engine } = JSON.parse(body || '{}') as { engine?: Engine }
          if (!engine || !ENGINES.includes(engine) || !installed[engine]) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: '설치된 CLI가 아닙니다' }))
            return
          }
          const opened = openLoginTerminal(engine)
          log.info(`[cli-bridge] ${engine} 로그인 창 ${opened ? '열림' : '열 수 없음'}`)
          res.end(JSON.stringify({ opened, command: LOGIN_ARGS[engine].join(' ') }))
        })
      })

      server.middlewares.use('/api/ask', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          try {
            const raw = JSON.parse(body) as { engine?: Engine | 'gemini' }
            const engine = raw.engine ?? 'claude'
            const input = parseAskInput(raw)
            const started = Date.now()
            let reply: CliReply
            if (engine === 'gemini') {
              if (!geminiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다 (.env.local)')
              reply = await askGemini(input, {
                apiKey: geminiKey,
                model: geminiModel,
                knowledgeDir: KNOWLEDGE_DIR,
                promptFile: PROMPT_FILE,
              })
            } else {
              if (!(engine in ASK)) throw new Error(`알 수 없는 엔진: ${engine}`)
              if (!installed[engine]) throw new Error(`${engine} CLI가 설치되어 있지 않습니다`)
              reply = await ASK[engine](input)
            }
            log.info(
              `[cli-bridge] ${engine} ${((Date.now() - started) / 1000).toFixed(1)}s · ${input.query}` +
                (input.history.length ? ` (이력 ${input.history.length}턴)` : ''),
            )
            res.end(JSON.stringify(reply))
          } catch (err) {
            log.error(`[cli-bridge] ${(err as Error).message}`)
            res.statusCode = 502
            res.end(JSON.stringify({ error: (err as Error).message }))
          }
        })
      })

      // 수정 제안 화면의 "AI로 수정" — 고친 본문을 돌려줄 뿐 파일에는 쓰지 않는다 (반영은 승인 흐름으로)
      server.middlewares.use('/api/edit', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        let body = ''
        req.on('data', (c) => (body += c))
        req.on('end', async () => {
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          let engine: Engine | 'gemini'
          let input: EditInput
          try {
            const raw = JSON.parse(body || '{}') as { engine?: Engine | 'gemini' }
            engine = raw.engine ?? 'claude'
            input = parseEditInput(raw)
          } catch (err) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: err instanceof SyntaxError ? '요청 형식이 올바르지 않습니다' : (err as Error).message }))
            return
          }
          try {
            const started = Date.now()
            let reply: EditReply
            if (engine === 'gemini') {
              if (!geminiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다 (.env.local)')
              reply = await editGemini(input, { apiKey: geminiKey, model: geminiModel, promptFile: EDIT_PROMPT_FILE })
            } else {
              if (!(engine in EDIT)) throw new Error(`알 수 없는 엔진: ${engine}`)
              if (!installed[engine]) throw new Error(`${engine} CLI가 설치되어 있지 않습니다`)
              reply = await EDIT[engine](input)
            }
            log.info(`[cli-bridge] edit ${engine} ${((Date.now() - started) / 1000).toFixed(1)}s · ${input.code} · ${input.instruction}`)
            res.end(JSON.stringify(reply))
          } catch (err) {
            log.error(`[cli-bridge] edit ${(err as Error).message}`)
            res.statusCode = 502
            res.end(JSON.stringify({ error: (err as Error).message }))
          }
        })
      })
    },
  }
}
