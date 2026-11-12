import { accountsEnabled, countHit, missingSettings, storeConnected, type Account } from './accounts.js'
import { requireUser } from './auth.js'

/**
 * API 입구 공통 검사 — 배포 함수(api/)와 로컬 중계(server/cliBridge.ts)가 같은 판정 함수를 쓴다.
 * 판정 함수는 헤더 값만 받아 거절 사유를 돌려주고, 응답을 만드는 일은 각 쪽이 한다.
 */

type Env = Record<string, string | undefined>

/** 거절 사유 — 배포는 Response 로, 로컬은 res 로 같은 상태·문구를 내보낸다. code 는 화면이 안내 문구를 고르는 데 쓴다 */
export interface Rejection {
  status: number
  error: string
  code?: 'maintenance' | 'rate'
}

export const MAINTENANCE_TEXT = '허브 점검 중이에요. 잠시 뒤 다시 시도해 주세요'
export const RATE_TEXT = '요청이 잠깐 많았어요. 잠시 뒤 다시 시도해 주세요'
const FORBIDDEN: Rejection = { status: 403, error: '허용되지 않은 요청입니다' }
const BAD_TYPE: Rejection = { status: 415, error: '요청 형식이 올바르지 않습니다' }
export const TOO_LARGE: Rejection = { status: 413, error: '보내는 내용이 너무 커요. 내용을 줄여 다시 시도해 주세요' }
const BAD_JSON: Rejection = { status: 400, error: '요청 형식이 올바르지 않습니다' }

/* ── 판정 함수 (배포·로컬 공용) ─────────────────────────── */

/** 로컬 허브 화면의 출처 — 실행기·vite.config.ts 가 5173 으로 고정한다 */
export const LOCAL_HUB_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173']

/** 'null'·깨진 값은 new URL 이 예외를 던진다 — 500 이 아니라 거절로 다룬다 */
function parseOrigin(raw: string): URL | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

/**
 * 쓰기 요청(POST·PATCH)의 출처 — Origin, 없으면 Referer 로 본다. 둘 다 없거나 읽을 수 없으면 거절한다.
 * 브라우저는 같은 출처 POST 에도 Origin 을 싣기 때문에, 헤더가 없다는 건 브라우저 밖에서 만든 요청이다
 */
export function writeOriginProblem(
  origin: string | null | undefined,
  referer: string | null | undefined,
  allowed: (url: URL) => boolean,
): Rejection | null {
  const raw = origin || referer
  if (!raw) return FORBIDDEN
  const url = parseOrigin(raw)
  return url && allowed(url) ? null : FORBIDDEN
}

/**
 * 읽기 요청(GET)의 출처 — 같은 출처 GET 에는 Origin 이 실리지 않아 없으면 통과시킨다.
 * 다른 사이트가 링크·이미지로 부르면 브라우저가 Sec-Fetch-Site 를 cross-site 로 실어 보내므로 그때 막는다
 */
export function readOriginProblem(
  origin: string | null | undefined,
  fetchSite: string | null | undefined,
  allowed: (url: URL) => boolean,
): Rejection | null {
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return FORBIDDEN
  if (!origin) return null
  const url = parseOrigin(origin)
  return url && allowed(url) ? null : FORBIDDEN
}

/** 본문은 JSON 만, 선언된 길이가 상한을 넘으면 읽기 전에 거절한다. 길이를 숨긴 본문은 읽으면서 다시 자른다(readLimited) */
export function bodyHeaderProblem(
  contentType: string | null | undefined,
  contentLength: string | null | undefined,
  maxBytes: number,
): Rejection | null {
  // text/plain 은 다른 사이트가 사전 확인 없이 보낼 수 있는 형식이라 받지 않는다
  if (contentType?.split(';')[0].trim().toLowerCase() !== 'application/json') return BAD_TYPE
  if (contentLength) {
    const n = Number(contentLength)
    if (!Number.isFinite(n) || n < 0 || n > maxBytes) return TOO_LARGE
  }
  return null
}

/** 운영 배포인데 계정 기능이 꺼졌는지 — 그대로 두면 Gemini 키·GitHub 토큰을 쓰는 경로가 로그인 없이 열린다 */
export function maintenanceProblem(path: string, env: Env = process.env): Rejection | null {
  if (env.VERCEL_ENV !== 'production' || accountsEnabled(env)) return null
  // 원인은 함수 로그에만 — 화면에는 점검 문구만 보인다
  console.error(`[guard] 운영 배포인데 계정 기능이 꺼져 ${path} 를 닫았습니다 — 빠진 설정: ${missingSettings(env).join(', ')}`)
  return { status: 503, error: MAINTENANCE_TEXT, code: 'maintenance' }
}

/* ── 호출 횟수 제한 ─────────────────────────────────────── */

export interface RateRule {
  /** 저장소 키에 들어가는 이름 — 같은 이름이면 횟수를 함께 센다 */
  name: string
  limit: number
  windowSeconds: number
}

// 사람이 화면에서 누르는 속도로는 닿지 않을 만큼 — 넘으면 자동 호출로 본다
export const RATE_ASK: RateRule = { name: 'ask', limit: 10, windowSeconds: 60 }
export const RATE_EDIT: RateRule = { name: 'edit', limit: 10, windowSeconds: 60 }
/** 새 문서·수정 제안은 둘 다 GitHub 에 PR 을 여는 일이라 하루 횟수를 함께 센다 */
export const RATE_PR: RateRule = { name: 'pr', limit: 30, windowSeconds: 24 * 60 * 60 }
export const RATE_DOWNLOAD: RateRule = { name: 'download', limit: 5, windowSeconds: 60 }

/** 배포가 넣어 주는 접속 IP — Vercel 은 이 헤더를 자기 값으로 덮어써서 요청자가 꾸밀 수 없다 */
export function clientIp(forwardedFor: string | null | undefined, realIp: string | null | undefined): string {
  return forwardedFor?.split(',')[0].trim() || realIp?.trim() || 'unknown'
}

/**
 * 계정(없으면 IP)별로 창 안의 호출 횟수를 센다. 저장소가 없으면 세지 않는다 — 운영은 maintenanceProblem 이 이미 닫았고 로컬은 제한하지 않는다.
 * 저장소 오류로는 막지 않는다 — 로그인 확인이 같은 저장소를 쓰므로 저장소가 죽으면 이미 401 이다
 */
export async function rateProblem(rule: RateRule, who: string, env: Env = process.env): Promise<Rejection | null> {
  if (!storeConnected(env)) return null
  try {
    const n = await countHit(`hub:rate:${rule.name}:${who}`, rule.windowSeconds)
    if (n <= rule.limit) return null
    console.warn(`[guard] ${rule.name} 호출 제한 — ${rule.limit}회/${rule.windowSeconds}초 초과`)
    return { status: 429, error: RATE_TEXT, code: 'rate' }
  } catch (err) {
    console.error(`[guard] 호출 횟수를 세지 못했습니다 — ${(err as Error).message}`)
    return null
  }
}

/* ── 배포 함수(api/) 입구 ───────────────────────────────── */

export const rejectionResponse = (r: Rejection) =>
  Response.json(r.code ? { error: r.error, code: r.code } : { error: r.error }, { status: r.status })

/** 웹 스트림 본문을 상한까지만 읽는다. 넘으면 null */
async function readLimited(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel().catch(() => {})
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export interface GuardOptions {
  /** 쓰기 요청 본문의 바이트 상한 — server/knowledge.ts 의 MAX_*_BYTES */
  maxBytes?: number
  /** Gemini 키·GitHub 토큰을 쓰는 경로 — 운영에서 계정 기능이 꺼지면 닫는다 */
  paid?: boolean
  /** 로그인 확인. false 면 건너뛴다(로그인 요청 자체) */
  user?: false | { admin?: boolean; allowPendingPassword?: boolean }
  rate?: RateRule
}

export type GuardResult =
  | { ok: true; account: Account | null; body: unknown; ip: string }
  | { ok: false; response: Response }

/**
 * 배포 함수의 입구. 순서: 점검(503) → 출처(403) → 형식·크기(415·413) → 로그인(401·403) → 호출 횟수(429) → 본문(413·400).
 * 비싼 일(본문 읽기)은 앞의 검사를 다 통과한 뒤에만 한다. GET 은 본문 없이 body 를 undefined 로 돌려준다
 */
export async function guardApi(request: Request, opts: GuardOptions = {}): Promise<GuardResult> {
  const fail = (r: Rejection): GuardResult => ({ ok: false, response: rejectionResponse(r) })
  const h = request.headers
  const url = new URL(request.url, 'http://localhost')
  const sameHost = (o: URL) => o.host === url.host
  const write = request.method !== 'GET' && request.method !== 'HEAD'

  if (opts.paid) {
    const closed = maintenanceProblem(url.pathname)
    if (closed) return fail(closed)
  }

  const origin = write
    ? writeOriginProblem(h.get('origin'), h.get('referer'), sameHost)
    : readOriginProblem(h.get('origin'), h.get('sec-fetch-site'), sameHost)
  if (origin) return fail(origin)

  const maxBytes = opts.maxBytes ?? 0
  if (write) {
    const header = bodyHeaderProblem(h.get('content-type'), h.get('content-length'), maxBytes)
    if (header) return fail(header)
  }

  let account: Account | null = null
  if (opts.user !== false) {
    const auth = await requireUser(request, opts.user ?? {})
    if (!auth.ok) return auth
    account = auth.account
  }

  const ip = clientIp(h.get('x-forwarded-for'), h.get('x-real-ip'))
  if (opts.rate) {
    const limited = await rateProblem(opts.rate, account ? `id:${account.loginId}` : `ip:${ip}`)
    if (limited) return fail(limited)
  }

  if (!write) return { ok: true, account, body: undefined, ip }
  const text = await readLimited(request, maxBytes)
  if (text === null) return fail(TOO_LARGE)
  try {
    return { ok: true, account, body: JSON.parse(text || '{}'), ip }
  } catch {
    return fail(BAD_JSON)
  }
}
