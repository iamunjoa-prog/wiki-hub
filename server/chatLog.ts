import { randomBytes } from 'node:crypto'
import { readChatLogDailyCap, readChatLogDays } from './env.js'
import type { AskInput, AskResponse, ReportIntent, ReportType, WebSearchOff } from './knowledge.js'
import { readRedis, redis, redisPipeline, storeConnected, type Env, type RedisCommand } from './redisStore.js'

/**
 * 챗봇 대화 기록 — 관리자가 실제 질문·답을 보고 대화 규약·위키를 고치는 데 쓴다(docs/plan/2026-11-20-chat-history-log.md).
 * 배포 api/ask.ts·api/chatlog.ts 와 로컬 server/cliBridge.ts 가 같은 규칙을 쓴다.
 * 기록은 Upstash Redis 에만 둔다 — 공개 저장소라 GitHub·파일로 쓰는 코드를 두지 않는다(server/github.ts 를 부르지 않는다).
 * 저장은 답 경로를 막지 않는다 — 절대 throw 하지 않고, 1초 넘게 기다리지 않고, 질문·답 원문을 로그에 쓰지 않는다.
 */

export type ChatLogEngine = 'claude' | 'codex' | 'gemini'
export type ChatLogStatus = 'ok' | 'fail' | 'cancelled'
export type ChatLogMode = AskResponse['mode']
export type ChatLogWhere = 'deploy' | 'local'

/** 리포트 기록 — 본문(markdown)은 싣지 않고 글자 수만 남긴다(D3) */
export interface ChatLogReport {
  title: string
  summary: string
  type: ReportType
  sources: string[]
  external: { title: string; url: string }[]
  searchQueries: string[]
  gaps: string[]
  webSearch: boolean
  webSearchOff: WebSearchOff | null
  masked: { amount: number; name: number }
  /** 가린 뒤에도 남은 공개 규칙 경고 건수 — 걸린 글자는 남기지 않는다 */
  warnings: number
  chars: number
}

/** 기록 1건 = 서버 /api/ask 1회 = 엔진 1회 시도 */
export interface ChatLogRecord {
  id: string
  chatId: string | null
  turnId: string | null
  /** 배포는 계정 아이디, 로컬은 local:<PC 이름> — 이름·팀은 조회할 때 계정 목록에서 붙인다 */
  loginId: string
  where: ChatLogWhere
  /** 요청을 받은 시각(UTC ISO) */
  at: string
  ms: number
  engine: ChatLogEngine
  model: string | null
  /** 응답 mode. 실패·취소면 시도한 모드 */
  mode: ChatLogMode
  intent: ReportIntent['mode']
  modeOverride: 'qa' | 'report' | null
  /** 화면이 보낸 다시 묻기 경로(참고값) — 없으면 null */
  via: string | null
  status: ChatLogStatus
  /** 분류 코드만 — 오류 원문은 경로·키 이름이 섞일 수 있어 남기지 않는다 */
  errorCode: string | null
  q: string
  /** 일반 답 앞 1,500자. 리포트는 report.summary 를 본다 */
  a: string
  aCut: boolean
  sources: string[]
  noSource: boolean
  notice: 'offer' | 'local-only' | null
  /** 답에 실린 문서 초안 종류 — 지식 입력·수정 흐름을 찾는 데 쓴다 */
  action: 'edit' | 'new' | null
  report: ChatLogReport | null
}

/** 내 대화 기록에 내보내는 모양 — 엔진·응답 시간·실패 코드 같은 운영 정보는 뺀다 */
export type MyChatLogItem = Pick<
  ChatLogRecord,
  'id' | 'chatId' | 'turnId' | 'at' | 'mode' | 'status' | 'q' | 'a' | 'aCut' | 'sources'
> & { report: Pick<ChatLogReport, 'title' | 'summary' | 'type' | 'sources' | 'gaps' | 'external'> | null }

export type ChatTurnOutcome =
  | { status: 'ok'; response: AskResponse }
  | { status: 'fail'; errorCode: string; mode: 'qa' | 'report' }
  | { status: 'cancelled'; mode: 'qa' | 'report' }

export interface ChatTurnEntry {
  where: ChatLogWhere
  /** 없으면 저장하지 않는다 — 누가 물었는지 모르는 기록은 남기지 않는다 */
  loginId: string | null
  input: AskInput
  intent: ReportIntent['mode']
  engine: ChatLogEngine
  model?: string | null
  startedAt: number
  outcome: ChatTurnOutcome
}

/* ── 자르기 규칙 ───────────────────────────────────────── */

const MAX_ANSWER = 1500
const MAX_SUMMARY = 300
const MAX_SOURCES = 10
const MAX_PATH = 200
const MAX_EXTERNAL = 10
const MAX_SEARCH = 10
const MAX_GAPS = 8
const MAX_GAP = 120
const MAX_TITLE = 200

const cut = (v: unknown, max: number) => String(v ?? '').slice(0, max)
const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.slice(0, n).map((x) => cut(x, max)) : [])
const ERROR_CODE_RE = /^[a-z][a-z-]{0,23}$/

/** 응답·입력에서 기록 한 건을 만든다 — 네트워크 없이 도는 순수 함수(크기 점검에도 쓴다) */
export function buildChatRecord(entry: ChatTurnEntry, now = Date.now()): ChatLogRecord {
  const { input, outcome } = entry
  const base = {
    id: `cl_${randomBytes(8).toString('hex')}`,
    chatId: input.chatId ?? null,
    turnId: input.turnId ?? null,
    loginId: entry.loginId ?? '',
    where: entry.where,
    at: new Date(entry.startedAt).toISOString(),
    ms: Math.max(0, now - entry.startedAt),
    engine: entry.engine,
    model: entry.model ? cut(entry.model, 60) : null,
    intent: entry.intent,
    modeOverride: input.modeOverride ?? null,
    via: input.via ?? null,
    q: input.query,
  }
  if (outcome.status !== 'ok') {
    return {
      ...base,
      mode: outcome.mode,
      status: outcome.status,
      errorCode: outcome.status === 'fail' ? (ERROR_CODE_RE.test(outcome.errorCode) ? outcome.errorCode : 'unknown') : null,
      a: '',
      aCut: false,
      sources: [],
      noSource: false,
      notice: null,
      action: null,
      report: null,
    }
  }
  const r = outcome.response
  const sources = list(r.sourcePaths, MAX_SOURCES, MAX_PATH)
  const text = r.mode === 'report' ? '' : String(r.text ?? '')
  const report = r.mode === 'report' ? r.report : null
  return {
    ...base,
    mode: r.mode,
    status: 'ok',
    errorCode: null,
    a: text.slice(0, MAX_ANSWER),
    aCut: text.length > MAX_ANSWER,
    sources,
    // 리포트 안내(report-unavailable)는 정해진 안내 문구라 근거 없음으로 세지 않는다
    noSource: r.mode === 'qa' && sources.length === 0,
    notice: r.mode === 'qa' ? (r.reportHint ?? null) : null,
    action: r.action?.type === 'edit' || r.action?.type === 'new' ? r.action.type : null,
    report: report
      ? {
          title: cut(report.title, MAX_TITLE),
          summary: cut(report.summary, MAX_SUMMARY),
          type: report.reportType,
          sources: list(report.sourcePaths, MAX_SOURCES, MAX_PATH),
          external: (report.externalSources ?? [])
            .slice(0, MAX_EXTERNAL)
            .map((s) => ({ title: cut(s.title, MAX_TITLE), url: cut(s.url, 500) })),
          searchQueries: list(report.searchQueries, MAX_SEARCH, MAX_TITLE),
          gaps: list(report.gaps, MAX_GAPS, MAX_GAP),
          webSearch: Boolean(report.webSearch),
          webSearchOff: report.webSearchOff ?? null,
          masked: { amount: report.masked?.amount ?? 0, name: report.masked?.name ?? 0 },
          warnings: report.warnings?.length ?? 0,
          chars: String(report.markdown ?? '').length,
        }
      : null,
  }
}

/* ── 키 ───────────────────────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000
// 날짜별 건수는 보관 기간(최대 365일)보다 조금 길게 — 사용량 표가 보관 기간 끝까지 보이게
const COUNT_TTL_SECONDS = 400 * 24 * 60 * 60

const KEY_ALL = 'hub:chatlog:all'
const KEY_NOSOURCE = 'hub:chatlog:flag:nosource'
const KEY_FAIL = 'hub:chatlog:flag:fail'
const keyRec = (id: string) => `hub:chatlog:rec:${id}`
const keyUser = (loginId: string) => `hub:chatlog:user:${loginId}`
const keyCount = (day: string) => `hub:chatlog:n:${day}`
const keyOver = (day: string) => `hub:chatlog:over:${day}`
/** 날짜별 엔진·결과 건수 HASH — 필드 "<engine>:<status>". 상한을 넘은 시도도 센다(엔진 비교용) */
const keyEngine = (day: string) => `hub:chatlog:eng:${day}`

/** 날짜 구분은 KST — server/knowledge.ts todayIso 와 같은 기준 */
export const kstDay = (ms: number) => new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
const kstStart = (day: string) => Date.parse(`${day}T00:00:00+09:00`)

export const isChatLogId = (id: unknown): id is string => typeof id === 'string' && /^cl_[0-9a-f]{16}$/.test(id)

/* ── 저장 ─────────────────────────────────────────────── */

/** 저장을 기다리는 상한 — 배포는 응답 전에 이만큼까지 기다린다(D6) */
const SAVE_TIMEOUT_MS = 1000

/** 기록이 켜져 있는지 — 저장소 설정이 있을 때만. 배포는 계정 기능도 켜져 있어야 한다(api/chatlog.ts) */
export const chatLogStoreConnected = (env: Env = process.env) => storeConnected(env)

export const chatLogConfig = (env: Env = process.env) => ({ days: readChatLogDays(env), cap: readChatLogDailyCap(env) })

function failKind(err: unknown): string {
  const name = (err as { name?: string })?.name
  if (name === 'TimeoutError' || name === 'AbortError') return '시간 초과'
  if (err instanceof TypeError) return '연결 실패'
  if (err instanceof Error && /오류 —/.test(err.message)) return '저장소 거절'
  return '알 수 없음'
}

/**
 * 날짜 건수를 먼저 올려 상한을 본 뒤(HTTP 1회), 기록과 색인을 한 번에 보낸다(HTTP 1회, pipeline).
 * 상한을 넘으면 내용 없이 초과 건수만 센다(D2)
 */
async function saveRecord(record: ChatLogRecord, env: Env, signal: AbortSignal): Promise<void> {
  const { days, cap } = chatLogConfig(env)
  const score = Date.parse(record.at)
  const day = kstDay(score)
  const n = await redis<number>(['INCR', keyCount(day)], env, { signal })
  // 엔진 건수는 EXPIRE 보다 먼저 — 없는 키에 건 EXPIRE 는 아무 일도 하지 않는다
  const cmds: RedisCommand[] = [['HINCRBY', keyEngine(day), `${record.engine}:${record.status}`, 1]]
  if (n === 1) {
    // 그날 첫 저장 때 한 번 — 색인 ZSET 은 항목별 만료가 없어 보관 기간 지난 항목을 여기서 지운다
    const oldest = `(${score - days * DAY_MS}`
    cmds.push(
      ['EXPIRE', keyCount(day), COUNT_TTL_SECONDS],
      ['EXPIRE', keyEngine(day), COUNT_TTL_SECONDS],
      ['ZREMRANGEBYSCORE', KEY_ALL, '-inf', oldest],
      ['ZREMRANGEBYSCORE', KEY_NOSOURCE, '-inf', oldest],
      ['ZREMRANGEBYSCORE', KEY_FAIL, '-inf', oldest],
    )
  }
  if (n > cap) {
    cmds.push(['INCR', keyOver(day)])
    if (n === cap + 1) cmds.push(['EXPIRE', keyOver(day), COUNT_TTL_SECONDS])
    await redisPipeline(cmds, env, { signal })
    return
  }
  const ttl = days * 24 * 60 * 60
  cmds.push(
    ['SET', keyRec(record.id), JSON.stringify(record), 'EX', ttl],
    ['ZADD', KEY_ALL, score, record.id],
    ['ZADD', keyUser(record.loginId), score, record.id],
    ['EXPIRE', keyUser(record.loginId), ttl],
  )
  if (record.noSource) cmds.push(['ZADD', KEY_NOSOURCE, score, record.id])
  if (record.status !== 'ok') cmds.push(['ZADD', KEY_FAIL, score, record.id])
  await redisPipeline(cmds, env, { signal })
}

/**
 * 턴 기록 저장 — 절대 throw 하지 않는다. 저장소 설정이 없거나 누가 물었는지 모르면 아무것도 하지 않는다(경고도 없음).
 * 실패하면 분류 한 줄만 남긴다. 질문·답 원문과 저장소 응답 본문은 로그에 쓰지 않는다
 */
export async function recordChatTurn(entry: ChatTurnEntry, env: Env = process.env): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    if (!entry.loginId || !readRedis(env)) return
    const record = buildChatRecord(entry)
    const save = saveRecord(record, env, AbortSignal.timeout(SAVE_TIMEOUT_MS)).then(
      () => null,
      (err: unknown) => failKind(err),
    )
    // fetch 가 신호를 늦게 받아도 답 경로는 상한만큼만 기다린다
    const deadline = new Promise<string>((done) => {
      timer = setTimeout(() => done('시간 초과'), SAVE_TIMEOUT_MS + 50)
    })
    const problem = await Promise.race([save, deadline])
    if (problem) console.warn(`[chatlog] 저장 실패 — ${problem}`)
  } catch (err) {
    console.warn(`[chatlog] 저장 실패 — ${failKind(err)}`)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/* ── 조회 ─────────────────────────────────────────────── */

/** 한 쪽 건수 상한 — 대량 내려받기를 막으려고 한 번에 200건을 넘겨 돌려주는 경로는 두지 않는다 */
export const PAGE_SIZE = 50
/** 엔진·모드 같은 필터를 걸 때 한 번에 훑는 색인 수 — 다 못 채우면 다음 커서로 이어 본다 */
const SCAN_LIMIT = 200
const DEFAULT_RANGE_DAYS = 7

export const DEPLOY_ONLY_TEXT = '대화 기록은 배포 허브에서 볼 수 있어요'

export interface ChatLogFilter {
  /** 시작·끝 시각(ms, 끝 포함) */
  from: number
  to: number
  user?: string
  engine?: ChatLogEngine
  mode?: ChatLogMode
  status?: ChatLogStatus
  noSource?: boolean
  chatId?: string
  cursor?: string
  limit: number
}

export interface ChatLogPage<T> {
  items: T[]
  /** 다음 쪽이 있을 수 있으면 커서, 끝이면 null. 필터가 있으면 items 가 비어도 커서가 올 수 있다 */
  nextCursor: string | null
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const ENGINES: ChatLogEngine[] = ['claude', 'codex', 'gemini']
const MODES: ChatLogMode[] = ['qa', 'report', 'report-unavailable']
const STATUSES: ChatLogStatus[] = ['ok', 'fail', 'cancelled']
const pick = <T extends string>(v: string | null, allowed: T[]): T | undefined =>
  v && (allowed as string[]).includes(v) ? (v as T) : undefined

/** 관리자 조회 쿼리 — 기간은 KST 날짜(YYYY-MM-DD). 기본 최근 7일, 보관 기간보다 앞은 자른다. 모르는 값은 버린다 */
export function parseChatLogFilter(params: URLSearchParams, env: Env = process.env, now = Date.now()): ChatLogFilter {
  const { days } = chatLogConfig(env)
  const today = kstDay(now)
  const toDay = params.get('to') ?? ''
  const fromDay = params.get('from') ?? ''
  // 같은 대화 보기(chat=) — 대화 한 묶음을 한 번에 보도록 기간 기본값을 보관 기간 전체로, 한 쪽을 200건까지 연다
  const chatId = params.get('chat') ?? params.get('chatId') ?? ''
  const byChat = LOG_ID_RE.test(chatId)
  const to = DAY_RE.test(toDay) && kstStart(toDay) ? kstStart(toDay) + DAY_MS - 1 : kstStart(today) + DAY_MS - 1
  const from =
    DAY_RE.test(fromDay) && kstStart(fromDay)
      ? kstStart(fromDay)
      : byChat
        ? 0
        : kstStart(today) - (DEFAULT_RANGE_DAYS - 1) * DAY_MS
  const limit = Number(params.get('limit'))
  const maxLimit = byChat ? SCAN_LIMIT : PAGE_SIZE
  const user = params.get('user')?.trim().toLowerCase()
  return {
    from: Math.max(from, now - days * DAY_MS),
    to,
    ...(user && /^[a-z0-9._:-]{3,80}$/.test(user) ? { user } : {}),
    ...(pick(params.get('engine'), ENGINES) ? { engine: pick(params.get('engine'), ENGINES) } : {}),
    ...(pick(params.get('mode'), MODES) ? { mode: pick(params.get('mode'), MODES) } : {}),
    ...(pick(params.get('status'), STATUSES) ? { status: pick(params.get('status'), STATUSES) } : {}),
    ...(params.get('noSource') === '1' ? { noSource: true } : {}),
    ...(byChat ? { chatId } : {}),
    ...(params.get('cursor') ? { cursor: params.get('cursor')! } : {}),
    limit: Number.isInteger(limit) && limit >= 1 ? Math.min(limit, maxLimit) : maxLimit,
  }
}

const LOG_ID_RE = /^[a-zA-Z0-9-]{8,64}$/
/** 같은 질문의 시도 묶음 키 — turnId 는 chatId 와 함께 볼 때만 유일하다 */
const turnKey = (r: Pick<ChatLogRecord, 'chatId' | 'turnId' | 'loginId'>) =>
  r.turnId ? `${r.loginId}|${r.chatId ?? ''}|${r.turnId}` : null
/** 한 질문의 엔진 넘기기 시도가 퍼져 있을 수 있는 시간 — 리포트 제한 시간(최대 6분)을 엔진 몇 번 넘겨도 들어가게 */
const TURN_WINDOW_MS = 30 * 60 * 1000

/** 커서 = "<score>_<id>". 같은 시각(ms) 기록이 쪽 경계에 걸려도 빠지거나 겹치지 않게 id 까지 본다 */
function readCursor(raw: string | undefined): { score: number; id: string } | null {
  const m = /^(\d{1,16})_(cl_[0-9a-f]{16})$/.exec(raw ?? '')
  return m ? { score: Number(m[1]), id: m[2] } : null
}
const makeCursor = (score: number, id: string) => `${score}_${id}`

/** 색인을 최신순으로 훑어 [id, score] 를 돌려준다. 커서보다 앞(이미 본 것)은 뺀다 */
async function scanIndex(
  key: string,
  min: number,
  max: number,
  cursor: string | undefined,
  count: number,
  env: Env,
): Promise<{ pairs: [string, number][]; more: boolean }> {
  const at = readCursor(cursor)
  const top = at ? Math.min(at.score, max) : max
  // 커서 점수를 포함해 읽으므로 이미 보낸 커서 기록 한 건만큼 더 읽는다
  const want = at ? count + 1 : count
  const raw = (await redis<string[]>(['ZREVRANGEBYSCORE', key, top, min, 'WITHSCORES', 'LIMIT', 0, want], env)) ?? []
  let pairs: [string, number][] = []
  for (let i = 0; i + 1 < raw.length; i += 2) pairs.push([raw[i], Number(raw[i + 1])])
  // 꽉 채워 왔으면 뒤에 더 있을 수 있다
  const full = pairs.length === want
  // 같은 점수는 member 역순으로 온다 — 커서 id 이상이면 앞 쪽에서 이미 보냈다
  if (at) pairs = pairs.filter(([id, s]) => !(s === at.score && id >= at.id))
  const more = full || pairs.length > count
  return { pairs: pairs.slice(0, count), more }
}

async function readRecords(ids: string[], env: Env): Promise<(ChatLogRecord | null)[]> {
  if (ids.length === 0) return []
  const raws = (await redis<(string | null)[]>(['MGET', ...ids.map(keyRec)], env)) ?? []
  return raws.map((r) => {
    if (!r) return null // 기록 본문이 먼저 만료됐거나 지워졌다
    try {
      return JSON.parse(r) as ChatLogRecord
    } catch {
      return null
    }
  })
}

/**
 * 관리자 전체 조회. 화면은 질문(turnId) 단위로 묶어 보여 주므로, 시도 단위 조건(엔진·모드·결과·근거 없음)은
 * "그 질문의 시도 가운데 하나라도 맞으면"이다 — 맞은 시도를 찾은 뒤 같은 질문의 나머지 시도를 함께 실어 보낸다.
 * 명령 2개(색인 1 + MGET 1), 시도 단위 조건이 있으면 4개(+ 앞뒤 시간 색인 1 + MGET 1)
 */
export async function listChatLog(filter: ChatLogFilter, env: Env = process.env): Promise<ChatLogPage<ChatLogRecord>> {
  const page = await listMatched(filter, env)
  const byAttempt = Boolean(filter.engine || filter.mode || filter.status || filter.noSource)
  const turns = new Set(page.items.map(turnKey).filter((k): k is string => Boolean(k)))
  if (!byAttempt || turns.size === 0) return page

  const seen = new Set(page.items.map((r) => r.id))
  const scores = page.items.map((r) => Date.parse(r.at))
  const raw = (await redis<string[]>(
    ['ZREVRANGEBYSCORE', KEY_ALL, Math.max(...scores) + TURN_WINDOW_MS, Math.min(...scores) - TURN_WINDOW_MS, 'LIMIT', 0, SCAN_LIMIT],
    env,
  )) ?? []
  const siblings = (await readRecords(raw.filter((id) => !seen.has(id)), env)).filter(
    (r): r is ChatLogRecord => Boolean(r) && turns.has(turnKey(r!) ?? ''),
  )
  // 한 번에 200건을 넘기지 않는다
  const items = [...page.items, ...siblings.slice(0, SCAN_LIMIT - page.items.length)].sort((a, b) => b.at.localeCompare(a.at))
  return { items, nextCursor: page.nextCursor }
}

/** 색인에서 조건에 맞는 시도만 — 근거 없음·실패는 전용 색인, 나머지 조건은 읽은 뒤 서버에서 거른다 */
async function listMatched(filter: ChatLogFilter, env: Env): Promise<ChatLogPage<ChatLogRecord>> {
  const key = filter.noSource
    ? KEY_NOSOURCE
    : filter.status === 'fail' || filter.status === 'cancelled'
      ? KEY_FAIL
      : filter.user
        ? keyUser(filter.user)
        : KEY_ALL
  const match = (r: ChatLogRecord) =>
    (!filter.user || r.loginId === filter.user) &&
    (!filter.engine || r.engine === filter.engine) &&
    (!filter.mode || r.mode === filter.mode) &&
    (!filter.status || r.status === filter.status) &&
    (!filter.noSource || r.noSource) &&
    (!filter.chatId || r.chatId === filter.chatId)
  const narrowed = Boolean(filter.engine || filter.mode || filter.status || filter.chatId || (filter.user && key !== keyUser(filter.user)))
  const count = narrowed ? SCAN_LIMIT : filter.limit
  const { pairs, more } = await scanIndex(key, filter.from, filter.to, filter.cursor, count, env)
  const records = await readRecords(pairs.map(([id]) => id), env)

  const items: ChatLogRecord[] = []
  for (let i = 0; i < pairs.length; i++) {
    const r = records[i]
    if (!r || !match(r)) continue
    items.push(r)
    if (items.length === filter.limit) {
      const rest = i < pairs.length - 1 || more
      return { items, nextCursor: rest ? makeCursor(pairs[i][1], pairs[i][0]) : null }
    }
  }
  const last = pairs[pairs.length - 1]
  return { items, nextCursor: last && more ? makeCursor(last[1], last[0]) : null }
}

const toMine = (r: ChatLogRecord): MyChatLogItem => ({
  id: r.id,
  chatId: r.chatId,
  turnId: r.turnId,
  at: r.at,
  mode: r.mode,
  status: r.status,
  q: r.q,
  a: r.a,
  aCut: r.aCut,
  sources: r.sources,
  report: r.report
    ? { title: r.report.title, summary: r.report.summary, type: r.report.type, sources: r.report.sources, gaps: r.report.gaps, external: r.report.external }
    : null,
})

/** 본인 기록 — 첫 쪽에서 보관 기간 지난 색인을 정리한다. 명령 2~3개 */
export async function listMyChatLog(
  loginId: string,
  cursor: string | undefined,
  env: Env = process.env,
  now = Date.now(),
): Promise<ChatLogPage<MyChatLogItem>> {
  const { days } = chatLogConfig(env)
  const min = now - days * DAY_MS
  if (!cursor) await redis(['ZREMRANGEBYSCORE', keyUser(loginId), '-inf', `(${min}`], env)
  const { pairs, more } = await scanIndex(keyUser(loginId), min, now + DAY_MS, cursor, PAGE_SIZE, env)
  const records = await readRecords(pairs.map(([id]) => id), env)
  // 색인이 본인 것이어도 한 번 더 본다 — 다른 계정 기록이 섞여 나가는 일이 없게
  const items = records.filter((r): r is ChatLogRecord => Boolean(r) && r!.loginId === loginId).map(toMine)
  const last = pairs[pairs.length - 1]
  return { items, nextCursor: last && more ? makeCursor(last[1], last[0]) : null }
}

/* ── 사용량 ───────────────────────────────────────────── */

/** 용량·명령 수 추정 기준 — 기획서 2절. Upstash 콘솔 실측과 맞춰 보는 값이다 */
const AVG_RECORD_BYTES = 2500
const STORAGE_LIMIT_BYTES = 256 * 1024 * 1024
const MONTH_COMMAND_LIMIT = 500_000
/** 질문 1건이 이미 쓰는 명령(세션 GET·호출 횟수 INCR/EXPIRE) + 저장 1건(6~7, 평균 6.5) / 상한 초과 1건(3) */
const CMD_PER_ASK = 3
const CMD_PER_STORED = 6.5
const CMD_PER_OVER = 3
/** 엔진 비교 칸이 보는 날 수 */
const ENGINE_DAYS = 7

export interface ChatLogEngineUsage {
  engine: ChatLogEngine
  /** 최근 7일(KST, 오늘 포함) 시도 건수 — 상한을 넘어 내용 없이 센 시도도 들어간다 */
  attempts: number
  fail: number
  cancelled: number
}

export interface ChatLogDailyUsage {
  date: string
  /** 그날 저장을 시도한 건수 — hub:chatlog:n:<날짜> 값 */
  attempts: number
  stored: number
  /** 상한을 넘어 내용 없이 건수만 센 수 */
  over: number
}

export interface ChatLogUsage {
  retentionDays: number
  dailyCap: number
  today: ChatLogDailyUsage
  /** 최신 날짜부터 보관 기간만큼 */
  daily: ChatLogDailyUsage[]
  /** 보관 중인 기록 수(전체 색인 크기) */
  records: number
  estimatedBytes: number
  storageLimitBytes: number
  /** 이번 달(KST) 추정 명령 수 — 기록이 남은 질문 기준. 페이지 열 때의 로그인 확인은 빠져 있다 */
  estimatedMonthCommands: number
  monthCommandLimit: number
  /** 엔진별 최근 7일 시도·실패·취소 — claude·codex·gemini 순서, 없으면 0 */
  engines7d: ChatLogEngineUsage[]
}

/** 사용량 — pipeline 1회, 명령 10개(MGET 건수 · MGET 초과 · ZCARD · 최근 7일 엔진 HGETALL 7) */
export async function chatLogUsage(env: Env = process.env, now = Date.now()): Promise<ChatLogUsage> {
  const { days, cap } = chatLogConfig(env)
  const dates = Array.from({ length: days }, (_, i) => kstDay(now - i * DAY_MS))
  const engineDates = Array.from({ length: ENGINE_DAYS }, (_, i) => kstDay(now - i * DAY_MS))
  const [counts, overs, total, ...engineHashes] = await redisPipeline<[(string | null)[], (string | null)[], number, ...unknown[]]>(
    [
      ['MGET', ...dates.map(keyCount)],
      ['MGET', ...dates.map(keyOver)],
      ['ZCARD', KEY_ALL],
      ...engineDates.map((d): RedisCommand => ['HGETALL', keyEngine(d)]),
    ],
    env,
  )
  const engines7d: ChatLogEngineUsage[] = ENGINES.map((engine) => ({ engine, attempts: 0, fail: 0, cancelled: 0 }))
  for (const h of engineHashes) {
    for (const [field, value] of hashEntries(h)) {
      const [engine, status] = field.split(':')
      const row = engines7d.find((e) => e.engine === engine)
      const n = Number(value) || 0
      if (!row || !(STATUSES as string[]).includes(status)) continue
      row.attempts += n
      if (status === 'fail') row.fail += n
      if (status === 'cancelled') row.cancelled += n
    }
  }
  const daily = dates.map((date, i) => {
    const attempts = Number(counts?.[i]) || 0
    const over = Math.min(Number(overs?.[i]) || 0, attempts)
    return { date, attempts, stored: attempts - over, over }
  })
  const month = dates[0].slice(0, 7)
  const monthCommands = daily
    .filter((d) => d.date.startsWith(month))
    .reduce((sum, d) => sum + d.attempts * CMD_PER_ASK + d.stored * CMD_PER_STORED + d.over * CMD_PER_OVER, 0)
  const records = Number(total) || 0
  return {
    retentionDays: days,
    dailyCap: cap,
    today: daily[0],
    daily,
    records,
    estimatedBytes: records * AVG_RECORD_BYTES,
    storageLimitBytes: STORAGE_LIMIT_BYTES,
    estimatedMonthCommands: Math.round(monthCommands),
    monthCommandLimit: MONTH_COMMAND_LIMIT,
    engines7d,
  }
}

/** HGETALL 결과 — Upstash REST 는 [필드, 값, 필드, 값…] 배열로 준다. 객체로 오는 경우도 받는다 */
function hashEntries(h: unknown): [string, string][] {
  if (Array.isArray(h)) {
    const out: [string, string][] = []
    for (let i = 0; i + 1 < h.length; i += 2) out.push([String(h[i]), String(h[i + 1])])
    return out
  }
  return h && typeof h === 'object' ? Object.entries(h as Record<string, unknown>).map(([k, v]) => [k, String(v)]) : []
}

/* ── 삭제 (관리자만, D4) ──────────────────────────────── */

/**
 * 질문 하나를 지운다 — 고른 기록과 같은 질문(turnId)의 시도를 모두 함께 지운다. 질문 원문이 시도마다 들어 있어
 * 일부만 지우면 원문이 남기 때문이다(ux 문서 8절 P-2). turnId 가 없는 기록은 그 한 건만.
 * 지운 기록 id 를 돌려준다 — 명령 GET 1 + (같은 질문 찾기 ZREVRANGEBYSCORE 1 + MGET 1) + pipeline(시도마다 DEL·ZREM 4)
 */
export async function deleteChatTurn(id: string, env: Env = process.env): Promise<string[]> {
  const raw = await redis<string | null>(['GET', keyRec(id)], env)
  let target: ChatLogRecord | null = null
  try {
    target = raw ? (JSON.parse(raw) as ChatLogRecord) : null
  } catch {
    target = null
  }
  const victims: { id: string; loginId: string }[] = [{ id, loginId: target?.loginId ?? '' }]
  const key = target ? turnKey(target) : null
  if (target && key) {
    // 같은 질문의 시도는 같은 사람·가까운 시각에 몰려 있다 — 본인 색인에서 앞뒤 시간만 훑는다
    const at = Date.parse(target.at)
    const ids = (await redis<string[]>(
      ['ZREVRANGEBYSCORE', keyUser(target.loginId), at + TURN_WINDOW_MS, at - TURN_WINDOW_MS, 'LIMIT', 0, SCAN_LIMIT],
      env,
    )) ?? []
    const others = ids.filter((x) => x !== id)
    for (const r of await readRecords(others, env)) if (r && turnKey(r) === key) victims.push({ id: r.id, loginId: r.loginId })
  }
  const cmds: RedisCommand[] = victims.flatMap((v): RedisCommand[] => [
    ['DEL', keyRec(v.id)],
    ['ZREM', KEY_ALL, v.id],
    ['ZREM', KEY_NOSOURCE, v.id],
    ['ZREM', KEY_FAIL, v.id],
    ...(v.loginId ? [['ZREM', keyUser(v.loginId), v.id] as RedisCommand] : []),
  ])
  await redisPipeline(cmds, env)
  return target ? victims.map((v) => v.id) : []
}
