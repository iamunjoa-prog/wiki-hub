import {
  getAccount,
  hashPassword,
  isValidLoginId,
  listAccounts,
  normalizeLoginId,
  saveAccount,
  tempPassword,
  toPublic,
  type Account,
  type AccountRole,
} from '../server/accounts.js'
import { requireUser, sameOrigin } from '../server/auth.js'

/**
 * 계정 관리(관리자 전용) — GET 목록, POST 발급, PATCH 권한·중지·비밀번호 초기화.
 * 발급·초기화한 임시 비밀번호는 응답으로 한 번만 돌려준다. 저장소에는 해시만 남는다.
 */

const error = (status: number, message: string) => Response.json({ error: message }, { status })

const readRole = (raw: unknown): AccountRole | null => (raw === 'admin' || raw === 'member' ? raw : null)

async function guard(request: Request) {
  if (!sameOrigin(request)) return { ok: false as const, response: error(403, '허용되지 않은 요청입니다') }
  return requireUser(request, { admin: true })
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function GET(request: Request): Promise<Response> {
  const auth = await guard(request)
  if (!auth.ok) return auth.response
  if (!auth.account) return error(404, '계정 기능이 꺼져 있습니다')
  return Response.json({ users: (await listAccounts()).map(toPublic) })
}

export async function POST(request: Request): Promise<Response> {
  const auth = await guard(request)
  if (!auth.ok) return auth.response
  if (!auth.account) return error(404, '계정 기능이 꺼져 있습니다')
  const body = await readBody(request)
  if (!body) return error(400, '요청 형식이 올바르지 않습니다')

  const loginId = normalizeLoginId(body.loginId)
  const name = String(body.name ?? '').trim()
  const team = String(body.team ?? '').trim()
  const role = readRole(body.role) ?? 'member'
  if (!isValidLoginId(loginId)) return error(400, '아이디는 영문 소문자·숫자·._- 로 3~32자여야 합니다')
  if (!name) return error(400, '이름을 입력해 주세요')
  if (await getAccount(loginId)) return error(409, '이미 있는 아이디입니다')

  const password = tempPassword()
  const account: Account = {
    loginId,
    name,
    team,
    role,
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    disabled: false,
    createdAt: new Date().toISOString(),
  }
  await saveAccount(account)
  return Response.json({ user: toPublic(account), tempPassword: password })
}

export async function PATCH(request: Request): Promise<Response> {
  const auth = await guard(request)
  if (!auth.ok) return auth.response
  if (!auth.account) return error(404, '계정 기능이 꺼져 있습니다')
  const body = await readBody(request)
  if (!body) return error(400, '요청 형식이 올바르지 않습니다')

  const target = await getAccount(normalizeLoginId(body.loginId))
  if (!target) return error(404, '없는 계정입니다')

  const self = target.loginId === auth.account.loginId
  const role = body.role === undefined ? target.role : readRole(body.role)
  if (!role) return error(400, '권한 값이 올바르지 않습니다')
  const disabled = typeof body.disabled === 'boolean' ? body.disabled : target.disabled
  // 자기 자신을 중지하거나 관리자에서 내리면 관리자가 아무도 없을 수 있다
  if (self && (disabled || role !== 'admin')) return error(400, '내 계정의 관리자 권한·사용 상태는 바꿀 수 없습니다')

  const updated: Account = {
    ...target,
    name: typeof body.name === 'string' && body.name.trim() ? body.name.trim() : target.name,
    team: typeof body.team === 'string' ? body.team.trim() : target.team,
    role,
    disabled,
  }
  let password: string | undefined
  if (body.resetPassword === true) {
    password = tempPassword()
    updated.passwordHash = await hashPassword(password)
    updated.mustChangePassword = true
  }
  await saveAccount(updated)
  return Response.json({ user: toPublic(updated), ...(password ? { tempPassword: password } : {}) })
}
