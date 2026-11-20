import type { Engine, ReportType } from '../types'

/**
 * 챗봇 대화 기록 조회 — 서버 계약은 server/chatLog.ts·api/chatlog.ts (PR #95).
 * 로컬 허브는 view=status 만 답하고 나머지는 404 deploy-only 다. 화면은 오류 원문을 보이지 않고 console 에만 둔다.
 */

export type ChatLogMode = 'qa' | 'report' | 'report-unavailable'
export type ChatLogStatusCode = 'ok' | 'fail' | 'cancelled'

export interface ChatLogStatus {
  /** 이 허브가 대화를 저장하는지 — 챗봇 창 고지를 이 값으로 고른다 */
  enabled: boolean
  retentionDays: number
  where: 'deploy' | 'local'
  /** 이 허브에서 본인 기록을 볼 수 있는지 — 메뉴·"지난 대화"를 이 값으로 고른다 */
  mine: boolean
}

export interface ChatLogReport {
  title: string
  summary: string
  type: ReportType
  sources: string[]
  external: { title: string; url: string }[]
  searchQueries: string[]
  gaps: string[]
  webSearch: boolean
  webSearchOff: 'engine' | 'terms' | 'type' | null
  masked: { amount: number; name: number }
  warnings: number
  chars: number
}

/** 관리자 조회의 기록 1건 = 엔진 1회 시도 */
export interface ChatLogRecord {
  id: string
  chatId: string | null
  turnId: string | null
  loginId: string
  where: 'deploy' | 'local'
  at: string
  ms: number
  engine: Engine
  model: string | null
  mode: ChatLogMode
  intent: 'qa' | 'offer' | 'report'
  modeOverride: 'qa' | 'report' | null
  via: string | null
  status: ChatLogStatusCode
  errorCode: string | null
  q: string
  a: string
  aCut: boolean
  sources: string[]
  noSource: boolean
  notice: 'offer' | 'local-only' | null
  action: 'edit' | 'new' | null
  report: ChatLogReport | null
}

/** 내 대화 기록 — 엔진·응답 시간·실패 코드는 서버가 싣지 않는다 */
export interface MyChatLogItem {
  id: string
  chatId: string | null
  turnId: string | null
  at: string
  mode: ChatLogMode
  status: ChatLogStatusCode
  q: string
  a: string
  aCut: boolean
  sources: string[]
  report: Pick<ChatLogReport, 'title' | 'summary' | 'type' | 'sources' | 'gaps' | 'external'> | null
}

export interface ChatLogPage<T> {
  items: T[]
  nextCursor: string | null
}

export interface ChatLogDailyUsage {
  date: string
  attempts: number
  stored: number
  over: number
}

export interface ChatLogUsage {
  retentionDays: number
  dailyCap: number
  today: ChatLogDailyUsage
  daily: ChatLogDailyUsage[]
  records: number
  estimatedBytes: number
  storageLimitBytes: number
  estimatedMonthCommands: number
  monthCommandLimit: number
  engines7d: { engine: Engine; attempts: number; fail: number; cancelled: number }[]
}

/** 상태 코드로 화면 안내를 고른다 — 401 로그인 풀림, 403 관리자 아님, 404 deploy-only(내 PC용 허브) */
export class ChatLogError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string,
  ) {
    super(message)
  }
}

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  let res: Response
  try {
    res = await fetch(input, { cache: 'no-store', ...init })
  } catch (err) {
    throw new ChatLogError(0, null, (err as Error).message)
  }
  // 로컬 허브에 경로가 없으면 화면(HTML)이 돌아온다 — 기록을 볼 수 없는 곳으로 본다
  if (!res.headers.get('content-type')?.includes('application/json')) throw new ChatLogError(404, 'deploy-only', 'JSON 이 아닌 응답')
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; code?: string }
  if (!res.ok) throw new ChatLogError(res.status, data.code ?? null, data.error || `HTTP ${res.status}`)
  return data
}

/** 앱이 열릴 때 한 번 — 실패하면 null 이고 메뉴·고지·"지난 대화"를 모두 숨긴다 */
export async function fetchChatLogStatus(): Promise<ChatLogStatus | null> {
  try {
    const s = await call<Partial<ChatLogStatus>>('/api/chatlog?view=status')
    if (typeof s.enabled !== 'boolean') return null
    return {
      enabled: s.enabled,
      retentionDays: Number(s.retentionDays) || 90,
      where: s.where === 'local' ? 'local' : 'deploy',
      mine: s.mine === true,
    }
  } catch (err) {
    console.info('[chatlog] 저장 상태를 읽지 못했습니다:', (err as Error).message)
    return null
  }
}

export const fetchMyChatLog = (cursor?: string | null) =>
  call<ChatLogPage<MyChatLogItem>>(`/api/chatlog?view=mine${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`)

export interface ChatLogQuery {
  from?: string
  to?: string
  user?: string
  engine?: Engine
  mode?: ChatLogMode
  status?: ChatLogStatusCode
  noSource?: boolean
  chat?: string
  limit?: number
  cursor?: string | null
}

export function fetchChatLog(q: ChatLogQuery) {
  const params = new URLSearchParams({ view: 'all' })
  for (const [k, v] of Object.entries(q)) {
    if (v === undefined || v === null || v === '' || v === false) continue
    params.set(k, v === true ? '1' : String(v))
  }
  return call<ChatLogPage<ChatLogRecord>>(`/api/chatlog?${params}`)
}

export const fetchChatLogUsage = () => call<ChatLogUsage>('/api/chatlog?view=usage')

/** 질문 하나 단위로 지운다 — 서버가 같은 질문(turnId)의 시도를 함께 지운다. Content-Type 이 JSON 이어야 받는다 */
export const deleteChatLog = (id: string) =>
  call<{ ok: true; deleted: number; ids: string[] }>(`/api/chatlog?id=${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  })

/* ── 대화·질문 아이디 ───────────────────────────────────── */

/** 서버가 받는 모양(^[a-zA-Z0-9-]{8,64}$) — 맞지 않으면 서버가 버리고 null 로 저장한다 */
export const LOG_ID_RE = /^[a-zA-Z0-9-]{8,64}$/

/** 대화 하나의 아이디 — randomUUID 는 https·localhost 에서만 있어 없으면 난수로 만든다 */
export function makeChatId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/* ── 질문 단위로 묶기 ───────────────────────────────────── */

export interface Turn<T> {
  key: string
  /** 시간순(앞 시도 먼저) */
  attempts: T[]
}

type Keyed = { id: string; chatId: string | null; turnId: string | null; at: string; loginId?: string }

/** 같은 질문의 시도 묶음 키 — turnId 는 chatId 와 함께 볼 때만 유일하다. turnId 가 없으면 한 건이 한 질문 */
const turnKeyOf = (r: Keyed) => (r.turnId ? `${r.loginId ?? ''}|${r.chatId ?? ''}|${r.turnId}` : `id|${r.id}`)

/**
 * 쪽을 이어 붙이며 질문 단위로 묶는다 — 쪽 경계에 걸린 시도는 앞 줄에 합치고, 같은 id 는 하나로 합친다.
 * 줄 순서는 질문 시각(첫 시도) 최신순
 */
export function mergeTurns<T extends Keyed>(prev: Turn<T>[], items: T[]): Turn<T>[] {
  const map = new Map(prev.map((t) => [t.key, { key: t.key, attempts: [...t.attempts] }]))
  for (const item of items) {
    const key = turnKeyOf(item)
    const turn = map.get(key) ?? { key, attempts: [] }
    if (!turn.attempts.some((a) => a.id === item.id)) turn.attempts.push(item)
    map.set(key, turn)
  }
  const turns = [...map.values()]
  for (const t of turns) t.attempts.sort((a, b) => a.at.localeCompare(b.at))
  return turns.sort((a, b) => b.attempts[0].at.localeCompare(a.attempts[0].at))
}

export const lastOf = <T>(t: Turn<T>) => t.attempts[t.attempts.length - 1]

/* ── 시각·길이 표시 (KST) ───────────────────────────────── */

const KST_MS = 9 * 60 * 60 * 1000
const kst = (d: Date | number) => new Date((typeof d === 'number' ? d : d.getTime()) + KST_MS)

/** KST 날짜 YYYY-MM-DD — 서버 기간 쿼리(from·to)와 같은 기준 */
export const kstDay = (at: string | number = Date.now()) =>
  kst(typeof at === 'string' ? new Date(at) : at).toISOString().slice(0, 10)

/** n일 전 KST 날짜 */
export const kstDayAgo = (n: number) => kstDay(Date.now() - n * 24 * 60 * 60 * 1000)

export const kstTime = (at: string) => kst(new Date(at)).toISOString().slice(11, 16)

/** 목록 시각 — 오늘이면 "오늘 14:02", 아니면 "11-18 14:02" */
export function shortAt(at: string): string {
  const day = kstDay(at)
  return `${day === kstDay() ? '오늘' : day.slice(5)} ${kstTime(at)}`
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/** 날짜 묶음 제목 — 오늘 · 어제 · 11월 18일 (화) */
export function dayLabel(day: string): string {
  if (day === kstDay()) return '오늘'
  if (day === kstDayAgo(1)) return '어제'
  const [y, m, d] = day.split('-').map(Number)
  return `${m}월 ${d}일 (${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`
}

/** 걸린 시간 — 60초 미만 "14.2초", 이상 "3분 2초" */
export function formatMs(ms: number): string {
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}초`
  return `${Math.floor(s / 60)}분 ${Math.floor(s % 60)}초`
}

export const MODE_LABEL: Record<ChatLogMode, string> = { qa: '일반', report: '리포트', 'report-unavailable': '리포트 안내' }
export const STATUS_LABEL: Record<ChatLogStatusCode, string> = { ok: '성공', fail: '실패', cancelled: '멈춤' }
