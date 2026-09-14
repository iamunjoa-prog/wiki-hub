import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))

/**
 * 로컬 개발 전용 — 브라우저의 /api/* 요청을 내 PC에 로그인된 CLI(Claude Code 또는 Codex)로 넘긴다.
 * 배포본(Vercel)에는 이 경로가 없으므로 프론트엔드가 규칙 기반 답변으로 대체한다.
 */

export type Engine = 'claude' | 'codex'

export interface CliReply {
  text: string
  sourcePaths: string[]
}

const ROOT = resolve(__dirname, '..')
const KNOWLEDGE_DIR = resolve(ROOT, '지식')
const PROMPT_FILE = resolve(__dirname, 'assistant-prompt.md')

const TIMEOUT_MS: Record<Engine, number> = { claude: 120_000, codex: 180_000 }

// OpenAI 구조화 출력은 additionalProperties:false 와 전체 required 를 요구한다.
const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    sourcePaths: { type: 'array', items: { type: 'string' } },
  },
  required: ['text', 'sourcePaths'],
  additionalProperties: false,
}

/** Windows의 npm 셸 래퍼(claude.cmd, codex.cmd)는 cmd.exe를 거쳐야 실행되므로 인자 속 따옴표를 이스케이프한다. */
const IS_WIN = process.platform === 'win32'
const quote = (arg: string) => (IS_WIN ? `"${arg.replace(/"/g, '\\"')}"` : arg)

function isInstalled(cmd: Engine): boolean {
  return spawnSync(IS_WIN ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0
}

/** CLI를 실행하고 stdout을 돌려준다. 한글 입력은 인자 대신 stdin으로 넘겨 셸 인코딩·줄바꿈 문제를 피한다. */
function run(engine: Engine, args: string[], stdin: string, cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(engine, args.map(quote), { cwd, shell: IS_WIN })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`${engine} CLI 응답이 ${TIMEOUT_MS[engine] / 1000}초를 넘었습니다`))
    }, TIMEOUT_MS[engine])

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

async function askClaude(query: string): Promise<CliReply> {
  const stdout = await run(
    'claude',
    [
      '-p',
      '--output-format', 'json',
      '--no-session-persistence',
      '--tools', 'Read,Grep,Glob',
      '--system-prompt-file', PROMPT_FILE,
      '--append-system-prompt', '작업 디렉터리가 위키 문서 폴더다. Grep·Glob·Read 도구로 문서를 찾아 읽어라.',
      '--json-schema', JSON.stringify(REPLY_SCHEMA),
    ],
    query,
    KNOWLEDGE_DIR,
  )
  const out = JSON.parse(stdout)
  if (out.is_error || !out.structured_output) throw new Error(out.result || 'claude CLI가 구조화된 응답을 주지 않았습니다')
  return out.structured_output as CliReply
}

function listDocs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name)
    if (e.isDirectory()) return listDocs(full)
    return e.name.endsWith('.md') ? [full] : []
  })
}

/**
 * Codex는 Windows 샌드박스가 셸 실행을 막는 환경이 있어(CreateProcessWithLogonW 1385) 문서를 직접 못 읽는다.
 * 샌드박스를 끄는 대신 전체 문서(약 100KB)를 프롬프트에 넣고 read-only 샌드박스를 유지한다.
 */
async function askCodex(query: string): Promise<CliReply> {
  const docsBlock = listDocs(KNOWLEDGE_DIR)
    .map((file) => {
      const path = relative(KNOWLEDGE_DIR, file).replace(/\\/g, '/')
      return `<document path="${path}">\n${readFileSync(file, 'utf8')}\n</document>`
    })
    .join('\n\n')

  const prompt = [
    readFileSync(PROMPT_FILE, 'utf8'),
    '위키 문서 전체가 아래 <documents>에 들어 있다. 명령이나 도구를 실행하지 말고 이 문서만 읽고 답하라.',
    `<documents>\n${docsBlock}\n</documents>`,
    `## 질문\n\n${query}`,
  ].join('\n\n')

  const work = mkdtempSync(join(tmpdir(), 'wiki-codex-'))
  try {
    const schemaFile = join(work, 'schema.json')
    const lastMessageFile = join(work, 'last.json')
    writeFileSync(schemaFile, JSON.stringify(REPLY_SCHEMA))
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
    )
    return JSON.parse(readFileSync(lastMessageFile, 'utf8')) as CliReply
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

const ASK: Record<Engine, (query: string) => Promise<CliReply>> = { claude: askClaude, codex: askCodex }

export function cliBridge(): Plugin {
  return {
    name: 'cli-bridge',
    apply: 'serve',
    configureServer(server) {
      const log = server.config.logger
      const installed: Record<Engine, boolean> = { claude: isInstalled('claude'), codex: isInstalled('codex') }
      log.info(`[cli-bridge] claude ${installed.claude ? '✓' : '✗'} · codex ${installed.codex ? '✓' : '✗'}`)

      server.middlewares.use('/api/engines', (_req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.end(JSON.stringify(installed))
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
            const { query, engine = 'claude' } = JSON.parse(body) as { query?: string; engine?: Engine }
            if (!query?.trim()) throw new Error('질문이 비어 있습니다')
            if (!(engine in ASK)) throw new Error(`알 수 없는 엔진: ${engine}`)
            if (!installed[engine]) throw new Error(`${engine} CLI가 설치되어 있지 않습니다`)
            const started = Date.now()
            const reply = await ASK[engine](query.trim())
            log.info(`[cli-bridge] ${engine} ${((Date.now() - started) / 1000).toFixed(1)}s · ${query.trim()}`)
            res.end(JSON.stringify(reply))
          } catch (err) {
            log.error(`[cli-bridge] ${(err as Error).message}`)
            res.statusCode = 502
            res.end(JSON.stringify({ error: (err as Error).message }))
          }
        })
      })
    },
  }
}
