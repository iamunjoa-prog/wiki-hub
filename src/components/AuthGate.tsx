import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { authEnabled, initAuth, loadSession, login } from '../lib/auth'
import type { Session } from '../types'

/** 로그인한 담당자. 로그인 없는 데모 빌드면 null — 이때 허브는 데모 계정으로 돈다 */
const AuthCtx = createContext<Session | null>(null)

export const useAuthUser = () => useContext(AuthCtx)

type State = { status: 'loading' } | { status: 'signedOut'; error?: string } | { status: 'signedIn'; user: Session }

/** Microsoft 365 로그인을 마쳐야 허브를 연다. 앱 ID가 설정되지 않았으면 그대로 통과시킨다. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: authEnabled ? 'loading' : 'signedOut' })

  useEffect(() => {
    if (!authEnabled) return
    initAuth()
      .then(async (account) => setState(account ? { status: 'signedIn', user: await loadSession(account) } : { status: 'signedOut' }))
      .catch((err: Error) => setState({ status: 'signedOut', error: err.message }))
  }, [])

  if (!authEnabled) return <AuthCtx.Provider value={null}>{children}</AuthCtx.Provider>
  if (state.status === 'signedIn') return <AuthCtx.Provider value={state.user}>{children}</AuthCtx.Provider>

  return (
    <div className="login-screen">
      <div className="login-box">
        <h1>플랫폼 담당 지식 허브</h1>
        {state.status === 'loading' ? (
          <p className="muted">로그인 상태를 확인하고 있습니다…</p>
        ) : (
          <>
            <p className="muted">회사 Microsoft 365 계정으로 로그인합니다. 별도 가입은 필요 없습니다.</p>
            <button className="btn primary block" onClick={() => login()}>
              Microsoft 계정으로 로그인
            </button>
            {state.error && <p className="login-error">로그인하지 못했습니다 — {state.error}</p>}
          </>
        )}
      </div>
    </div>
  )
}
