import { createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { changePassword, fetchAuthStatus, login, logout, toSession, type HubAccount } from '../lib/auth'
import type { Session } from '../types'

interface AuthState {
  /** 로그인한 담당자. 계정 기능이 꺼진 데모 모드면 null — 이때 허브는 데모 계정으로 돈다 */
  user: Session | null
  signOut: () => void
  /** 내 계정 정보(이름·팀)가 바뀌었을 때 다시 읽는다 */
  refresh: () => void
}

const AuthCtx = createContext<AuthState>({ user: null, signOut: () => {}, refresh: () => {} })

export const useAuth = () => useContext(AuthCtx)

type State = { status: 'loading' } | { status: 'demo' } | { status: 'signedOut' } | { status: 'signedIn'; account: HubAccount }

/** 허브 계정으로 로그인해야 허브를 연다. 서버에 계정 기능이 없으면 그대로 통과시킨다. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading' })

  const refresh = useCallback(() => {
    fetchAuthStatus().then((s) =>
      setState(!s.enabled ? { status: 'demo' } : s.user ? { status: 'signedIn', account: s.user } : { status: 'signedOut' }),
    )
  }, [])

  useEffect(refresh, [refresh])

  const signOut = () => {
    logout().finally(() => setState({ status: 'signedOut' }))
  }

  if (state.status === 'demo') return <AuthCtx.Provider value={{ user: null, signOut, refresh }}>{children}</AuthCtx.Provider>
  if (state.status === 'loading') return <LoginFrame><p className="muted">불러오는 중…</p></LoginFrame>
  if (state.status === 'signedOut') return <LoginForm onDone={(account) => setState({ status: 'signedIn', account })} />
  if (state.account.mustChangePassword) {
    return (
      <PasswordForm
        account={state.account}
        onDone={(account) => setState({ status: 'signedIn', account })}
        onCancel={signOut}
      />
    )
  }
  return <AuthCtx.Provider value={{ user: toSession(state.account), signOut, refresh }}>{children}</AuthCtx.Provider>
}

function LoginFrame({ children }: { children: ReactNode }) {
  return (
    <div className="login-screen">
      <div className="login-box">
        <h1>플랫폼 담당 지식 허브</h1>
        {children}
      </div>
    </div>
  )
}

function LoginForm({ onDone }: { onDone: (account: HubAccount) => void }) {
  const [loginId, setLoginId] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    login(loginId.trim(), password)
      .then(onDone)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false))
  }

  return (
    <LoginFrame>
      <p className="muted">관리자에게 받은 허브 계정으로 로그인합니다.</p>
      <form className="login-form" onSubmit={submit}>
        <input
          className="field"
          placeholder="아이디"
          autoComplete="username"
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          autoFocus
        />
        <input
          className="field"
          type="password"
          placeholder="비밀번호"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="btn primary block" disabled={busy || !loginId.trim() || !password}>
          로그인
        </button>
      </form>
      {error && <p className="login-error">{error}</p>}
      <p className="login-help muted">계정이 없거나 비밀번호를 잊었으면 허브 관리자에게 요청해 주세요.</p>
    </LoginFrame>
  )
}

function PasswordForm({
  account,
  onDone,
  onCancel,
}: {
  account: HubAccount
  onDone: (account: HubAccount) => void
  onCancel: () => void
}) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (next !== confirm) return setError('새 비밀번호가 서로 다릅니다')
    setBusy(true)
    setError('')
    changePassword(current, next)
      .then(onDone)
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false))
  }

  return (
    <LoginFrame>
      <p className="muted">
        {account.name}님, 처음 로그인했거나 비밀번호가 초기화됐습니다. 사용할 비밀번호로 바꿔 주세요.
      </p>
      <form className="login-form" onSubmit={submit}>
        <input
          className="field"
          type="password"
          placeholder="받은 임시 비밀번호"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          autoFocus
        />
        <input
          className="field"
          type="password"
          placeholder="새 비밀번호 (8자 이상, 영문+숫자)"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <input
          className="field"
          type="password"
          placeholder="새 비밀번호 확인"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button className="btn primary block" disabled={busy || !current || !next || !confirm}>
          비밀번호 바꾸고 시작하기
        </button>
      </form>
      {error && <p className="login-error">{error}</p>}
      <button className="btn sm login-help" onClick={onCancel}>
        다른 계정으로 로그인
      </button>
    </LoginFrame>
  )
}
