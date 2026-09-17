import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { DiffView } from '../components/DiffView'
import { categories } from '../data/docs'
import { systemGroups } from '../data/systems'
import { useApp } from '../store/AppStore'
import type { CategoryId } from '../types'

function RejectModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span className="label strong">반려 사유</span>
        </div>
        <div className="modal-body">
          <textarea
            className="field"
            style={{ minHeight: 80 }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="요청자가 무엇을 고쳐야 하는지 적어 주세요"
            autoFocus
          />
          <div className="form-actions">
            <button className="btn primary" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
              반려 처리
            </button>
            <button className="btn" onClick={onCancel}>
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export function Approvals() {
  const {
    session,
    docs,
    sheets,
    proposals,
    promotions,
    systemRequests,
    decideProposal,
    decidePromotion,
    decideSystemRequest,
  } = useApp()
  const [tab, setTab] = useState<'docs' | 'sheets' | 'systems' | 'admin'>('docs')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [category, setCategory] = useState<CategoryId>('promotion')
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)

  const pendingDocs = proposals.filter((p) => p.status === 'pending')
  const pendingSheets = promotions.filter((p) => p.status === 'pending')
  const pendingSystems = systemRequests.filter((r) => r.status === 'pending')
  const list = tab === 'docs' ? pendingDocs : tab === 'systems' ? pendingSystems : pendingSheets

  useEffect(() => {
    setSelectedId(list[0]?.id ?? null)
  }, [tab, list.length])

  if (session.role !== 'admin') return <Navigate to="/" replace />

  const proposal = pendingDocs.find((p) => p.id === selectedId)
  const promotion = pendingSheets.find((p) => p.id === selectedId)
  const systemRequest = pendingSystems.find((r) => r.id === selectedId)
  const doc = proposal ? docs.find((d) => d.id === proposal.docId) : undefined
  const sheet = promotion ? sheets.find((s) => s.id === promotion.sheetId) : undefined

  const approve = async () => {
    setBusy(true)
    if (proposal) await decideProposal(proposal.id, 'approved')
    else if (promotion) await decidePromotion(promotion.id, 'approved', { category })
    else if (systemRequest) await decideSystemRequest(systemRequest.id, 'approved')
    setBusy(false)
  }

  const reject = async (reason: string) => {
    setRejecting(false)
    setBusy(true)
    if (proposal) await decideProposal(proposal.id, 'rejected', reason)
    else if (promotion) await decidePromotion(promotion.id, 'rejected', { reason })
    else if (systemRequest) await decideSystemRequest(systemRequest.id, 'rejected', reason)
    setBusy(false)
  }

  return (
    <>
      <TopBar />
      <div className="content flush" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="panel-head" style={{ flex: 'none' }}>
          <span className="label strong">승인 관리</span>
          <span className="tag solid">관리자 전용</span>
          <span className="mono" style={{ marginLeft: 'auto', fontSize: 11 }}>
            대기 {pendingDocs.length + pendingSheets.length + pendingSystems.length}건
          </span>
        </div>

        <div className="tabs" style={{ flex: 'none' }}>
          <button className={`tab${tab === 'docs' ? ' on' : ''}`} onClick={() => setTab('docs')}>
            문서 수정 {pendingDocs.length}
          </button>
          <button className={`tab${tab === 'sheets' ? ' on' : ''}`} onClick={() => setTab('sheets')}>
            편성표 승격 {pendingSheets.length}
          </button>
          <button className={`tab${tab === 'systems' ? ' on' : ''}`} onClick={() => setTab('systems')}>
            시스템 등록 {pendingSystems.length}
          </button>
          <button className={`tab${tab === 'admin' ? ' on' : ''}`} onClick={() => setTab('admin')}>
            카테고리·권한
          </button>
        </div>

        {tab === 'admin' ? (
          <div className="content">
            <div className="panel" style={{ maxWidth: 520 }}>
              <div className="panel-head">
                <span className="label strong">카테고리</span>
              </div>
              {categories.map((c) => (
                <div key={c.id} className="row">
                  <span className="grow">{c.label}</span>
                  <span className="muted">{docs.filter((d) => d.category === c.id).length}건</span>
                </div>
              ))}
              <div className="hint" style={{ margin: 12 }}>
                카테고리 추가·삭제와 권한 부여는 이번 범위에서 조회만 제공합니다
              </div>
            </div>
          </div>
        ) : (
          <div className="approve-split">
            <div className="approve-list">
              {list.map((item) => (
                <button
                  key={item.id}
                  className={`approve-item${item.id === selectedId ? ' on' : ''}`}
                  onClick={() => setSelectedId(item.id)}
                >
                  <span>
                    {'docTitle' in item ? item.docTitle : 'sheetName' in item ? item.sheetName : item.name}
                  </span>
                  <span className="who">
                    {item.requestedBy} · {item.requestedAt.slice(5)}
                  </span>
                </button>
              ))}
              {list.length === 0 && <div className="empty">대기 중인 요청이 없습니다</div>}
            </div>

            <div className="approve-detail">
              {proposal && doc && (
                <>
                  <div>
                    <div style={{ font: '700 14px var(--mono)' }}>{proposal.docTitle}</div>
                    <div className="mono muted" style={{ fontSize: 10.5, marginTop: 5 }}>
                      {proposal.requestedBy} · {proposal.requestedAt} · 기준 v{proposal.baseVersion}
                    </div>
                  </div>
                  <div className="hint">수정 사유 — {proposal.reason}</div>
                  {proposal.newBody ? (
                    <DiffView
                      before={doc.body}
                      after={proposal.newBody}
                      leftLabel={`원본 v${doc.version}`}
                      rightLabel="제안"
                    />
                  ) : (
                    <div className="hint">이 요청은 데모 시드 데이터로, 본문 diff가 포함되어 있지 않습니다</div>
                  )}
                </>
              )}

              {promotion && sheet && (
                <>
                  <div>
                    <div style={{ font: '700 14px var(--mono)' }}>{promotion.sheetName} 승격</div>
                    <div className="mono muted" style={{ fontSize: 10.5, marginTop: 5 }}>
                      {promotion.requestedBy} · {promotion.requestedAt} · {sheet.gnb} · {sheet.ownerName}
                    </div>
                  </div>
                  <div className="embed" style={{ height: 140 }}>
                    미리보기 영역
                    <br />
                    {sheet.type === 'sheet' ? '구글 시트 iframe' : '담당자 개발 화면 iframe'}
                  </div>
                  <div className="form-row">
                    <span className="label strong">배치 카테고리</span>
                    <select
                      className="field"
                      style={{ maxWidth: 240 }}
                      value={category}
                      onChange={(e) => setCategory(e.target.value as CategoryId)}
                    >
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {systemRequest && (
                <>
                  <div>
                    <div style={{ font: '700 14px var(--mono)' }}>
                      {systemRequest.name} {systemRequest.targetSystemId ? '접속 주소 등록' : '등록'}
                    </div>
                    <div className="mono muted" style={{ fontSize: 10.5, marginTop: 5 }}>
                      {systemRequest.requestedBy} · {systemRequest.requestedAt} ·{' '}
                      {systemGroups.find((g) => g.id === systemRequest.group)?.label} · {systemRequest.access}
                    </div>
                  </div>
                  <div className="hint">{systemRequest.desc}</div>
                  <div className="hint">
                    접속 주소 —{' '}
                    <a href={systemRequest.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }}>
                      {systemRequest.url} ↗
                    </a>
                    <br />
                    {systemRequest.targetSystemId ? (
                      <>
                        승인하면 <b>{systemRequest.name}</b> 카드에 접속 주소가 붙어 모두에게 보입니다.
                      </>
                    ) : (
                      <>
                        승인하면 <b>{systemGroups.find((g) => g.id === systemRequest.group)?.label}</b> 섹션에
                        모두에게 보이는 카드로 추가됩니다.
                      </>
                    )}
                  </div>
                </>
              )}

              {(proposal || promotion || systemRequest) && (
                <>
                  {!systemRequest && (
                    <div className="hint">
                      승인 시 커밋 생성 → 위키트리 즉시 반영. 편성표 승격은 <b>요약 문서 + 원본 링크</b> 형태로
                      생성됩니다
                    </div>
                  )}
                  <div className="form-actions" style={{ marginTop: 'auto' }}>
                    <button className="btn primary" disabled={busy} onClick={approve}>
                      {busy ? '처리 중…' : '승인'}
                    </button>
                    <button className="btn" disabled={busy} onClick={() => setRejecting(true)}>
                      반려 (사유 입력)
                    </button>
                  </div>
                </>
              )}

              {!proposal && !promotion && !systemRequest && (
                <div className="empty">
                  <div className="box" />
                  좌측에서 요청을 선택하세요
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      {rejecting && <RejectModal onCancel={() => setRejecting(false)} onConfirm={reject} />}
    </>
  )
}
