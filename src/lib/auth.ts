import type { Role, Session } from '../types'

/**
 * 허브 전용 계정 — 관리자가 발급하고, 로그인 세션은 서버가 HttpOnly 쿠키로 관리한다.
 * 같은 사이트 요청에는 쿠키가 자동으로 실리므로 다른 API 호출은 손대지 않는다.
 * 서버에 계정 기능이 없으면(로컬 허브·설정 전 배포) 로그인 없이 데모 계정으로 연다.
 */

export interface HubAccount {
  loginId: string
  name: string
  team: string
  role: Role
  mustChangePassword: boolean
  disabled: boolean
  createdAt: string
}

export type AuthStatus = { enabled: false } | { enabled: true; user: HubAccount | null }

async function call<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

/** 로컬 허브에는 /api/auth 가 없어 화면(HTML)이 돌아온다 — 그때는 계정 기능이 꺼진 것으로 본다 */
export async function fetchAuthStatus(): Promise<AuthStatus> {
  try {
    const res = await fetch('/api/auth')
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return { enabled: false }
    const data = (await res.json()) as { enabled: boolean; user: HubAccount | null }
    return data.enabled ? { enabled: true, user: data.user } : { enabled: false }
  } catch {
    return { enabled: false }
  }
}

const post = <T>(body: unknown) => call<T>('/api/auth', { method: 'POST', body: JSON.stringify(body) })

export const login = (loginId: string, password: string) =>
  post<{ user: HubAccount }>({ action: 'login', loginId, password }).then((r) => r.user)

export const logout = () => post<unknown>({ action: 'logout' })

export const changePassword = (current: string, next: string) =>
  post<{ user: HubAccount }>({ action: 'password', current, next }).then((r) => r.user)

export const toSession = (a: HubAccount): Session => ({
  userId: a.loginId,
  name: a.name,
  team: a.team || '소속 미등록',
  role: a.role,
  loginId: a.loginId,
})

/* ── 계정 관리(관리자) ─────────────────────────────────── */

export const listUsers = () => call<{ users: HubAccount[] }>('/api/users').then((r) => r.users)

export const createUser = (input: { loginId: string; name: string; team: string; role: Role }) =>
  call<{ user: HubAccount; tempPassword: string }>('/api/users', { method: 'POST', body: JSON.stringify(input) })

export const updateUser = (
  loginId: string,
  patch: Partial<Pick<HubAccount, 'name' | 'team' | 'role' | 'disabled'>> & { resetPassword?: boolean },
) =>
  call<{ user: HubAccount; tempPassword?: string }>('/api/users', {
    method: 'PATCH',
    body: JSON.stringify({ loginId, ...patch }),
  })
