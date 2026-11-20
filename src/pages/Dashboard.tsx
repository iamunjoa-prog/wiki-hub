import { useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { CliStatus } from '../components/CliStatus'
import { SystemCard } from '../components/SystemCard'
import { categories, categoryShort } from '../data/docs'
import { countWeeklyUpdates, kstDate, weekStartLabel } from '../lib/weeklyUpdates'
import { useApp } from '../store/AppStore'
import type { ProposalStatus } from '../types'

function StatusTag({ status, doc }: { status: ProposalStatus; doc?: boolean }) {
  // 문서 제안은 GitHub PR — 머지돼도 다음 배포 전까지는 화면에 안 나오므로 "승인됨"이라 쓰지 않는다
  if (doc) {
    if (status === 'approved') return <span className="tag ok">머지됨</span>
    if (status === 'rejected') return <span className="tag no">닫힘</span>
    return <span className="tag wait">대기 중</span>
  }
  if (status === 'approved') return <span className="tag ok">승인됨</span>
  if (status === 'rejected') return <span className="tag no">반려됨</span>
  return <span className="tag wait">대기 중</span>
}

export function Dashboard() {
  const { docs, proposals: prs, ensureProposals, promotions, systems, systemRequests, favoriteSystems, session, openQuestionTemplate } = useApp()
  const proposals = prs ?? []
  useEffect(() => ensureProposals(), [ensureProposals])
  const navigate = useNavigate()
  const isAdmin = session.role === 'admin'

  const byCategory = categories.map((c) => ({
    label: c.label,
    count: docs.filter((d) => d.category === c.id).length,
  }))
  const pending =
    proposals.filter((p) => p.status === 'pending').length +
    promotions.filter((p) => p.status === 'pending').length +
    systemRequests.filter((r) => r.status === 'pending').length

  // 별표를 켠 시스템만 — 순서는 시스템 화면과 같게 목록 순서를 따른다
  const favorites = systems.filter((s) => favoriteSystems.includes(s.id))

  const recent = [...docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 7)
  const today = kstDate()
  const weekly = countWeeklyUpdates(docs.map((d) => d.updatedAt), today)
  const tour = docs.find((d) => d.code === 'HUB-01')

  // 처음 온 사람이 첫 화면에서 바로 누를 업무 — 역할과 상관없이 같은 4장, 같은 순서
  const tasks = [
    { name: '프로모션 기획', desc: '상품과 혜택을 고르면 질문 문장이 완성됩니다', hint: '챗봇에서 빈칸 채우기 →', go: () => openQuestionTemplate('plan') },
    { name: '편성 확인', desc: '홈 Today B tv 편성을 날짜별로 확인합니다', hint: '편성표 열기 →', go: () => navigate('/sheets/btv') },
    { name: '정책 확인', desc: '월정액(PPM)·단건(PPV) 프로모션 정책 문서를 모아 봅니다', hint: '정책 문서 보기 →', go: () => navigate('/wiki?category=promotion&sub=policy') },
    { name: '시스템 사용법', desc: 'ACS·CBS·Swing 매뉴얼에서 화면별 사용법을 찾습니다', hint: '매뉴얼 보기 →', go: () => navigate('/wiki?category=promotion&sub=system') },
  ]

  // 관리자는 전체 대기 건, 실무자는 본인 요청을 최신순으로
  const requests = [
    ...proposals.map((p) => ({ id: `pr-${p.prNumber}`, kind: '문서', title: p.docTitle, by: p.requestedBy, at: p.requestedAt, status: p.status })),
    ...promotions.map((p) => ({ id: p.id, kind: '편성표', title: `${p.sheetName} 승격`, by: p.requestedBy, at: p.requestedAt, status: p.status })),
    ...systemRequests.map((r) => ({ id: r.id, kind: '시스템', title: `${r.name} ${r.targetSystemId ? '접속 주소' : ''} 등록`, by: r.requestedBy, at: r.requestedAt, status: r.status })),
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
          <div className="task-head">
            <h2 className="label strong">오늘 무엇을 하시나요?</h2>
            {tour && (
              <span className="task-first">
                처음이라면: <Link to={`/wiki/${tour.id}`}>{tour.title}</Link>
              </span>
            )}
          </div>
          <div className="task-grid">
            {tasks.map((t) => (
              <button key={t.name} type="button" className="link-card task-card" onClick={t.go}>
                <span className="t">{t.name}</span>
                <span className="muted">{t.desc}</span>
                <span className="mono muted">{t.hint}</span>
              </button>
            ))}
          </div>

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
              <span className="sub muted">{weekStartLabel(today)}</span>
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
                <b>{proposals.filter((p) => p.status === 'pending' && p.requestedBy === session.name).length}</b>
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
                    <StatusTag status={r.status} doc={r.kind === '문서'} />
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
                  <span className="label strong">시스템 바로가기</span>
                  <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => navigate('/systems')}>
                    전체 보기 →
                  </button>
                </div>
                {favorites.length > 0 ? (
                  <div className="sys-grid">
                    {favorites.map((s) => (
                      <SystemCard key={s.id} system={s} />
                    ))}
                  </div>
                ) : (
                  <div className="empty">
                    <div className="box" />
                    시스템 바로가기 화면에서 별표를 누르면 여기에 모입니다
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
