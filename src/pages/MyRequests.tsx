import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { useApp } from '../store/AppStore'
import type { ProposalStatus } from '../types'

function StatusTag({ status }: { status: ProposalStatus }) {
  if (status === 'approved') return <span className="tag ok">승인됨</span>
  if (status === 'rejected') return <span className="tag no">반려됨</span>
  return <span className="tag wait">대기 중</span>
}

export function MyRequests() {
  const { proposals, promotions, systemRequests, session } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'docs' | 'sheets' | 'systems'>('docs')

  const myProposals = proposals.filter((p) => p.requestedBy === session.name)
  const myPromotions = promotions.filter((p) => p.requestedBy === session.name)
  const mySystems = systemRequests.filter((r) => r.requestedBy === session.name)

  return (
    <>
      <TopBar />
      <div className="content flush">
        <div className="panel-head">
          <span className="label strong">내 요청 현황</span>
          <span className="tag" style={{ marginLeft: 'auto' }}>
            {session.role === 'admin' ? '관리자' : '실무자'}
          </span>
        </div>

        <div className="tabs">
          <button className={`tab${tab === 'docs' ? ' on' : ''}`} onClick={() => setTab('docs')}>
            문서 수정 제안 {myProposals.length}
          </button>
          <button className={`tab${tab === 'sheets' ? ' on' : ''}`} onClick={() => setTab('sheets')}>
            편성표 승격 요청 {myPromotions.length}
          </button>
          <button className={`tab${tab === 'systems' ? ' on' : ''}`} onClick={() => setTab('systems')}>
            시스템 등록 요청 {mySystems.length}
          </button>
        </div>

        {tab === 'systems' ? (
          <div>
            {mySystems.map((r) => (
              <div key={r.id} className="row" style={{ alignItems: 'flex-start' }}>
                <span className="tag">시스템</span>
                <span className="grow" style={{ whiteSpace: 'normal' }}>
                  <span style={{ color: 'var(--text)' }}>
                    {r.name}
                    {r.targetSystemId && ' 접속 주소'}
                  </span>
                  <div className="mono muted" style={{ fontSize: 10.5, marginTop: 4 }}>
                    {r.desc} · {r.access} · {r.url}
                  </div>
                  {r.status === 'rejected' && r.rejectReason && (
                    <div
                      style={{
                        marginTop: 8,
                        padding: '7px 9px',
                        border: '1px solid var(--danger)',
                        font: '11px var(--mono)',
                        color: 'var(--danger)',
                      }}
                    >
                      반려 — {r.rejectReason}
                    </div>
                  )}
                </span>
                <span className="muted">{r.requestedAt.slice(5)}</span>
                <StatusTag status={r.status} />
              </div>
            ))}
            {mySystems.length === 0 && (
              <div className="empty">
                <div className="box" />
                제출한 시스템 등록 요청이 없습니다
                <button className="btn sm" onClick={() => navigate('/systems')}>
                  시스템 화면에서 등록하기
                </button>
              </div>
            )}
          </div>
        ) : tab === 'docs' ? (
          <div>
            {myProposals.map((p) => (
              <div key={p.id} className="row" style={{ alignItems: 'flex-start' }}>
                <span className="tag">문서</span>
                <span className="grow" style={{ whiteSpace: 'normal' }}>
                  <span style={{ color: 'var(--text)' }}>{p.docTitle}</span>
                  <div className="mono muted" style={{ fontSize: 10.5, marginTop: 4 }}>
                    {p.reason}
                  </div>
                  {p.status === 'rejected' && p.rejectReason && (
                    <>
                      <div
                        style={{
                          marginTop: 8,
                          padding: '7px 9px',
                          border: '1px solid var(--danger)',
                          font: '11px var(--mono)',
                          color: 'var(--danger)',
                        }}
                      >
                        반려 — {p.rejectReason}
                      </div>
                      <button
                        className="btn sm"
                        style={{ marginTop: 8 }}
                        onClick={() => navigate(`/wiki/${p.docId}/propose`)}
                      >
                        수정해서 다시 제안
                      </button>
                    </>
                  )}
                </span>
                <span className="muted">{p.requestedAt.slice(5)}</span>
                <StatusTag status={p.status} />
              </div>
            ))}
            {myProposals.length === 0 && (
              <div className="empty">
                <div className="box" />
                제출한 수정 제안이 없습니다
              </div>
            )}
          </div>
        ) : (
          <div>
            {myPromotions.map((p) => (
              <div key={p.id} className="row">
                <span className="tag">편성표</span>
                <span className="grow">{p.sheetName} 승격</span>
                <span className="muted">{p.requestedAt.slice(5)}</span>
                <StatusTag status={p.status} />
              </div>
            ))}
            {myPromotions.length === 0 && (
              <div className="empty">
                <div className="box" />
                제출한 승격 요청이 없습니다
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
