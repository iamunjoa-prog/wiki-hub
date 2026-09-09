import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { categoryShort, relatedSites } from '../data/docs'
import { useApp } from '../store/AppStore'

export function Dashboard() {
  const { docs, sheets, proposals, promotions, session } = useApp()
  const navigate = useNavigate()

  const byCategory = {
    insight: docs.filter((d) => d.category === 'insight').length,
    marketing: docs.filter((d) => d.category === 'marketing').length,
    programming: docs.filter((d) => d.category === 'programming').length,
  }
  const pending =
    proposals.filter((p) => p.status === 'pending').length +
    promotions.filter((p) => p.status === 'pending').length

  const recent = [...docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5)
  const weekly = docs.filter((d) => d.updatedAt >= '2026-08-25').length

  return (
    <>
      <TopBar>
        <span className="btn sm">알림 3</span>
      </TopBar>
      <div className="content">
        <div className="kpi-grid">
          <div className="kpi">
            <span className="label">전체 문서</span>
            <b>{docs.length}</b>
          </div>
          <div className="kpi">
            <span className="label">카테고리별</span>
            <span className="sub">
              인사이트 {byCategory.insight} / 마케팅 {byCategory.marketing} / 편성{' '}
              {byCategory.programming}
            </span>
          </div>
          <div className="kpi">
            <span className="label">이번 주 업데이트</span>
            <b>{weekly}</b>
          </div>
          {session.role === 'admin' ? (
            <button className="kpi" onClick={() => navigate('/approvals')}>
              <span className="label strong">승인 대기</span>
              <b>{pending}</b>
              <span className="sub muted">→ 승인 관리</span>
            </button>
          ) : (
            <button className="kpi" onClick={() => navigate('/requests')}>
              <span className="label">내 대기 요청</span>
              <b>{proposals.filter((p) => p.status === 'pending').length}</b>
              <span className="sub muted">→ 내 요청 현황</span>
            </button>
          )}
        </div>

        <div className="dash-cols">
          <div className="left panel">
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

          <div className="right">
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

            <div className="panel" style={{ background: 'var(--surface-subtle)' }}>
              <div className="panel-head">
                <span className="label strong">자주 쓰는 GNB 편성표</span>
              </div>
              <div style={{ padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sheets.slice(0, 4).map((s) => (
                  <button
                    key={s.id}
                    onClick={() => navigate(`/sheets?id=${s.id}`)}
                    style={{
                      border: 0,
                      background: 'none',
                      padding: 0,
                      textAlign: 'left',
                      font: '11.5px var(--mono)',
                      color: 'var(--text-2)',
                    }}
                  >
                    ↗ {s.name}
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
