import { InteractionRequiredAuthError, PublicClientApplication, type AccountInfo } from '@azure/msal-browser'
import type { Role, Session } from '../types'

/**
 * 담당자 로그인 — 회사 Microsoft 365(Entra ID) 계정을 그대로 쓴다.
 *
 * 허브가 계정을 따로 만들지 않는다. 회사 IT가 Entra에 이 허브를 앱으로 등록해 두면
 * 사내 계정은 누구나 로그인할 수 있고, 관리자 권한은 Entra의 앱 역할(`Hub.Admin`)로 준다.
 * 앱 ID가 설정되지 않은 빌드(로컬 시연 등)에서는 로그인 없이 예전 데모 계정으로 동작한다.
 */

const CLIENT_ID = import.meta.env.VITE_ENTRA_CLIENT_ID?.trim()
const TENANT_ID = import.meta.env.VITE_ENTRA_TENANT_ID?.trim()

/** Entra 앱 역할 값 — 이 역할을 배정받은 사람만 승인 관리에 들어간다 */
export const ADMIN_APP_ROLE = 'Hub.Admin'

export const authEnabled = Boolean(CLIENT_ID && TENANT_ID)

const msal = authEnabled
  ? new PublicClientApplication({
      auth: {
        clientId: CLIENT_ID!,
        authority: `https://login.microsoftonline.com/${TENANT_ID}`,
        redirectUri: window.location.origin,
        postLogoutRedirectUri: window.location.origin,
      },
      cache: { cacheLocation: 'localStorage' },
    })
  : null

/** 소속 팀은 토큰에 없어 Graph 프로필(부서)에서 읽는다 */
const SCOPES = ['User.Read']

/** 로그인 리디렉트에서 돌아온 결과를 처리하고, 로그인돼 있으면 계정을 돌려준다 */
export async function initAuth(): Promise<AccountInfo | null> {
  if (!msal) return null
  await msal.initialize()
  const result = await msal.handleRedirectPromise()
  const account = result?.account ?? msal.getActiveAccount() ?? msal.getAllAccounts()[0] ?? null
  if (account) msal.setActiveAccount(account)
  return account
}

export function login(): Promise<void> {
  return msal ? msal.loginRedirect({ scopes: SCOPES, prompt: 'select_account' }) : Promise.resolve()
}

export function logout(): Promise<void> {
  return msal ? msal.logoutRedirect({ account: msal.getActiveAccount() }) : Promise.resolve()
}

async function acquire() {
  const account = msal?.getActiveAccount()
  if (!msal || !account) return null
  try {
    return await msal.acquireTokenSilent({ scopes: SCOPES, account })
  } catch (err) {
    // 세션이 만료돼 조용히 갱신할 수 없으면 다시 로그인시킨다
    if (err instanceof InteractionRequiredAuthError) await msal.acquireTokenRedirect({ scopes: SCOPES, account })
    throw err
  }
}

/**
 * 허브 API 호출 — 로그인 중이면 ID 토큰을 붙인다. 서버는 이 토큰으로 사내 계정인지 확인하고,
 * 작성자 이름도 화면이 보낸 값이 아니라 토큰에서 읽는다.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = authEnabled ? (await acquire())?.idToken : undefined
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return fetch(input, { ...init, headers })
}

/** 로그인한 계정을 허브 세션으로 바꾼다 — 팀은 Graph 부서 정보, 권한은 앱 역할에서 */
export async function loadSession(account: AccountInfo): Promise<Session> {
  const roles = (account.idTokenClaims?.roles as string[] | undefined) ?? []
  const role: Role = roles.includes(ADMIN_APP_ROLE) ? 'admin' : 'member'
  let team = ''
  try {
    const token = (await acquire())?.accessToken
    if (token) {
      const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=department', {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) team = ((await res.json()) as { department?: string | null }).department ?? ''
    }
  } catch {
    // 부서를 못 읽어도 로그인은 그대로 둔다 — 팀 표시만 비운다
  }
  return {
    userId: account.localAccountId,
    name: account.name || account.username,
    team: team || '소속 미등록',
    role,
    email: account.username,
  }
}
