import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { CliStatus } from '../components/CliStatus'
import { categories, categoryShort, relatedSites } from '../data/docs'
import { useApp } from '../store/AppStore'
import type { ProposalStatus } from '../types'

function StatusTag({ status }: { status: ProposalStatus }) {
  if (status === 'approved') return <span className="tag ok">승인됨</span>
  if (status === 'rejected') return <span className="tag no">반려됨</span>
  return <span className="tag wait">대기 중</span>
}

export function Dashboard() {
  const { docs, sheets, proposals, promotions, session } = useApp()
  const navigate = useNavigate()
  const isAdmin = session.role === 'admin'

  const byCategory = categories.map((c) => ({
    label: c.label,
    count: docs.filter((d) => d.category === c.id).length,
  }))
  const pending =
    proposals.filter((p) => p.status === 'pending').length +
    promotions.filter((p) => p.status === 'pending').length

  const recent = [...docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 7)
  const weekly = docs.filter((d) => d.updatedAt >= '2026-08-25').length

  // 관리자는 전체 대기 건, 실무자는 본인 요청을 최신순으로
  const requests = [
    ...proposals.map((p) => ({ id: p.id, kind: '문서', title: p.docTitle, by: p.requestedBy, at: p.requestedAt, status: p.status })),
    ...promotions.map((p) => ({ id: p.id, kind: '편성표', title: `${p.sheetName} 승격`, by: p.requestedBy, at: p.requestedAt, status: p.status })),
  ]
    .filter((r) => (isAdmin ? r.status === 'pending' : r.by === session.name))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 4)
  const requestsPath = isAdmin ? '/approvals' : '/requests'

  return (
    <>
      <TopBar>
        <span className="btn sm">알림 3</span>
      </TopBar>
      <div className="content">
        <div className="dash-wrap">
          <div className="kpi-grid">
            <div className="kpi">
              <span className="label">전체 문서</span>
              <b>{docs.length}</b>
            </div>
            <div className="kpi">
              <span className="label">카테고리별</span>
              <span className="sub">
                {byCategory.map((c) => `${c.label} ${c.count}`).join(' / ')}
              </span>
            </div>
            <div className="kpi">
              <span className="label">이번 주 업데이트</span>
              <b>{weekly}</b>
            </div>
            {isAdmin ? (
              <button className="kpi" onClick={() => navigate('/approvals')}>
                <span className="label strong">승인 대기</span>
                <b>{pending}</b>
                <span className="sub muted">승인 관리 →</span>
              </button>
            ) : (
              <button className="kpi" onClick={() => navigate('/requests')}>
                <span className="label">내 대기 요청</span>
                <b>{proposals.filter((p) => p.status === 'pending').length}</b>
                <span className="sub muted">내 요청 현황 →</span>
              </button>
            )}
          </div>

          <div className="dash-cols">
            <div className="left">
              <div className="panel">
                <div className="panel-head">
                  <span className="label strong">최근 업데이트 문서</span>
                  <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => navigate('/wiki')}>
                    전체 보기 →
                  </button>
                </div>
                {recent.map((d) => (
                  <button key={d.id} className="row" onClick={() => navigate(`/wiki/${d.id}`)}>
                    <span className="tag">{categoryShort[d.category]}</span>
                    <span className="grow">{d.title}</span>
                    <span className="muted">{d.updatedBy}</span>
                    <span className="muted">{d.updatedAt.slice(5)}</span>
                  </button>
                ))}
              </div>

              <div className="panel">
                <div className="panel-head">
                  <span className="label strong">{isAdmin ? '승인 대기 요청' : '내 최근 요청'}</span>
                  <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => navigate(requestsPath)}>
                    {isAdmin ? '승인 관리' : '전체 보기'} →
                  </button>
                </div>
                {requests.map((r) => (
                  <button key={r.id} className="row" onClick={() => navigate(requestsPath)}>
                    <span className="tag">{r.kind}</span>
                    <span className="grow">{r.title}</span>
                    {isAdmin && <span className="muted">{r.by}</span>}
                    <span className="muted">{r.at.slice(5, 10)}</span>
                    <StatusTag status={r.status} />
                  </button>
                ))}
                {requests.length === 0 && (
                  <div className="row muted">{isAdmin ? '대기 중인 요청이 없습니다' : '제출한 요청이 없습니다'}</div>
                )}
              </div>
            </div>

            <div className="right">
              <CliStatus />

              <div className="panel">
                <div className="panel-head">
                  <span className="label strong">관련 사이트 바로가기</span>
                </div>
                <div className="link-grid">
                  {relatedSites.map((s) => (
                    <a key={s.title} className="link-card" href={s.url} target="_blank" rel="noreferrer">
                      <span className="t">{s.title} ↗</span>
                      <span>{s.desc}</span>
                    </a>
                  ))}
                </div>
              </div>

              <div className="panel">
                <div className="panel-head">
                  <span className="label strong">자주 쓰는 GNB 편성표</span>
                  <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => navigate('/sheets')}>
                    전체 보기 →
                  </button>
                </div>
                {sheets.slice(0, 4).map((s) => (
                  <button key={s.id} className="row" onClick={() => navigate(`/sheets?id=${s.id}`)}>
                    <span className="grow">{s.name}</span>
                    <span className="muted">→</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
