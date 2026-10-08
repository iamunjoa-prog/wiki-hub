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
  /** 엑셀 명단을 붙여넣어 여러 명을 한 번에 발급하는 화면 */
  const [bulk, setBulk] = useState(false)

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
            <button type="button" className="btn" onClick={() => setBulk(true)}>
              여러 명 한 번에 발급
            </button>
          </div>
        </form>

        {bulk && (
          <BulkIssue
            onCreated={(u) => setUsers((prev) => [...(prev ?? []), u])}
            onClose={() => setBulk(false)}
          />
        )}

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

/* ── 여러 명 한 번에 발급 ─────────────────────────────── */

interface BulkRow {
  line: number
  loginId: string
  name: string
  team: string
  role: Role
}

type BulkResult = BulkRow & ({ ok: true; password: string } | { ok: false; error: string })

const ADMIN_WORDS = ['관리자', 'admin']

/**
 * 엑셀에서 복사한 명단(탭 구분) 또는 쉼표로 구분한 줄을 읽는다.
 * 열 순서: 아이디, 이름, 팀, 권한(비우면 실무자). 첫 줄이 "아이디"로 시작하면 머리글로 보고 건너뛴다.
 */
function parseRoster(text: string): BulkRow[] {
  return text
    .split(/\r?\n/)
    .map((raw, i) => ({ raw: raw.trim(), line: i + 1 }))
    .filter(({ raw }) => raw && !/^아이디/.test(raw))
    .map(({ raw, line }) => {
      const [loginId = '', name = '', team = '', role = ''] = raw.split(raw.includes('\t') ? '\t' : ',').map((c) => c.trim())
      return { line, loginId, name, team, role: ADMIN_WORDS.includes(role.toLowerCase()) ? 'admin' : 'member' }
    })
}

/** 결과표를 엑셀에 그대로 붙여넣을 수 있게 탭으로 이어 붙인다 */
const toTsv = (rows: BulkResult[]) =>
  ['아이디\t이름\t팀\t임시 비밀번호', ...rows.filter((r) => r.ok).map((r) => [r.loginId, r.name, r.team, r.ok ? r.password : ''].join('\t'))].join('\n')

function BulkIssue({ onCreated, onClose }: { onCreated: (u: HubAccount) => void; onClose: () => void }) {
  const [text, setText] = useState('')
  const [results, setResults] = useState<BulkResult[] | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)
  const rows = parseRoster(text)

  // 한 명씩 차례로 발급한다 — 중간에 실패한 줄이 있어도 나머지는 계속 만든다
  const run = async () => {
    const out: BulkResult[] = []
    for (const [i, row] of rows.entries()) {
      setProgress(i + 1)
      try {
        const res = await createUser(row)
        onCreated(res.user)
        out.push({ ...row, ok: true, password: res.tempPassword })
      } catch (err) {
        out.push({ ...row, ok: false, error: (err as Error).message })
      }
    }
    setProgress(null)
    setResults(out)
  }

  const copy = () => {
    if (!results) return
    navigator.clipboard
      .writeText(toTsv(results))
      .then(() => setCopied(true))
      .catch(() => setCopied(false))
  }

  const download = () => {
    if (!results) return
    // 엑셀이 한글을 깨뜨리지 않게 BOM을 붙인 CSV로 내려받는다
    const csv = toTsv(results).split('\n').map((l) => l.split('\t').map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n')
    const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `허브계정_임시비밀번호_${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (results) {
    const okCount = results.filter((r) => r.ok).length
    return (
      <div className="account-bulk">
        <div className="account-bulk-head">
          <strong>
            {okCount}명 발급 완료{results.length > okCount && ` · ${results.length - okCount}명 실패`}
          </strong>
          <span className="muted">임시 비밀번호는 지금만 보입니다. 복사하거나 내려받아 담당자별로 전달해 주세요.</span>
        </div>
        <table className="account-bulk-table">
          <thead>
            <tr>
              <th>아이디</th>
              <th>이름</th>
              <th>팀</th>
              <th>임시 비밀번호 / 결과</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.line} className={r.ok ? '' : 'fail'}>
                <td>{r.loginId}</td>
                <td>{r.name}</td>
                <td>{r.team}</td>
                <td>{r.ok ? <code>{r.password}</code> : `${r.line}번째 줄 — ${r.error}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="form-actions">
          <button className="btn primary" disabled={okCount === 0} onClick={copy}>
            {copied ? '복사됨' : '엑셀용으로 복사'}
          </button>
          <button className="btn" disabled={okCount === 0} onClick={download}>
            CSV 내려받기
          </button>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="account-bulk">
      <div className="account-bulk-head">
        <strong>여러 명 한 번에 발급</strong>
        <span className="muted">
          엑셀에서 <b>아이디 · 이름 · 팀 · 권한</b> 순서의 열을 복사해 붙여넣으세요. 권한을 비우면 실무자, "관리자"면 관리자입니다.
        </span>
      </div>
      <textarea
        className="field account-bulk-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'hong.gd\t홍길동\t편성기획팀\nkim.cs\t김철수\t마케팅팀\nlee.yh\t이영희\t편성기획팀\t관리자'}
        autoFocus
      />
      <div className="form-actions">
        <button className="btn primary" disabled={rows.length === 0 || progress !== null} onClick={run}>
          {progress !== null ? `발급 중… ${progress}/${rows.length}` : `${rows.length}명 발급`}
        </button>
        <button className="btn" disabled={progress !== null} onClick={onClose}>
          취소
        </button>
      </div>
    </div>
  )
}
