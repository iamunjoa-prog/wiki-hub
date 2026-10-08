import { useEffect, useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { useAuth } from '../components/AuthGate'
import { createUser, listUsers, updateUser, type HubAccount } from '../lib/auth'
import type { Role } from '../types'

/** 임시 비밀번호는 한 번만 보여 준다 — 저장소에는 해시만 남아 다시 볼 수 없다 */
interface Issued {
  loginId: string
  name: string
  password: string
}

/** 계정 관리 — 관리자가 담당자 계정을 발급하고 권한·사용 상태·비밀번호를 관리한다 */
export function Accounts() {
  const { user, refresh } = useAuth()
  const [users, setUsers] = useState<HubAccount[] | null>(null)
  const [error, setError] = useState('')
  const [issued, setIssued] = useState<Issued | null>(null)
  /** 이름·팀을 고치는 중인 계정 */
  const [editing, setEditing] = useState<{ loginId: string; name: string; team: string } | null>(null)

  const [loginId, setLoginId] = useState('')
  const [name, setName] = useState('')
  const [team, setTeam] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (user?.role !== 'admin') return
    listUsers()
      .then(setUsers)
      .catch((err: Error) => setError(err.message))
  }, [user])

  if (user?.role !== 'admin') return <Navigate to="/" replace />

  const replace = (u: HubAccount) => setUsers((prev) => prev?.map((x) => (x.loginId === u.loginId ? u : x)) ?? [u])

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    createUser({ loginId: loginId.trim(), name: name.trim(), team: team.trim(), role })
      .then((res) => {
        setUsers((prev) => [...(prev ?? []), res.user])
        setIssued({ loginId: res.user.loginId, name: res.user.name, password: res.tempPassword })
        setLoginId('')
        setName('')
        setTeam('')
        setRole('member')
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false))
  }

  const patch = (u: HubAccount, change: Parameters<typeof updateUser>[1], confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    setError('')
    return updateUser(u.loginId, change)
      .then((res) => {
        replace(res.user)
        if (res.tempPassword) setIssued({ loginId: res.user.loginId, name: res.user.name, password: res.tempPassword })
        // 내 이름·팀을 고쳤으면 사이드바·작성자 표시도 새 정보로 바꾼다
        if (res.user.loginId === user.loginId) refresh()
        return true
      })
      .catch((err: Error) => {
        setError(err.message)
        return false
      })
  }

  const saveEdit = (u: HubAccount) => {
    if (!editing || !editing.name.trim()) return
    patch(u, { name: editing.name.trim(), team: editing.team.trim() })?.then((ok) => ok && setEditing(null))
  }

  return (
    <>
      <TopBar />
      <div className="content flush">
        <div className="panel-head">
          <span className="label strong">계정 관리</span>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>
            {users ? `${users.length}명` : ''}
          </span>
        </div>

        <form className="account-form" onSubmit={submit}>
          <div className="form-grid">
            <div className="form-row">
              <span className="label strong">아이디 *</span>
              <input
                className="field"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder="영문 소문자·숫자 (예: hong.gd)"
              />
            </div>
            <div className="form-row">
              <span className="label strong">이름 *</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="홍길동" />
            </div>
            <div className="form-row">
              <span className="label strong">팀</span>
              <input className="field" value={team} onChange={(e) => setTeam(e.target.value)} placeholder="편성기획팀" />
            </div>
            <div className="form-row">
              <span className="label strong">권한</span>
              <select className="field" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="member">실무자</option>
                <option value="admin">관리자</option>
              </select>
            </div>
          </div>
          <div className="form-actions">
            <button className="btn primary" disabled={busy || !loginId.trim() || !name.trim()}>
              계정 발급
            </button>
          </div>
        </form>

        {issued && (
          <div className="account-issued">
            <div>
              <strong>{issued.name}</strong> ({issued.loginId}) 임시 비밀번호: <code>{issued.password}</code>
            </div>
            <div className="muted">
              지금만 보입니다. 담당자에게 아이디와 함께 전달해 주세요. 첫 로그인 때 새 비밀번호로 바꾸게 됩니다.
            </div>
            <button className="btn sm" onClick={() => setIssued(null)}>
              닫기
            </button>
          </div>
        )}

        {error && <div className="account-error">{error}</div>}

        <div>
          {users === null && !error && <div className="row muted">불러오는 중…</div>}
          {users?.map((u) => {
            const self = u.loginId === user.loginId
            return (
              <div key={u.loginId} className="row account-row">
                {editing?.loginId === u.loginId ? (
                  <span className="grow account-edit">
                    <input
                      className="field"
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      placeholder="이름"
                      aria-label="이름"
                      autoFocus
                    />
                    <input
                      className="field"
                      value={editing.team}
                      onChange={(e) => setEditing({ ...editing, team: e.target.value })}
                      onKeyDown={(e) => e.key === 'Enter' && saveEdit(u)}
                      placeholder="팀"
                      aria-label="팀"
                    />
                    <button className="btn sm primary" disabled={!editing.name.trim()} onClick={() => saveEdit(u)}>
                      저장
                    </button>
                    <button className="btn sm" onClick={() => setEditing(null)}>
                      취소
                    </button>
                  </span>
                ) : (
                  <span className="grow" style={{ whiteSpace: 'normal' }}>
                    <span style={{ color: u.disabled ? 'var(--muted)' : 'var(--text)' }}>
                      {u.name} <span className="muted">· {u.team || '소속 미등록'} · {u.loginId}</span>
                    </span>
                    <button
                      className="btn sm account-edit-btn"
                      onClick={() => setEditing({ loginId: u.loginId, name: u.name, team: u.team })}
                    >
                      정보 수정
                    </button>
                  </span>
                )}
                {u.disabled ? (
                  <span className="tag no">사용 중지</span>
                ) : u.mustChangePassword ? (
                  <span className="tag wait">첫 로그인 전</span>
                ) : (
                  <span className="tag ok">사용 중</span>
                )}
                <select
                  className="field account-role"
                  value={u.role}
                  disabled={self}
                  onChange={(e) => patch(u, { role: e.target.value as Role })}
                  aria-label={`${u.name} 권한`}
                >
                  <option value="member">실무자</option>
                  <option value="admin">관리자</option>
                </select>
                <button
                  className="btn sm"
                  disabled={self}
                  onClick={() => patch(u, { resetPassword: true }, `${u.name}님의 비밀번호를 초기화할까요?`)}
                >
                  비밀번호 초기화
                </button>
                <button
                  className="btn sm"
                  disabled={self}
                  onClick={() =>
                    patch(
                      u,
                      { disabled: !u.disabled },
                      u.disabled ? undefined : `${u.name}님 계정의 사용을 중지할까요? 바로 로그아웃됩니다.`,
                    )
                  }
                >
                  {u.disabled ? '다시 사용' : '사용 중지'}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}
