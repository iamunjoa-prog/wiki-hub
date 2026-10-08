import { SignJWT, jwtVerify } from 'jose'
import { accountsEnabled, getAccount, type Account } from './accounts.js'

/**
 * 로그인 세션 — 서명한 토큰을 HttpOnly 쿠키에 담는다. 화면 스크립트는 쿠키를 읽을 수 없고,
 * 같은 사이트 요청에만 실려 간다. 요청마다 저장소의 계정을 다시 읽으므로
 * 관리자가 계정을 중지하거나 권한을 바꾸면 바로 반영된다.
 */

const COOKIE = 'hub_session'
const MAX_AGE = 60 * 60 * 12 // 12시간 — 하루 업무 단위

type Env = Record<string, string | undefined>

const secretKey = (env: Env) => new TextEncoder().encode(env.HUB_AUTH_SECRET!.trim())

/** 비밀번호가 바뀌면 예전 세션이 풀리도록, 해시 끝부분을 세션에 함께 묶는다 */
const passwordStamp = (account: Account) => account.passwordHash.slice(-12)

export async function sessionCookie(account: Account, env: Env = process.env): Promise<string> {
  const token = await new SignJWT({ ps: passwordStamp(account) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(account.loginId)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secretKey(env))
  return `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE}`
}

export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

function readCookie(request: Request): string | null {
  const header = request.headers.get('cookie') ?? ''
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE) return rest.join('=') || null
  }
  return null
}

/** 쿠키의 세션을 확인해 계정을 돌려준다. 없거나 만료·중지된 계정이면 null */
export async function currentAccount(request: Request, env: Env = process.env): Promise<Account | null> {
  const token = readCookie(request)
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, secretKey(env), { algorithms: ['HS256'] })
    const account = payload.sub ? await getAccount(payload.sub) : null
    if (!account || account.disabled || payload.ps !== passwordStamp(account)) return null
    return account
  } catch {
    return null
  }
}

export type AuthResult = { ok: true; account: Account | null } | { ok: false; response: Response }

const deny = (status: number, message: string): AuthResult => ({
  ok: false,
  response: Response.json({ error: message }, { status }),
})

/**
 * API 입구의 로그인 확인. 계정 기능이 꺼진 배포(데모)면 account 없이 통과시킨다.
 * 임시 비밀번호를 아직 바꾸지 않은 계정은 비밀번호 변경 말고는 막는다.
 */
export async function requireUser(
  request: Request,
  opts: { admin?: boolean; allowPendingPassword?: boolean } = {},
): Promise<AuthResult> {
  if (!accountsEnabled()) return { ok: true, account: null }
  const account = await currentAccount(request)
  if (!account) return deny(401, '로그인이 필요합니다')
  if (account.mustChangePassword && !opts.allowPendingPassword) return deny(403, '비밀번호를 먼저 바꿔 주세요')
  if (opts.admin && account.role !== 'admin') return deny(403, '관리자만 할 수 있습니다')
  return { ok: true, account }
}

/** 다른 사이트의 페이지가 로그인 쿠키를 실어 이 API를 부르지 못하게, 브라우저 요청은 같은 출처만 받는다 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  return !origin || new URL(origin).host === new URL(request.url).host
}
