import {
  accountsEnabled,
  bootstrapAdmin,
  clearFailures,
  getAccount,
  hashPassword,
  isLocked,
  missingSettings,
  normalizeLoginId,
  passwordProblem,
  recordFailure,
  saveAccount,
  toPublic,
  verifyPassword,
} from '../server/accounts.js'
import { clearCookie, currentAccount, requireUser, sameOrigin, sessionCookie } from '../server/auth.js'

/**
 * 허브 로그인 — GET은 지금 로그인한 계정, POST는 로그인·로그아웃·비밀번호 변경.
 * 계정 기능이 꺼진 배포면 GET이 enabled:false 를 돌려주고, 화면은 데모 계정으로 연다.
 */

const error = (status: number, message: string) => Response.json({ error: message }, { status })

export async function GET(request: Request): Promise<Response> {
  // 꺼져 있으면 무엇이 빠졌는지 이름만 알려 준다 — 배포에 환경변수가 안 실렸을 때 바로 짚을 수 있게
  if (!accountsEnabled()) return Response.json({ enabled: false, user: null, missing: missingSettings() })
  const account = await currentAccount(request)
  return Response.json({ enabled: true, user: account ? toPublic(account) : null })
}

export async function POST(request: Request): Promise<Response> {
  if (!accountsEnabled()) return error(404, '계정 기능이 꺼져 있습니다')
  if (!sameOrigin(request)) return error(403, '허용되지 않은 요청입니다')

  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return error(400, '요청 형식이 올바르지 않습니다')
  }

  try {
    switch (body.action) {
      case 'login':
        return await login(normalizeLoginId(body.loginId), String(body.password ?? ''))
      case 'logout':
        return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearCookie() } })
      case 'password':
        return await changePassword(request, String(body.current ?? ''), String(body.next ?? ''))
      default:
        return error(400, '알 수 없는 요청입니다')
    }
  } catch (err) {
    console.error('[api/auth]', err)
    return error(502, (err as Error).message)
  }
}

async function login(loginId: string, password: string): Promise<Response> {
  if (!loginId || !password) return error(400, '아이디와 비밀번호를 입력해 주세요')
  if (await isLocked(loginId)) return error(429, '로그인에 여러 번 실패했습니다. 10분 뒤에 다시 시도해 주세요')

  let account = await getAccount(loginId)
  if (!account) account = await bootstrapAdmin(loginId, password)
  else if (!(await verifyPassword(password, account.passwordHash))) account = null

  // 없는 아이디와 틀린 비밀번호를 같은 문구로 답한다 — 어떤 아이디가 있는지 드러내지 않는다
  if (!account) {
    await recordFailure(loginId)
    return error(401, '아이디 또는 비밀번호가 맞지 않습니다')
  }
  if (account.disabled) return error(403, '사용이 중지된 계정입니다. 관리자에게 문의해 주세요')

  await clearFailures(loginId)
  return Response.json({ user: toPublic(account) }, { headers: { 'Set-Cookie': await sessionCookie(account) } })
}

async function changePassword(request: Request, current: string, next: string): Promise<Response> {
  const auth = await requireUser(request, { allowPendingPassword: true })
  if (!auth.ok) return auth.response
  const account = auth.account!

  if (!(await verifyPassword(current, account.passwordHash))) return error(400, '지금 비밀번호가 맞지 않습니다')
  const problem = passwordProblem(next)
  if (problem) return error(400, problem)
  if (next === current) return error(400, '지금과 다른 비밀번호를 정해 주세요')

  const updated = { ...account, passwordHash: await hashPassword(next), mustChangePassword: false }
  await saveAccount(updated)
  // 비밀번호가 바뀌면 예전 세션이 풀리므로, 지금 화면은 새 세션으로 이어 준다
  return Response.json({ user: toPublic(updated) }, { headers: { 'Set-Cookie': await sessionCookie(updated) } })
}
