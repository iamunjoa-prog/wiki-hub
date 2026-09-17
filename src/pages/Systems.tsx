import { useState } from 'react'
import { TopBar } from '../components/AppShell'
import { SystemCard } from '../components/SystemCard'
import { systemAccessOptions, systemGroups } from '../data/systems'
import { useApp } from '../store/AppStore'
import type { SystemAccess, SystemGroupId } from '../types'

/**
 * 담당자가 직접 올리는 시스템 등록 폼.
 * 제출하면 바로 목록에 뜨지 않고 승인 관리로 올라간다 — 공용 목록이라 아무나 늘리면 신뢰를 잃는다.
 */
function RegisterForm({ onDone }: { onDone: () => void }) {
  const { submitSystemRequest } = useApp()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [desc, setDesc] = useState('')
  const [access, setAccess] = useState<SystemAccess>('로컬 전용')
  const [group, setGroup] = useState<SystemGroupId>('programming')
  const [error, setError] = useState('')

  const submit = () => {
    if (!name.trim()) return setError('시스템명을 입력하세요')
    if (!url.trim()) return setError('URL은 필수입니다')
    if (!/^https?:\/\//.test(url.trim())) return setError('http(s):// 로 시작하는 URL을 입력하세요')
    setError('')
    submitSystemRequest({
      name: name.trim(),
      url: url.trim(),
      desc: desc.trim() || '설명 없음',
      access,
      group,
    })
    onDone()
  }

  return (
    <div className="panel sys-form">
      <div className="panel-head">
        <span className="label strong">시스템 등록</span>
        <span className="tag" style={{ marginLeft: 'auto' }}>
          승인 후 공용 목록에 추가
        </span>
      </div>
      <div className="sys-form-body">
        <div className="form-row">
          <span className="label strong">시스템명</span>
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="예: NCMS"
            autoFocus
          />
        </div>
        <div className="form-row">
          <span className="label strong">URL</span>
          <input
            className="field"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="http://"
          />
        </div>
        <div className="form-row">
          <span className="label strong">설명</span>
          <input
            className="field"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="이 시스템으로 무엇을 하는지 한 줄"
          />
        </div>
        <div className="form-row">
          <span className="label strong">접속 망</span>
          <div className="seg">
            {systemAccessOptions.map((a) => (
              <button
                key={a}
                className={`btn sm${access === a ? ' primary' : ''}`}
                onClick={() => setAccess(a)}
              >
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="form-row">
          <span className="label strong">구분</span>
          <div className="seg">
            {systemGroups.map((g) => (
              <button
                key={g.id}
                className={`btn sm${group === g.id ? ' primary' : ''}`}
                onClick={() => setGroup(g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>
        </div>
        {error && <div className="err">{error}</div>}
        <div className="form-actions">
          <button className="btn primary" onClick={submit}>
            등록 요청
          </button>
          <button className="btn" onClick={onDone}>
            취소
          </button>
        </div>
      </div>
    </div>
  )
}

export function Systems() {
  const { systems, systemRequests, systemsStorage, session } = useApp()
  const [registering, setRegistering] = useState(false)

  // 내가 올린 요청만 내 화면에 보인다 — 관리자는 대기 중인 요청 전부를 함께 본다
  const myPending = systemRequests.filter(
    (r) => r.status === 'pending' && (session.role === 'admin' || r.requestedBy === session.name),
  )
  const myRejected = systemRequests.filter(
    (r) => r.status === 'rejected' && r.requestedBy === session.name,
  )

  return (
    <>
      <TopBar />
      <div className="content">
        <div className="page-head">
          <span className="page-title">시스템</span>
          <span className="tag">{systems.length}개</span>
          {!registering && (
            <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setRegistering(true)}>
              시스템 등록
            </button>
          )}
        </div>

        <div className="hint" style={{ marginBottom: 14 }}>
          별표를 누르면 대시보드 <b>자주 사용하는 시스템</b>에 올라갑니다. 접속 망이 다르면 해당 PC에서만
          열립니다.
          {/* 승인 결과가 팀에 공유되는지 — 아니면 눈에 보이게 적어 둔다 */}
          {systemsStorage === 'local' && (
            <>
              <br />
              <b>이 PC에만 저장 중</b> — 팀과 함께 보려면 허브 폴더 <code>.env.local</code> 에{' '}
              <code>HUB_SYSTEMS_FILE</code> 로 공유 드라이브 경로를 적어 주세요.
            </>
          )}
          {systemsStorage === 'memory' && (
            <>
              <br />
              <b>저장되지 않는 화면</b> — 배포본에는 공용 저장소가 없어 등록·승인 결과가 새로고침하면
              사라집니다. 로컬 허브에서 등록해 주세요.
            </>
          )}
        </div>

        {registering && (
          <div style={{ marginBottom: 14 }}>
            <RegisterForm onDone={() => setRegistering(false)} />
          </div>
        )}

        {systemGroups.map((g) => {
          const list = systems.filter((s) => s.group === g.id)
          const pending = myPending.filter((r) => r.group === g.id)
          return (
            <div key={g.id} className="panel" style={{ marginBottom: 14 }}>
              <div className="panel-head">
                <span className="label strong">{g.label}</span>
                <span className="muted mono" style={{ fontSize: 12 }}>
                  {g.desc}
                </span>
                <span className="tag" style={{ marginLeft: 'auto' }}>
                  {list.length}
                </span>
              </div>
              <div className="sys-grid">
                {list.map((s) => (
                  <SystemCard key={s.id} system={s} />
                ))}
              </div>
              {pending.length > 0 && (
                <div className="sys-pending">
                  {pending.map((r) => (
                    <div key={r.id} className="row">
                      <span className="grow">
                        {r.name}
                        <span className="muted">
                          {' · '}
                          {r.targetSystemId ? `접속 주소 ${r.url}` : r.desc}
                        </span>
                      </span>
                      <span className="muted">{r.access}</span>
                      <span className="muted">{r.requestedBy}</span>
                      <span className="tag wait">승인 대기</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}

        {myRejected.length > 0 && (
          <div className="panel">
            <div className="panel-head">
              <span className="label strong">반려된 등록 요청</span>
            </div>
            {myRejected.map((r) => (
              <div key={r.id} className="row">
                <span className="grow">{r.name}</span>
                <span className="muted">{r.rejectReason ?? '사유 없음'}</span>
                <span className="tag no">반려됨</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
