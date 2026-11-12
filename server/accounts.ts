import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * 허브 전용 계정 — 사내 메일 계정은 클라우드 PC에서만 쓸 수 있어, 일반 PC에서 쓰는 허브는 계정을 따로 둔다.
 * 관리자가 계정을 발급하고(초기 비밀번호), 담당자는 첫 로그인 때 비밀번호를 바꾼다.
 *
 * 저장은 Upstash Redis(Vercel Marketplace에서 연결) 한 곳. 연결하면 Vercel이 넣어 주는
 * KV_REST_API_URL / KV_REST_API_TOKEN (또는 UPSTASH_REDIS_REST_URL / _TOKEN) 을 그대로 읽는다.
 */

export type AccountRole = 'member' | 'admin'

export interface Account {
  loginId: string
  name: string
  team: string
  role: AccountRole
  passwordHash: string
  /** 관리자가 발급·초기화한 비밀번호 그대로면 true — 바꾸기 전에는 허브를 열지 않는다 */
  mustChangePassword: boolean
  disabled: boolean
  createdAt: string
}

/** 화면에 내보내는 모양 — 비밀번호 해시는 절대 내보내지 않는다 */
export type PublicAccount = Omit<Account, 'passwordHash'>

export const toPublic = ({ passwordHash: _hash, ...rest }: Account): PublicAccount => rest

type Env = Record<string, string | undefined>

function readRedis(env: Env) {
  const url = (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL)?.trim()
  const token = (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN)?.trim()
  return url && token ? { url: url.replace(/\/$/, ''), token } : null
}

/** 계정 기능을 켤지 — 세션 서명 키와 저장소가 모두 있어야 한다. 하나라도 없으면 지금처럼 데모 계정으로 돈다 */
export function accountsEnabled(env: Env = process.env): boolean {
  return missingSettings(env).length === 0
}

/** 계정 기능을 켜는 데 빠진 설정 이름 — 배포 점검용. 값은 절대 내보내지 않는다 */
export function missingSettings(env: Env = process.env): string[] {
  const missing: string[] = []
  if (!env.HUB_AUTH_SECRET?.trim()) missing.push('HUB_AUTH_SECRET')
  if (!readRedis(env)) missing.push('KV_REST_API_URL / KV_REST_API_TOKEN')
  return missing
}

async function redis<T = unknown>(command: (string | number)[], env: Env = process.env): Promise<T> {
  const conf = readRedis(env)
  if (!conf) throw new Error('계정 저장소(Upstash Redis)가 연결되지 않았습니다')
  const res = await fetch(conf.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${conf.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  })
  const data = (await res.json().catch(() => ({}))) as { result?: T; error?: string }
  if (!res.ok || data.error) throw new Error(`계정 저장소 오류 — ${data.error ?? res.status}`)
  return data.result as T
}

const KEY_IDS = 'hub:accounts'
const keyOf = (loginId: string) => `hub:account:${loginId}`

/** 아이디는 소문자 영문·숫자·점·밑줄·하이픈만 — 대소문자 다른 같은 아이디가 둘 생기지 않게 한다 */
export const normalizeLoginId = (raw: unknown) => String(raw ?? '').trim().toLowerCase()
export const isValidLoginId = (id: string) => /^[a-z0-9._-]{3,32}$/.test(id)

export async function getAccount(loginId: string): Promise<Account | null> {
  const raw = await redis<string | null>(['GET', keyOf(loginId)])
  return raw ? (JSON.parse(raw) as Account) : null
}

export async function saveAccount(account: Account): Promise<void> {
  await redis(['SET', keyOf(account.loginId), JSON.stringify(account)])
  await redis(['SADD', KEY_IDS, account.loginId])
}

export async function listAccounts(): Promise<Account[]> {
  const ids = (await redis<string[]>(['SMEMBERS', KEY_IDS])) ?? []
  if (ids.length === 0) return []
  const raws = await redis<(string | null)[]>(['MGET', ...ids.map(keyOf)])
  return raws
    .filter((r): r is string => Boolean(r))
    .map((r) => JSON.parse(r) as Account)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

/* ── 비밀번호 ───────────────────────────────────────────── */

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(password, salt, 32)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$')
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

/** 새 비밀번호 규칙 — 8자 이상, 영문과 숫자를 함께 */
export function passwordProblem(password: string): string | null {
  if (password.length < 8) return '비밀번호는 8자 이상이어야 합니다'
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) return '비밀번호에 영문과 숫자를 함께 넣어 주세요'
  return null
}

/** 관리자가 발급·초기화할 때 쓰는 임시 비밀번호 — 헷갈리는 글자(0·O·1·l)는 뺀다 */
export function tempPassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz'
  const digits = '23456789'
  const pick = (set: string, n: number) => Array.from(randomBytes(n), (b) => set[b % set.length]).join('')
  return `${pick(letters, 4)}${pick(digits, 4)}`
}

/* ── 로그인 실패 제한 ───────────────────────────────────── */

const MAX_FAILURES = 5
const LOCK_SECONDS = 10 * 60
// 아이디를 바꿔 가며 비밀번호를 맞춰 보는 것을 막는다 — 한 사무실이 같은 IP 를 쓰므로 아이디 기준보다 넉넉하게 둔다
const MAX_IP_FAILURES = 30
const failKey = (loginId: string) => `hub:login-fail:${loginId}`
const ipFailKey = (ip: string) => `hub:login-fail-ip:${ip}`

export async function isLocked(loginId: string, ip: string): Promise<boolean> {
  const [byId, byIp] = await redis<(string | null)[]>(['MGET', failKey(loginId), ipFailKey(ip)])
  return Number(byId) >= MAX_FAILURES || Number(byIp) >= MAX_IP_FAILURES
}

export async function recordFailure(loginId: string, ip: string): Promise<void> {
  await countHit(failKey(loginId), LOCK_SECONDS)
  await countHit(ipFailKey(ip), LOCK_SECONDS)
}

/** 로그인에 성공하면 아이디 기준만 푼다 — IP 기준까지 풀면 아는 계정 하나로 잠금을 계속 되돌릴 수 있다 */
export async function clearFailures(loginId: string): Promise<void> {
  await redis(['DEL', failKey(loginId)])
}

/* ── 호출 횟수 제한 ─────────────────────────────────────── */

/** 저장소가 연결됐는지 — 호출 횟수 제한은 저장소가 있을 때만 건다(server/guard.ts) */
export const storeConnected = (env: Env = process.env) => Boolean(readRedis(env))

/** 키의 횟수를 하나 올리고 올린 뒤 값을 돌려준다. 처음 올릴 때 창 길이만큼 만료를 건다 */
export async function countHit(key: string, windowSeconds: number): Promise<number> {
  const n = await redis<number>(['INCR', key])
  if (n === 1) await redis(['EXPIRE', key, windowSeconds])
  return n
}

/**
 * 첫 관리자 — 계정이 하나도 없을 때만, Vercel 환경변수 HUB_ADMIN_ID / HUB_ADMIN_PASSWORD 로 로그인하면
 * 그 아이디로 관리자 계정을 만든다. 만든 뒤에는 이 환경변수를 지워도 된다.
 */
export async function bootstrapAdmin(loginId: string, password: string, env: Env = process.env): Promise<Account | null> {
  const id = normalizeLoginId(env.HUB_ADMIN_ID)
  const pw = env.HUB_ADMIN_PASSWORD ?? ''
  if (!id || !pw || id !== loginId || pw !== password) return null
  if ((await listAccounts()).length > 0) return null
  const account: Account = {
    loginId: id,
    name: '허브 관리자',
    team: '',
    role: 'admin',
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    disabled: false,
    createdAt: new Date().toISOString(),
  }
  await saveAccount(account)
  return account
}
