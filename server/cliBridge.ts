import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname, tmpdir } from 'node:os'
import { Readable } from 'node:stream'
import { delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadEnv, type Plugin } from 'vite'
import {
  readBigBannerSheetUrl,
  readBtvSheetUrl,
  readClaudeFallbackModel,
  readClaudeModel,
  readCodexModel,
  readGeminiFallbackModel,
  readGeminiKey,
  readGeminiModel,
  readGithubRepo,
  readGithubToken,
  readHubHomeDir,
  readJiraBaseUrl,
  readJiraProjectKey,
} from './env.js'
import {
  bodyHeaderProblem,
  LOCAL_HUB_ORIGINS,
  readOriginProblem,
  rejectionBody,
  TOO_LARGE,
  writeOriginProblem,
  type Rejection,
} from './guard.js'
import { parseHubAccount, proxyHubZip } from './hubZip.js'
import { hubVersionStatus } from './hubVersion.js'
import {
  createDocPR,
  createEditPR,
  EditError,
  editErrorBody,
  listProposalPrs,
  parseCreateDocInput,
  parseEditDocInput,
  PublicLeakError,
} from './github.js'
import { hitCounts, loadPrivateTerms, parsePublicCheckInput, publicLeaks, searchGuardRules } from './publicCheck.js'
import {
  isShared,
  readSystemsFile,
  systemsFilePath,
  updateSystemsFile,
  type StoredRequest,
} from './systemsFile.js'
import { askGemini, editGemini, geminiErrorBody } from './gemini.js'
import {
  chatLogConfig,
  chatLogStoreConnected,
  DEPLOY_ONLY_TEXT,
  recordChatTurn,
  type ChatLogEngine,
  type ChatTurnOutcome,
} from './chatLog.js'
import {
  type AskInput,
  type AskResponse,
  buildAskRequest,
  buildDocsBlock,
  buildEditRequest,
  buildReportRequest,
  checkEditReply,
  checkReportReply,
  detectReportIntent,
  EDIT_SCHEMA,
  checkAskReply,
  MAX_ASK_BYTES,
  MAX_EDIT_BYTES,
  MAX_FORM_BYTES,
  MAX_PR_BYTES,
  parseAskInput,
  parseEditInput,
  qaResponse,
  REPLY_SCHEMA,
  REPORT_SCHEMA,
  reportResponse,
  reportUnavailable,
  todayLine,
  type CliReply,
  type EditInput,
  type EditReply,
  type ReportIntent,
  type ReportReply,
  type ReportType,
  type WebSearchOff,
} from './knowledge.js'
import { buildJiraScheduleRequest, JIRA_SCHEDULE_SCHEMA, type JiraScheduleReply } from './jiraSchedule.js'
import { buildScheduleBlock } from './scheduleDigest.js'
import { getSchedule, isScheduleKind, scheduleErrorBody } from './scheduleSource.js'

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
const REPORT_PROMPT_FILE = resolve(__dirname, 'report-prompt.md')
const REPORT_GUARD_SCRIPT = resolve(__dirname, 'reportGuard.mjs')

const TIMEOUT_MS: Record<Engine, number> = { claude: 120_000, codex: 180_000 }
/** 문서 편집은 본문 전체를 다시 써서 돌려주므로 답변보다 오래 걸린다 */
const EDIT_TIMEOUT_MS: Record<Engine, number> = { claude: 240_000, codex: 300_000 }
/**
 * 리포트는 위키를 넓게 읽고 본문을 길게 쓴다 — 실측 115~189초(조사 문서). 화면 중단 시간은 이 값 + 30초로 맞춘다
 * (src/lib/assistant.ts ENGINE_TIMEOUT_MS 와 같은 간격)
 */
export const REPORT_TIMEOUT_MS: Record<Engine, number> = { claude: 300_000, codex: 360_000 }
/** 리포트 한 번의 웹 호출 한도 — 시간·비용 상한. 넘으면 훅이 거절한다 */
const REPORT_MAX_SEARCH = 6
const REPORT_MAX_FETCH = 4

/**
 * .env.local 의 CLI 모델 지정 — 플러그인 설정부(configureServer)에서 한 번 채운다. 비어 있으면 각 PC의 CLI 기본 모델.
 * 버전명은 코드에 두지 않는다. claude 는 별칭(opus·sonnet·haiku)을 권한다
 */
const cliModels: { claude?: string; claudeFallback?: string; codex?: string } = {}

/** claude 모델 인자 — 예비 모델이 기본 모델과 같으면 CLI가 에러를 내므로 그때는 예비 모델을 뺀다 */
function claudeModelArgs(): string[] {
  const { claude, claudeFallback } = cliModels
  return [
    ...(claude ? ['--model', claude] : []),
    ...(claudeFallback && claudeFallback !== claude ? ['--fallback-model', claudeFallback] : []),
  ]
}

/** Windows의 npm 셸 래퍼(claude.cmd, codex.cmd)는 cmd.exe를 거쳐야 실행되므로 인자 속 따옴표를 이스케이프한다. */
const IS_WIN = process.platform === 'win32'
const quote = (arg: string) => (IS_WIN ? `"${arg.replace(/"/g, '\\"')}"` : arg)

/**
 * 실행 스크립트가 사용자 폴더에 깐 챗봇 연결 프로그램(tools)과 휴대용 node 경로 — 전역 설치를 쓰지 않아 PATH 에 없을 수 있다.
 * 스크립트가 이미 PATH 앞에 넣고 허브를 켜지만, npm run dev 로 직접 켜거나 나중에 설치돼도 같은 CLI를 찾게 여기서도 넣는다
 */
function hubToolDirs(): string[] {
  const home = readHubHomeDir()
  return [join(home, 'tools', 'node_modules', '.bin'), IS_WIN ? join(home, 'node') : join(home, 'node', 'bin')]
}

function addHubToolsToPath(): void {
  const current = (process.env.PATH ?? '').split(delimiter)
  const missing = hubToolDirs().filter((dir) => !current.includes(dir))
  if (missing.length) process.env.PATH = [...missing, ...current].filter(Boolean).join(delimiter)
}

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

// claude 는 구독 로그인을 명시한다 — 기본값이 바뀌어도 Console(API 과금) 화면으로 가지 않게 (docs/plan/2026-11-12-cli-login-research.md)
const LOGIN_ARGS: Record<Engine, string[]> = { claude: ['claude', 'auth', 'login', '--claudeai'], codex: ['codex', 'login'] }

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/** 로그인은 브라우저 OAuth를 거치므로 페이지 안에서 처리할 수 없다 — 이 PC에 로그인용 터미널 창을 띄운다. */
function openLoginTerminal(engine: Engine): boolean {
  const args = LOGIN_ARGS[engine]
  if (IS_WIN) {
    spawn('cmd.exe', ['/c', 'start', 'CLI login', 'cmd', '/k', ...args], { detached: true, stdio: 'ignore' }).unref()
    return true
  }
  if (process.platform === 'darwin') {
    // 터미널 새 창은 이 서버의 PATH 를 물려받지 않아, 사용자 폴더의 연결 프로그램·node 경로를 앞에 붙여 실행한다
    const script = `export PATH=${hubToolDirs().map(shQuote).join(':')}:"$PATH"; ${args.join(' ')}`
    const appleString = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    spawn('osascript', ['-e', `tell application "Terminal" to do script "${appleString}"`], {
      detached: true,
      stdio: 'ignore',
    }).unref()
    return true
  }
  return false
}

/** 제한 시간을 넘김 — 리포트는 화면이 "N분 안에 끝나지 않았습니다"를 고르도록 따로 분류한다 */
class CliTimeoutError extends Error {
  constructor(
    readonly engine: Engine,
    readonly timeoutMs: number,
  ) {
    super(`${engine} CLI 응답이 ${timeoutMs / 1000}초를 넘었습니다`)
    this.name = 'CliTimeoutError'
  }
}

/** 화면이 요청을 끊어(취소·화면 쪽 시간 초과) CLI를 멈췄다 — 돌려줄 곳이 없으므로 로그만 남긴다 */
class CliCancelledError extends Error {
  constructor(engine: Engine) {
    super(`화면이 요청을 끊어 ${engine} CLI를 멈췄습니다`)
    this.name = 'CliCancelledError'
  }
}

/**
 * Windows 는 shell:true 라 child 가 cmd.exe 다 — child.kill() 은 cmd.exe 만 죽이고 claude·node 손자 프로세스가 남는다.
 * 프로세스 트리째(/T) 끝낸다
 */
function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) return
  if (IS_WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  else child.kill()
}

interface RunOptions {
  timeoutMs?: number
  /** 화면 연결이 끊기면 abort — 프로세스를 정리한다 */
  signal?: AbortSignal
  /** 자식(과 claude 훅)에 넘길 환경 — 리포트 훅 규칙을 여기에 싣는다 */
  env?: NodeJS.ProcessEnv
}

/** CLI를 실행하고 stdout을 돌려준다. 한글 입력은 인자 대신 stdin으로 넘겨 셸 인코딩·줄바꿈 문제를 피한다. */
function run(engine: Engine, args: string[], stdin: string, cwd: string, opts: RunOptions = {}): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS[engine]
  return new Promise((resolvePromise, reject) => {
    if (opts.signal?.aborted) return reject(new CliCancelledError(engine))
    const child = spawn(engine, args.map(quote), { cwd, shell: IS_WIN, env: opts.env })
    let stdout = ''
    let stderr = ''
    const onAbort = () => {
      clearTimeout(timer)
      killTree(child)
      reject(new CliCancelledError(engine))
    }
    const timer = setTimeout(() => {
      opts.signal?.removeEventListener('abort', onAbort)
      killTree(child)
      reject(new CliTimeoutError(engine, timeoutMs))
    }, timeoutMs)
    opts.signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('error', (err) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (code === 0) resolvePromise(stdout)
      else reject(new Error(`${engine} CLI 오류 (exit ${code})\n${stderr.slice(-800)}`))
    })
    child.stdin.end(stdin)
  })
}

/**
 * claude -p 를 JSON 스키마 모드로 실행한다. 도구는 기본으로 읽기 전용(Read·Grep·Glob)만 열어 파일을 고치지 못하게 한다.
 * 리포트는 tools 로 웹 검색(읽기 전용)을 더한다
 */
async function claudeJson(
  input: string,
  promptArgs: string[],
  schema: object,
  timeoutMs?: number,
  opts: Omit<RunOptions, 'timeoutMs'> & { tools?: string } = {},
): Promise<unknown> {
  const stdout = await run(
    'claude',
    [
      '-p',
      '--output-format', 'json',
      '--no-session-persistence',
      ...claudeModelArgs(),
      '--tools', opts.tools ?? 'Read,Grep,Glob',
      ...promptArgs,
      '--json-schema', JSON.stringify(schema),
    ],
    input,
    KNOWLEDGE_DIR,
    { timeoutMs, signal: opts.signal, env: opts.env },
  )
  const out = JSON.parse(stdout)
  if (out.is_error || !out.structured_output) throw new Error(out.result || 'claude CLI가 구조화된 응답을 주지 않았습니다')
  return out.structured_output
}

/**
 * Codex는 Windows 샌드박스가 셸 실행을 막는 환경이 있어(CreateProcessWithLogonW 1385) 문서를 직접 못 읽는다.
 * 샌드박스를 끄는 대신 필요한 문서를 프롬프트에 넣고 read-only 샌드박스를 유지한다.
 */
async function codexJson(prompt: string, schema: object, timeoutMs?: number, signal?: AbortSignal): Promise<unknown> {
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
        ...(cliModels.codex ? ['-m', cliModels.codex] : []),
        '--output-schema', schemaFile,
        '--output-last-message', lastMessageFile,
        '-',
      ],
      prompt,
      KNOWLEDGE_DIR,
      { timeoutMs, signal },
    )
    return JSON.parse(readFileSync(lastMessageFile, 'utf8'))
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** .env.local 값을 합친 환경 — configureServer 에서 채운다. 편성표 시트 주소(HUB_*_SHEET_URL)를 여기서 찾는다 */
let hubEnv: Record<string, string | undefined> = process.env

/**
 * 로컬 허브 대화 기록의 사용자 — 로컬에는 로그인이 없어 PC 이름으로 남긴다(D1 나, 관리자 PC 에만 Redis 설정을 둔다).
 * 계정 아이디와 겹치지 않게 local: 을 붙인다
 */
const LOCAL_LOGIN_ID = `local:${hostname().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').slice(0, 60) || 'pc'}`

/** 편성표는 원본 시트에서 실시간으로 받아 와 CLI가 도구로 열어볼 수 없으므로, 질문한 기간만 프롬프트에 직접 넣는다 */
const scheduleNote = async (input: AskInput): Promise<string> =>
  [
    '편성표(Today B tv·모바일 빅배너) 데이터는 원본 시트에서 실시간으로 받아 질문한 기간만 아래 <schedule>에 직접 넣었다. 이 안에 있는 내용만 근거로 답하고 지어내지 마라.',
    todayLine(),
    await buildScheduleBlock(input, hubEnv),
  ].join('\n\n')

/**
 * 편성표 블록은 stdin으로 넣는다 — Windows는 명령줄 길이 한도가 낮아(cmd.exe 셸 경유 시 약 8KB)
 * `--append-system-prompt` 인자로 넣으면 ENAMETOOLONG으로 실행 자체가 실패한다.
 */
const askClaude = async (input: AskInput, signal?: AbortSignal) =>
  checkAskReply(
    await claudeJson(
      [await scheduleNote(input), buildAskRequest(input)].join('\n\n'),
      [
        '--system-prompt-file', PROMPT_FILE,
        '--append-system-prompt', '작업 디렉터리가 위키 문서 폴더다. Grep·Glob·Read 도구로 문서를 찾아 읽어라.',
      ],
      REPLY_SCHEMA,
      undefined,
      { signal },
    ),
    KNOWLEDGE_DIR,
  )

/** 위키 문서 전체(약 100KB)를 프롬프트에 넣는다 */
const askCodex = async (input: AskInput, signal?: AbortSignal) =>
  checkAskReply(
    await codexJson(
      [
        readFileSync(PROMPT_FILE, 'utf8'),
        '위키 문서 전체가 아래 <documents>에 들어 있다. 명령이나 도구를 실행하지 말고 이 문서만 읽고 답하라.',
        `<documents>\n${buildDocsBlock(KNOWLEDGE_DIR)}\n</documents>`,
        await scheduleNote(input),
        buildAskRequest(input),
      ].join('\n\n'),
      REPLY_SCHEMA,
      undefined,
      signal,
    ),
    KNOWLEDGE_DIR,
  )

const ASK: Record<Engine, (input: AskInput, signal?: AbortSignal) => Promise<CliReply>> = { claude: askClaude, codex: askCodex }

/* ── 리포트 모드 — 로컬 CLI 에서만 (배포본·Gemini 는 안내만, docs/plan/2026-11-18-cli-report-mode.md) ── */

interface ReportOutcome {
  reply: ReportReply
  /** 훅이 거절한 웹 호출 — 종류별 건수만(걸린 글자는 남기지 않는다) */
  refused: string[]
  /** 모델이 검색했다고 적었는데 훅 기록이 없다 — 훅이 붙지 않았을 수 있다 */
  hookMissing: boolean
}

/** 훅 기록 — 통과한 검색어는 글자로, 거절은 종류만 */
function readGuardLog(file: string): { queries: string[]; fetched: number; refused: string[]; entries: number } {
  let lines: string[] = []
  try {
    lines = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  } catch {
    lines = []
  }
  const queries: string[] = []
  const refused: string[] = []
  let fetched = 0
  for (const line of lines) {
    try {
      const e = JSON.parse(line) as { tool?: string; ok?: boolean; text?: string; kinds?: string[] }
      if (!e.ok) refused.push(...(e.kinds ?? ['unknown']))
      else if (e.tool === 'WebSearch' && e.text) queries.push(e.text)
      else if (e.tool === 'WebFetch') fetched++
    } catch {
      // 깨진 줄은 건너뛴다
    }
  }
  return { queries, fetched, refused, entries: lines.length }
}

const hookPath = (p: string) => p.replace(/\\/g, '/')

/**
 * claude 리포트 — 웹 검색(WebSearch·WebFetch, 읽기 전용)을 열고, 내보내기 전에 PreToolUse 훅으로 검색어·주소를 검사한다.
 * 훅은 이 실행에만 붙도록 임시 settings 파일로 넘긴다(Windows cmd.exe 경유라 인라인 JSON 은 따옴표가 깨진다).
 * 비공개 이름 목록이 없거나 점검 유형이면 웹 검색 없이 위키만 근거로 쓴다
 */
async function reportClaude(input: AskInput, type: ReportType, signal: AbortSignal): Promise<ReportOutcome> {
  const terms = loadPrivateTerms(hubEnv)
  const webSearchOff: WebSearchOff | null = type === 'audit' ? 'type' : terms ? null : 'terms'
  const work = mkdtempSync(join(tmpdir(), 'wiki-report-'))
  try {
    const settingsFile = join(work, 'settings.json')
    const logFile = join(work, 'guard.log')
    let toolArgs: string[] = []
    let env: NodeJS.ProcessEnv | undefined
    if (!webSearchOff && terms) {
      const command = `"${hookPath(process.execPath)}" "${hookPath(REPORT_GUARD_SCRIPT)}"`
      writeFileSync(
        settingsFile,
        JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'WebSearch|WebFetch', hooks: [{ type: 'command', command }] }] } }),
      )
      // --tools 만으로는 -p 에서 권한을 줄 사람이 없어 웹 도구가 거절된다 — --allowedTools 를 같이 준다
      toolArgs = ['--allowedTools', 'WebSearch,WebFetch', '--settings', settingsFile]
      // 이름 목록은 명령줄·설정 파일에 싣지 않고 환경으로만 훅에 넘긴다
      env = {
        ...process.env,
        HUB_REPORT_GUARD_RULES: JSON.stringify(searchGuardRules(terms)),
        HUB_REPORT_GUARD_LOG: logFile,
        HUB_REPORT_GUARD_MAX_SEARCH: String(REPORT_MAX_SEARCH),
        HUB_REPORT_GUARD_MAX_FETCH: String(REPORT_MAX_FETCH),
      }
    }
    const out = await claudeJson(
      [await scheduleNote(input), buildReportRequest(input, { type, engineLabel: 'Claude', webSearchOff })].join('\n\n'),
      [
        ...toolArgs,
        '--system-prompt-file', REPORT_PROMPT_FILE,
        '--append-system-prompt', '작업 디렉터리가 위키 문서 폴더다. Grep·Glob·Read 도구로 문서를 찾아 읽어라. 리포트는 응답으로만 돌려주고 파일을 만들지 마라.',
      ],
      REPORT_SCHEMA,
      REPORT_TIMEOUT_MS.claude,
      { tools: webSearchOff ? 'Read,Grep,Glob' : 'Read,Grep,Glob,WebSearch,WebFetch', signal, env },
    )
    const guard = readGuardLog(logFile)
    const modelQueries = (out as { searchQueries?: unknown }).searchQueries
    return {
      // 카드에 공개하는 검색어는 모델이 적은 값이 아니라 훅이 실제로 통과시킨 값이다
      reply: checkReportReply(out, { reportType: type, webSearchOff, terms, observedQueries: webSearchOff ? undefined : guard.queries }),
      refused: guard.refused,
      hookMissing: !webSearchOff && guard.entries === 0 && Array.isArray(modelQueries) && modelQueries.length > 0,
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * codex 리포트 — 검색어를 내보내기 전에 막을 방법이 없어(조사 실험 5) 웹 검색을 켜지 않고 위키만 근거로 쓴다(Q8).
 * Q&A 와 같이 위키 전체를 프롬프트에 넣는다
 */
async function reportCodex(input: AskInput, type: ReportType, signal: AbortSignal): Promise<ReportOutcome> {
  const out = await codexJson(
    [
      readFileSync(REPORT_PROMPT_FILE, 'utf8'),
      '위키 문서 전체가 아래 <documents>에 들어 있다. 명령이나 도구를 실행하지 말고 이 문서만 읽고 쓴다. 웹 검색은 꺼져 있다.',
      `<documents>\n${buildDocsBlock(KNOWLEDGE_DIR)}\n</documents>`,
      await scheduleNote(input),
      buildReportRequest(input, { type, engineLabel: 'Codex', webSearchOff: 'engine' }),
    ].join('\n\n'),
    REPORT_SCHEMA,
    REPORT_TIMEOUT_MS.codex,
    signal,
  )
  return {
    reply: checkReportReply(out, { reportType: type, webSearchOff: 'engine', terms: loadPrivateTerms(hubEnv) }),
    refused: [],
    hookMissing: false,
  }
}

const REPORT: Record<Engine, (input: AskInput, type: ReportType, signal: AbortSignal) => Promise<ReportOutcome>> = {
  claude: reportClaude,
  codex: reportCodex,
}

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

const JIRA_TIMEOUT_MS = 180_000

/**
 * "Jira 스케줄 확인" — claude CLI에 연결된 Jira MCP 서버(서버 이름 "jira"로 등록했다고 가정)로 조회한다.
 * 위키 질문과 달리 로컬 파일을 읽을 필요가 없어 Read·Grep·Glob은 열지 않고 mcp__jira 도구만 연다.
 */
async function askJiraSchedule(baseUrl: string, projectKey: string): Promise<JiraScheduleReply> {
  return (await claudeJson(
    buildJiraScheduleRequest(baseUrl, projectKey),
    [
      '--tools', 'mcp__jira',
      '--append-system-prompt', 'Jira MCP 도구로 조회만 하고, 이슈를 수정하거나 새로 만들지 마라.',
    ],
    JIRA_SCHEDULE_SCHEMA,
    JIRA_TIMEOUT_MS,
  )) as JiraScheduleReply
}

/* ── 요청 입구 — 배포 api/ 와 같은 판정 함수(server/guard.ts)를 쓴다 ── */

const isLocalHub = (url: URL) => LOCAL_HUB_ORIGINS.includes(url.origin)

const headerOf = (req: IncomingMessage, name: string): string | undefined => {
  const v = req.headers[name]
  return Array.isArray(v) ? v[0] : v
}

function sendRejection(res: ServerResponse, r: Rejection): void {
  res.statusCode = r.status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(rejectionBody(r)))
}

/**
 * 허브를 켠 채 다른 사이트를 열면 그 페이지가 localhost 로 text/plain POST 를 보낼 수 있다 — 출처는 허브 화면(5173)만,
 * 형식은 JSON 만 받고 본문은 상한까지만 읽는다. 통과하면 본문 문자열, 막았으면 응답을 쓰고 null
 */
function readGuardedBody(req: IncomingMessage, res: ServerResponse, maxBytes: number): Promise<string | null> {
  const problem =
    writeOriginProblem(headerOf(req, 'origin'), headerOf(req, 'referer'), isLocalHub) ??
    bodyHeaderProblem(headerOf(req, 'content-type'), headerOf(req, 'content-length'), maxBytes)
  if (problem) {
    req.resume()
    sendRejection(res, problem)
    return Promise.resolve(null)
  }
  return new Promise((done) => {
    // 조각을 Buffer 로 모아 한 번에 푼다 — 문자열로 이어 붙이면 한글이 조각 경계에서 깨진다
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size <= maxBytes) chunks.push(c)
    })
    req.on('end', () => {
      if (size <= maxBytes) return done(Buffer.concat(chunks).toString('utf8'))
      sendRejection(res, TOO_LARGE)
      done(null)
    })
    req.on('error', () => done(null))
  })
}

/** 읽기 요청 — 다른 사이트가 링크·이미지로 불러 CLI·토큰을 쓰게 하지 못하게 한다. 막았으면 응답을 쓰고 true */
function blockedRead(req: IncomingMessage, res: ServerResponse): boolean {
  const problem = readOriginProblem(headerOf(req, 'origin'), headerOf(req, 'sec-fetch-site'), isLocalHub)
  if (problem) sendRejection(res, problem)
  return Boolean(problem)
}

export function cliBridge(): Plugin {
  return {
    name: 'cli-bridge',
    apply: 'serve',
    configureServer(server) {
      const log = server.config.logger
      // CLI가 없거나 실패할 때 쓰는 Gemini API 키 — 허브 폴더의 .env.local 에서 읽는다 (브라우저로는 보내지 않음)
      const env = loadEnv(server.config.mode, server.config.root, '')
      hubEnv = { ...process.env, ...env }
      const geminiKey = readGeminiKey(env) || readGeminiKey()
      const geminiModel = readGeminiModel(env) || readGeminiModel()
      const geminiFallbackModel = readGeminiFallbackModel(env) || readGeminiFallbackModel()
      // 로컬 CLI 모델 — 비워 두면 인자를 넣지 않아 각 PC의 CLI 기본 모델로 돈다
      cliModels.claude = readClaudeModel(env) || readClaudeModel()
      cliModels.claudeFallback = readClaudeFallbackModel(env) || readClaudeFallbackModel()
      cliModels.codex = readCodexModel(env) || readCodexModel()
      // "새 문서" 기능(브랜치·PR 생성)이 쓸 토큰 — 없으면 그 버튼만 안내 메시지로 대체된다
      const githubToken = readGithubToken(env) || readGithubToken()
      // Jira 스케줄 확인 — 회사 내부 주소·프로젝트 키라 개인별 .env.local에서만 읽는다
      const jiraBaseUrl = readJiraBaseUrl(env) || readJiraBaseUrl()
      const jiraProjectKey = readJiraProjectKey(env) || readJiraProjectKey()
      addHubToolsToPath()
      const installed: Record<Engine, boolean> = { claude: isInstalled('claude'), codex: isInstalled('codex') }
      getEngineStatus().then((s) => {
        const mark = (e: Engine) => (!s[e].installed ? '✗ 미설치' : s[e].loggedIn ? '✓' : '⚠ 로그인 필요')
        // 지정한 모델만 괄호로 보여 준다 — 예: claude ✓ (sonnet, 예비 haiku)
        const claudeFallback = cliModels.claudeFallback !== cliModels.claude ? cliModels.claudeFallback : undefined
        const claudeNote = [cliModels.claude, claudeFallback && `예비 ${claudeFallback}`].filter(Boolean).join(', ')
        const modelNote = (note?: string) => (note ? ` (${note})` : '')
        log.info(
          `[cli-bridge] claude ${mark('claude')}${modelNote(claudeNote)} · codex ${mark('codex')}${modelNote(cliModels.codex)} · gemini ${geminiKey ? '✓ API 키' : '✗ 키 없음'} · github ${githubToken ? '✓ 토큰' : '✗ 토큰 없음(새 문서 비활성)'} · jira ${jiraBaseUrl && jiraProjectKey ? '✓ 설정됨' : '✗ 설정 안 됨(스케줄 확인 비활성)'}`,
        )
      })

      /**
       * 시스템 목록 공용 저장 — 팀 공유 드라이브의 JSON 파일 하나를 읽고 쓴다.
       * 배포본(Vercel)에는 이 경로가 없어 프론트엔드가 메모리 상태로 대체한다.
       */
      const systemsPath = systemsFilePath(env)
      const systemsShared = isShared(env)
      log.info(
        `[cli-bridge] 시스템 목록 ${systemsShared ? '공유' : '이 PC에만'} 저장 · ${systemsPath}`,
      )
      log.info(
        `[cli-bridge] 편성표 시트 · B tv ${readBtvSheetUrl(hubEnv) ? '✓' : '✗ 주소 없음(HUB_BTV_SHEET_URL)'} · 빅배너 ${readBigBannerSheetUrl(hubEnv) ? '✓' : '✗ 주소 없음(HUB_BIGBANNER_SHEET_URL)'}`,
      )

      server.middlewares.use('/api/systems', async (req, res) => {
        if (req.method === 'GET') {
          if (blockedRead(req, res)) return
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(JSON.stringify({ ...readSystemsFile(systemsPath), shared: systemsShared }))
          return
        }
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const body = await readGuardedBody(req, res, MAX_FORM_BYTES)
        if (body === null) return
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        try {
          const action = JSON.parse(body || '{}') as
            | { kind: 'request'; request: StoredRequest }
            | { kind: 'decide'; id: string; decision: 'approved' | 'rejected'; reason?: string }
          const next = updateSystemsFile(systemsPath, (data) => {
            if (action.kind === 'request') {
              return { ...data, requests: [action.request, ...data.requests] }
            }
            const target = data.requests.find((r) => r.id === action.id)
            const requests = data.requests.map((r) =>
              r.id === action.id ? { ...r, status: action.decision, rejectReason: action.reason } : r,
            )
            if (!target || action.decision !== 'approved') return { ...data, requests }
            // 승인된 요청만 목록에 반영한다 — 주소만 채우는 요청과 새 시스템을 나눠 담는다
            if (target.targetSystemId) {
              return { ...data, requests, urls: { ...data.urls, [target.targetSystemId]: target.url } }
            }
            return {
              ...data,
              requests,
              added: [
                ...data.added,
                {
                  id: target.id,
                  name: target.name,
                  desc: target.desc,
                  url: target.url || undefined,
                  access: target.access,
                  group: target.group,
                },
              ],
            }
          })
          res.end(JSON.stringify({ ...next, shared: systemsShared }))
        } catch (err) {
          log.error(`[cli-bridge] 시스템 목록 저장 실패 — ${(err as Error).message}`)
          res.statusCode = 500
          res.end(JSON.stringify({ error: (err as Error).message }))
        }
      })

      server.middlewares.use('/api/engines', async (req, res) => {
        if (blockedRead(req, res)) return
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        const status = await getEngineStatus()
        for (const e of ENGINES) installed[e] = status[e].installed
        const gemini = Boolean(geminiKey)
        res.end(JSON.stringify({ ...status, gemini: { installed: gemini, loggedIn: gemini } }))
      })

      // Jira 스케줄 확인 — 로컬에 로그인된 claude CLI + Jira MCP로만 동작한다 (배포본엔 이 경로가 없음)
      server.middlewares.use('/api/jiraSchedule', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end()
          return
        }
        if (blockedRead(req, res)) return
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        try {
          if (!installed.claude) throw new Error('claude CLI가 설치되어 있지 않습니다')
          if (!jiraBaseUrl || !jiraProjectKey) {
            throw new Error(
              'JIRA_BASE_URL / JIRA_PROJECT_KEY가 설정되지 않았습니다 (.env.local) — 팀 가이드를 참고해 개인별로 설정해 주세요',
            )
          }
          const started = Date.now()
          const reply = await askJiraSchedule(jiraBaseUrl, jiraProjectKey)
          log.info(`[cli-bridge] jiraSchedule ${((Date.now() - started) / 1000).toFixed(1)}s · ${reply.items.length}건`)
          res.end(JSON.stringify(reply))
        } catch (err) {
          log.error(`[cli-bridge] jiraSchedule ${(err as Error).message}`)
          res.statusCode = 502
          res.end(JSON.stringify({ error: (err as Error).message }))
        }
      })

      // 편성표 실시간 조회 — 배포의 api/schedule.ts 와 같은 응답 (server/scheduleSource.ts)
      server.middlewares.use('/api/schedule', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end()
          return
        }
        if (blockedRead(req, res)) return
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        const params = new URL(req.url ?? '/', 'http://localhost').searchParams
        const kind = params.get('kind')
        if (!isScheduleKind(kind)) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: 'kind 는 btv 또는 bigbanner 여야 합니다' }))
          return
        }
        try {
          const data = await getSchedule(kind, hubEnv, new Date(), { fresh: params.get('fresh') === '1' })
          res.end(JSON.stringify(data))
        } catch (err) {
          const { status, body } = scheduleErrorBody(err)
          log.error(`[cli-bridge] schedule ${kind} ${body.error}`)
          res.statusCode = status
          res.end(JSON.stringify(body))
        }
      })

      server.middlewares.use('/api/login', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const body = await readGuardedBody(req, res, MAX_FORM_BYTES)
        if (body === null) return
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        let engine: Engine | undefined
        try {
          engine = (JSON.parse(body || '{}') as { engine?: Engine }).engine
        } catch {
          engine = undefined
        }
        if (!engine || !ENGINES.includes(engine) || !installed[engine]) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: '설치된 CLI가 아닙니다' }))
          return
        }
        const opened = openLoginTerminal(engine)
        log.info(`[cli-bridge] ${engine} 로그인 창 ${opened ? '열림' : '열 수 없음'}`)
        res.end(JSON.stringify({ opened, command: LOGIN_ARGS[engine].join(' ') }))
      })

      server.middlewares.use('/api/ask', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const body = await readGuardedBody(req, res, MAX_ASK_BYTES)
        if (body === null) return
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        // 화면이 요청을 끊으면(취소·화면 쪽 시간 초과) 도는 CLI 를 정리한다 — 리포트는 몇 분씩 돌아서 그냥 두면 프로세스가 남는다
        const ctrl = new AbortController()
        res.on('close', () => {
          if (!res.writableEnded) ctrl.abort()
        })
        let reporting = false
        // 대화 기록 — 응답을 먼저 끝내고 저장은 기다리지 않는다. Redis 설정이 없는 PC(실무자 PC 기본)는 아무것도 하지 않는다(D1)
        const startedAt = Date.now()
        let turn: { input: AskInput; engine: ChatLogEngine; intent: ReportIntent } | null = null
        // 엔진을 부르기 전에 난 오류(키 없음·CLI 미설치)는 설정 문제로 분류한다
        let calling = false
        const record = (outcome: ChatTurnOutcome) => {
          if (!turn) return
          void recordChatTurn(
            {
              where: 'local',
              loginId: LOCAL_LOGIN_ID,
              input: turn.input,
              intent: turn.intent.mode,
              engine: turn.engine,
              model: turn.engine === 'claude' ? (cliModels.claude ?? null) : turn.engine === 'codex' ? (cliModels.codex ?? null) : null,
              startedAt,
              outcome,
            },
            hubEnv,
          )
        }
        try {
          const raw = JSON.parse(body) as { engine?: Engine | 'gemini' }
          const engine = raw.engine ?? 'claude'
          const input = parseAskInput(raw)
          // 배포 api/ask.ts 와 같은 판정 — 칩으로 고른 modeOverride 가 우선한다
          const intent = detectReportIntent(input.query, input.history, input.modeOverride)
          if (engine === 'gemini' || engine in ASK) turn = { input, engine, intent }
          const started = Date.now()
          const secs = () => ((Date.now() - started) / 1000).toFixed(1)
          let response: AskResponse
          if (engine === 'gemini') {
            // 리포트는 로컬 CLI 에서만 만든다(Q7) — Gemini 를 부르지 않고 안내로 답한다
            if (intent.mode === 'report') {
              log.info(`[cli-bridge] gemini 리포트성 질문 — Gemini 를 부르지 않고 로컬 허브 CLI 안내로 답함`)
              const unavailable = reportUnavailable()
              res.end(JSON.stringify(unavailable))
              record({ status: 'ok', response: unavailable })
              return
            }
            if (!geminiKey) throw new Error('GEMINI_API_KEY가 설정되지 않았습니다 (.env.local)')
            calling = true
            const reply = await askGemini(input, {
              apiKey: geminiKey,
              model: geminiModel,
              fallbackModel: geminiFallbackModel,
              knowledgeDir: KNOWLEDGE_DIR,
              promptFile: PROMPT_FILE,
              env: hubEnv,
            })
            response = qaResponse(reply, intent, false)
          } else {
            if (!(engine in ASK)) throw new Error(`알 수 없는 엔진: ${engine}`)
            if (!installed[engine]) throw new Error(`${engine} CLI가 설치되어 있지 않습니다`)
            calling = true
            if (intent.mode === 'report') {
              reporting = true
              const { reply, refused, hookMissing } = await REPORT[engine](input, intent.type, ctrl.signal)
              // 사용 기록은 검색어와 소요 시간만(Q9) — 질문·리포트 본문·걸린 글자는 남기지 않는다
              const web = reply.webSearch
                ? `웹 검색 ${reply.searchQueries.length}회${reply.searchQueries.length ? ` [${reply.searchQueries.map((q) => JSON.stringify(q)).join(', ')}]` : ''}`
                : `웹 검색 꺼짐(${reply.webSearchOff})`
              log.info(
                `[cli-bridge] report ${engine} ${secs()}s · ${intent.type} · ${web}` +
                  (refused.length ? ` · 훅 거절 ${hitCounts(refused.map((kind) => ({ kind })))}` : '') +
                  (reply.masked.amount || reply.masked.name ? ` · 가림 amount=${reply.masked.amount} name=${reply.masked.name}` : ''),
              )
              if (hookMissing) log.warn(`[cli-bridge] report 훅 기록이 없는데 모델이 검색어를 적었습니다 — 검색어 검사 훅이 붙었는지 확인해 주세요`)
              response = reportResponse(reply)
            } else {
              response = qaResponse(await ASK[engine](input, ctrl.signal), intent, true)
            }
          }
          if (!reporting) {
            log.info(
              `[cli-bridge] ${engine} ${secs()}s · ${input.query}` +
                (input.history.length ? ` (이력 ${input.history.length}턴)` : '') +
                (response.action.type !== 'none' ? ` · 초안 ${response.action.type}` : ''),
            )
          }
          res.end(JSON.stringify(response))
          record({ status: 'ok', response })
        } catch (err) {
          const triedMode = reporting ? 'report' : 'qa'
          if (err instanceof CliCancelledError) {
            log.info(`[cli-bridge] ${reporting ? 'report ' : ''}${err.message}`)
            record({ status: 'cancelled', mode: triedMode })
            return
          }
          log.error(`[cli-bridge] ${reporting ? 'report ' : ''}${(err as Error).message}`)
          if (reporting && err instanceof CliTimeoutError) {
            // 화면이 "리포트가 {N}분 안에 끝나지 않았습니다"와 짧은 답 받기 칩을 고른다
            res.statusCode = 504
            res.end(JSON.stringify({ error: err.message, code: 'timeout', mode: 'report', timeoutMs: err.timeoutMs }))
            record({ status: 'fail', errorCode: 'timeout', mode: 'report' })
            return
          }
          res.statusCode = 502
          // 배포 api/ask.ts 와 같은 형태 — Gemini 오류면 분류 code 를 함께 준다
          const failed = geminiErrorBody(err)
          res.end(JSON.stringify(reporting ? { ...failed, mode: 'report' } : failed))
          const errorCode = !calling ? 'config' : (failed.code ?? (err instanceof CliTimeoutError ? 'timeout' : 'cli'))
          record({ status: 'fail', errorCode, mode: triedMode })
        }
      })

      // 대화 기록 — 로컬에는 로그인이 없어 저장 여부(view=status)만 알려 준다. 목록·사용량·삭제는 배포 api/chatlog.ts 에서만
      server.middlewares.use('/api/chatlog', async (req, res) => {
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        if (req.method === 'GET') {
          if (blockedRead(req, res)) return
          const view = new URL(req.url ?? '/', 'http://localhost').searchParams.get('view')
          if (view === 'status') {
            // 로컬은 로그인이 없어 본인 기록을 볼 수 없다(mine:false) — 저장 여부(enabled)만 고지에 쓴다
            res.end(
              JSON.stringify({ enabled: chatLogStoreConnected(hubEnv), retentionDays: chatLogConfig(hubEnv).days, where: 'local', mine: false }),
            )
            return
          }
        } else if (req.method === 'DELETE') {
          if (writeOriginProblem(headerOf(req, 'origin'), headerOf(req, 'referer'), isLocalHub)) {
            req.resume()
            sendRejection(res, { status: 403, error: '허용되지 않은 요청입니다' })
            return
          }
          req.resume()
        } else {
          res.statusCode = 405
          res.end()
          return
        }
        res.statusCode = 404
        res.end(JSON.stringify({ error: DEPLOY_ONLY_TEXT, code: 'deploy-only' }))
      })

      // 공개 규칙 검사 — 새 문서 제출 전 화면이 부른다. 아무것도 저장하지 않는다 (배포 api/publicCheck.ts 와 같은 응답)
      server.middlewares.use('/api/publicCheck', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const body = await readGuardedBody(req, res, MAX_PR_BYTES)
        if (body === null) return
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        try {
          const input = parsePublicCheckInput(JSON.parse(body || '{}'))
          const result = publicLeaks(input, { env: hubEnv })
          // 걸린 표기는 로그에 남기지 않는다 — 종류별 건수만
          if (result.blocks.length) log.info(`[cli-bridge] publicCheck block ${hitCounts(result.blocks)}`)
          res.end(JSON.stringify(result))
        } catch (err) {
          res.statusCode = 400
          res.end(JSON.stringify({ error: err instanceof SyntaxError ? '요청 형식이 올바르지 않습니다' : (err as Error).message }))
        }
      })

      // 수정 제안 화면의 "AI로 수정" — 고친 본문을 돌려줄 뿐 파일에는 쓰지 않는다 (반영은 승인 흐름으로)
      server.middlewares.use('/api/edit', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const body = await readGuardedBody(req, res, MAX_EDIT_BYTES)
        if (body === null) return
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
            reply = await editGemini(input, {
              apiKey: geminiKey,
              model: geminiModel,
              fallbackModel: geminiFallbackModel,
              promptFile: EDIT_PROMPT_FILE,
            })
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
          res.end(JSON.stringify(geminiErrorBody(err)))
        }
      })

      // 로컬 허브 내려받기 — 배포의 api/download-hub.ts 와 같은 중계 (화면 버튼은 배포 허브에만 뜨지만 404 경로를 남기지 않는다)
      server.middlewares.use('/api/download-hub', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end()
          return
        }
        if (blockedRead(req, res)) return
        // 배포와 같은 쿼리 계약 — ?account=claude|codex|both 면 ZIP에 계정 선택 파일을 넣는다
        const account = new URL(req.url ?? '/', 'http://localhost').searchParams.get('account')
        const upstream = await proxyHubZip(githubToken, readGithubRepo({ ...process.env, ...env }), parseHubAccount(account))
        res.statusCode = upstream.status
        upstream.headers.forEach((v, k) => res.setHeader(k, v))
        if (!upstream.body) {
          res.end()
          return
        }
        Readable.fromWeb(upstream.body as never).pipe(res)
      })

      // 내 PC용 허브의 새 버전 알림 — 로컬 전용(배포엔 api/ 함수가 없어 404, 화면이 무시). 교체는 다시 켤 때 실행기가 한다
      server.middlewares.use('/api/hubVersion', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end()
          return
        }
        if (blockedRead(req, res)) return
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        res.setHeader('Cache-Control', 'no-store')
        const reply = await hubVersionStatus(ROOT, {
          onError: (message) => log.warn(`[cli-bridge] hubVersion 최신 버전 확인 실패 — ${message}`),
        })
        res.end(JSON.stringify(reply))
      })

      // 위키 문서 목록의 "+ 새 문서" — GitHub API로 브랜치·PR을 만든다 (로컬도 배포와 같은 경로)
      server.middlewares.use('/api/createDoc', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const body = await readGuardedBody(req, res, MAX_PR_BYTES)
        if (body === null) return
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (!githubToken) {
          res.statusCode = 503
          res.end(JSON.stringify({ error: 'GITHUB_TOKEN이 설정되지 않았습니다 (.env.local)' }))
          return
        }
        try {
          const input = parseCreateDocInput(JSON.parse(body || '{}'))
          // .env.local 을 합친 환경 — 비공개 이름 목록(HUB_PRIVATE_TERMS_FILE)·저장소(GITHUB_REPO)를 여기서 찾는다
          const result = await createDocPR(input, { token: githubToken, env: hubEnv })
          log.info(`[cli-bridge] createDoc ${result.code} · ${input.title} · ${input.requestedBy} · ${input.via} · PR #${result.prNumber}`)
          res.end(JSON.stringify(result))
        } catch (err) {
          if (err instanceof PublicLeakError) {
            // 걸린 표기는 로그에 남기지 않는다 — 종류별 건수만
            log.info(`[cli-bridge] createDoc 차단 · publicCheck block ${hitCounts(err.blocks)}`)
            res.statusCode = 400
            res.end(JSON.stringify({ error: err.message, code: err.code, blocks: err.blocks }))
            return
          }
          log.error(`[cli-bridge] createDoc ${(err as Error).message}`)
          // 배포 api/createDoc.ts 와 같은 형태 — 입력 문제는 400 과 code
          res.statusCode = err instanceof SyntaxError ? 400 : err instanceof EditError ? err.status : 502
          res.end(
            JSON.stringify(
              err instanceof SyntaxError
                ? { error: '요청 형식이 올바르지 않습니다' }
                : err instanceof EditError
                  ? editErrorBody(err)
                  : { error: (err as Error).message },
            ),
          )
        }
      })

      // 위키 문서의 "✎ 수정 제안" — 기존 파일을 고치는 PR (로컬도 배포와 같은 경로)
      server.middlewares.use('/api/proposeEdit', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end()
          return
        }
        const body = await readGuardedBody(req, res, MAX_PR_BYTES)
        if (body === null) return
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (!githubToken) {
          res.statusCode = 503
          res.end(JSON.stringify({ error: 'GITHUB_TOKEN이 설정되지 않았습니다 (.env.local)' }))
          return
        }
        try {
          const input = parseEditDocInput(JSON.parse(body || '{}'))
          const result = await createEditPR(input, { token: githubToken, env: { ...process.env, ...env } })
          log.info(`[cli-bridge] proposeEdit ${input.code} · ${input.title} · ${input.requestedBy} · ${input.via} · PR #${result.prNumber}`)
          res.end(JSON.stringify(result))
        } catch (err) {
          log.error(`[cli-bridge] proposeEdit ${(err as Error).message}`)
          // 배포 api/proposeEdit.ts 와 같은 형태 — 409 는 mainVersion·mainBody 를 함께 싣는다
          res.statusCode = err instanceof SyntaxError ? 400 : err instanceof EditError ? err.status : 502
          res.end(
            JSON.stringify(
              err instanceof SyntaxError
                ? { error: '요청 형식이 올바르지 않습니다' }
                : err instanceof EditError
                  ? editErrorBody(err)
                  : { error: (err as Error).message },
            ),
          )
        }
      })

      // 문서 제안 목록 — GitHub PR 에서 읽는다
      server.middlewares.use('/api/proposals', async (req, res) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end()
          return
        }
        if (blockedRead(req, res)) return
        res.setHeader('Content-Type', 'application/json; charset=utf-8')
        if (!githubToken) {
          res.statusCode = 503
          res.end(JSON.stringify({ error: 'GITHUB_TOKEN이 설정되지 않아 제안 목록을 읽을 수 없습니다 (.env.local)' }))
          return
        }
        try {
          res.end(JSON.stringify({ proposals: await listProposalPrs({ token: githubToken, env: { ...process.env, ...env } }) }))
        } catch (err) {
          log.error(`[cli-bridge] proposals ${(err as Error).message}`)
          res.statusCode = 502
          res.end(JSON.stringify({ error: (err as Error).message }))
        }
      })
    },
  }
}
