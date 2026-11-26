import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { CliStatus } from '../components/CliStatus'
import { freshnessOf, FreshLamp } from '../components/DocBits'
import { Icon, type IconName } from '../components/Icon'
import { SystemCard } from '../components/SystemCard'
import { categories, subcategories } from '../data/docs'
import { ENGINE_NAME, SUGGESTED_QUESTIONS } from '../lib/assistant'
import { kstToday } from '../lib/scheduleApi'
import { useApp } from '../store/AppStore'
import type { Engine, ProposalStatus } from '../types'

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

const CATEGORY_ICON: Record<string, IconName> = { guide: 'book', promotion: 'megaphone', programming: 'grid-time' }
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
// 별표가 늘어도 오른쪽 열이 왼쪽보다 길어지지 않게 — 나머지는 시스템 화면에서 본다
const FAVORITE_LIMIT = 3

/** 인사 줄 오른쪽 엔진 상태 한 줄 — 미연결이면 공용 설정 창을, 연결됐으면 하단 왼쪽 '챗봇 답변 엔진' 칸을 연다 */
function EngineLine() {
  const { assistant, openEngineSettings } = useApp()
  const engines = assistant.engines
  const usable = engines ? (Object.keys(ENGINE_NAME) as Engine[]).filter((e) => engines[e]) : []
  const [lamp, text] =
    // 확인 전(undefined)을 먼저 본다 — 확인 전에도 engines 는 null 이라 '엔진 없음'으로 잘못 보인다
    assistant.engineStatus === undefined
      ? ['', '답변 엔진 확인 중']
      : engines === null
        ? ['', '엔진 없이 문서 기준으로 답해요']
        : usable.length > 0
          ? ['ok', `${usable.map((e) => ENGINE_NAME[e]).join('·')} 연결됨`]
          : ['warn', '엔진 연결 안 됨 · 연결 설정 ›']
  return (
    <a
      href="#engine"
      className="dash-engine"
      onClick={(e) => {
        e.preventDefault()
        // 연결하러 가는 사람은 칸까지 내려가지 않고 바로 [로그인]이 있는 창을 본다 (F2)
        if (assistant.engineStatus && usable.length === 0) openEngineSettings()
        else document.getElementById('engine')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }}
    >
      <span className={`lamp ${lamp}`} aria-hidden="true" />
      {text}
    </a>
  )
}

/**
 * 홈 — 인사 줄 · 묻기 바 · 카테고리 타일 · 큐 카드 · 하단 두 열 (identity-redesign 3-3, 4-1).
 * 하단 왼쪽 = 최근 갱신 문서 + 챗봇 답변 엔진, 오른쪽 = 내 요청 + 자주 쓰는 시스템 (home-engine-assistant-cards 4-1).
 * '이번 주 큐'는 편성표 데이터 연결 뒤(2차)에 붙인다 — 그 전에는 자리를 그리지 않는다
 */
export function Dashboard() {
  const { docs, proposals: prs, ensureProposals, promotions, systems, systemRequests, favoriteSystems, session, ask, openDock } = useApp()
  const proposals = prs ?? []
  useEffect(() => ensureProposals(), [ensureProposals])
  const navigate = useNavigate()
  const isAdmin = session.role === 'admin'
  const [q, setQ] = useState('')

  const pending =
    proposals.filter((p) => p.status === 'pending').length +
    promotions.filter((p) => p.status === 'pending').length +
    systemRequests.filter((r) => r.status === 'pending').length
  // 사이드바 '내 요청' 배지와 같은 셈 — 문서 제안·편성표 승격·시스템 등록 중 내가 낸 대기 건
  const myPending =
    proposals.filter((p) => p.status === 'pending' && p.requestedBy === session.name).length +
    promotions.filter((p) => p.status === 'pending' && p.requestedBy === session.name).length +
    systemRequests.filter((r) => r.status === 'pending' && r.requestedBy === session.name).length

  // 별표를 켠 시스템만 — 순서는 시스템 화면과 같게 목록 순서를 따른다
  const favorites = systems.filter((s) => favoriteSystems.includes(s.id))

  const recent = [...docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 7)
  // 오늘(KST) 포함 최근 7일 — 날짜를 박아 두면 시간이 지나며 전체 문서 수와 같아진다
  const weekAgo = kstToday(new Date(Date.now() - 6 * 24 * 60 * 60 * 1000))
  const weekly = docs.filter((d) => d.updatedAt >= weekAgo).length
  // 확인 필요 = 갱신일 기준 31일 넘은 문서(확인 권장 + 오래됨). 확인일 칸이 생기면 3차에 그 기준으로
  const needCheck = docs.filter((d) => freshnessOf(d.updatedAt).level !== 'ok').length

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

  const today = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const greet = `${today.getUTCMonth() + 1}월 ${today.getUTCDate()}일 ${WEEKDAY[today.getUTCDay()]}요일`

  const askNow = (text: string) => {
    const t = text.trim()
    if (t) ask(t)
    else openDock()
  }

  return (
    <>
      {/* 묻기 바의 [묻기]가 이 화면의 빨간 버튼 하나다 — 상단바 묻기는 테두리형으로 */}
      <TopBar ask="line" />
      <div className="content">
        <div className="dash-wrap">
          <div className="dash-greet">
            <h1>
              {greet} <span className="muted">· 오늘의 큐</span>
            </h1>
            <EngineLine />
          </div>

          <form
            className="ask-bar"
            onSubmit={(e) => {
              e.preventDefault()
              if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`)
            }}
          >
            <Icon name="search" size={20} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="무엇을 찾으세요?  예) 띠배너 규격, PPM 프로모션 정책"
              aria-label="문서 검색 또는 큐 어시스턴트에게 묻기"
            />
            <span className="ask-bar-hint">Enter 검색</span>
            <button type="button" className="btn ask-bar-btn" onClick={() => askNow(q)} title="큐 어시스턴트에게 이 질문을 보내요">
              <Icon name="ask" />
              묻기
            </button>
          </form>
          <div className="suggest ask-bar-chips">
            {SUGGESTED_QUESTIONS.slice(0, 3).map((s) => (
              <button key={s} type="button" onClick={() => ask(s)}>
                {s}
              </button>
            ))}
          </div>

          {/* 카테고리 타일 — 1단 순서 그대로, 안에 2단 바로가기. 홈 → 배너 규격 1클릭 */}
          <div className="cat-tiles">
            {categories.map((c) => {
              const inCat = docs.filter((d) => d.category === c.id)
              const subs = (subcategories[c.id] ?? [])
                .map((s) => ({ ...s, count: inCat.filter((d) => d.subcategory === s.id).length }))
                .filter((s) => s.count > 0)
              return (
                <section key={c.id} className={`cat-tile${inCat.length === 0 ? ' is-empty' : ''}`} data-cat={c.id}>
                  <Link className="cat-tile-head" to={`/wiki?category=${c.id}`}>
                    <Icon name={CATEGORY_ICON[c.id] ?? 'book'} size={20} />
                    <b>{c.label}</b>
                    <span className="cat-tile-count">{inCat.length > 0 ? <span className="tc">{inCat.length}</span> : '준비중'}</span>
                  </Link>
                  {inCat.length === 0 ? (
                    // 막다른 길이 되지 않게 지금 쓸 수 있는 편성표 화면으로 보낸다
                    <div className="cat-tile-body">
                      <span className="muted">문서가 생기면 여기에 모여요</span>
                      <Link to="/sheets">편성표 화면 ›</Link>
                    </div>
                  ) : subs.length > 0 ? (
                    <div className="cat-tile-body">
                      {subs.slice(0, 4).map((s) => (
                        <Link key={s.id} to={`/wiki?category=${c.id}&sub=${s.id}`}>
                          {s.label}
                          <span className="tc">{s.count}</span>
                        </Link>
                      ))}
                    </div>
                  ) : (
                    <div className="cat-tile-body">
                      {inCat.slice(0, 4).map((d) => (
                        <Link key={d.id} to={`/wiki/${d.id}`}>
                          {d.title}
                        </Link>
                      ))}
                    </div>
                  )}
                </section>
              )
            })}
          </div>

          {/* 큐 카드 — 처리할 일 · 바뀐 것 · 확인할 것 · 전체 */}
          <div className="kpi-grid dash-queue">
            {isAdmin ? (
              <button className="kpi" onClick={() => navigate('/approvals')}>
                <span className="label strong">승인 대기</span>
                <b className="tc">{pending}</b>
                <span className="sub muted">승인 관리 ›</span>
              </button>
            ) : (
              <button className="kpi" onClick={() => navigate('/requests')}>
                <span className="label">내 대기 요청</span>
                <b className="tc">{myPending}</b>
                <span className="sub muted">내 요청 ›</span>
              </button>
            )}
            <div className="kpi">
              <span className="label">최근 7일 갱신</span>
              <b className="tc">{weekly}</b>
              <span className="sub muted">오늘 포함 7일</span>
            </div>
            <div className="kpi">
              <span className="label">확인 필요</span>
              <b className="tc">
                {needCheck > 0 && <span className="lamp warn" aria-hidden="true" />} {needCheck}
              </b>
              <span className="sub muted">갱신일 기준 30일 넘음</span>
            </div>
            <button className="kpi" onClick={() => navigate('/wiki')}>
              <span className="label">전체 문서</span>
              <b className="tc">{docs.length}</b>
              <span className="sub muted">위키 ›</span>
            </button>
          </div>

          <div className="dash-cols">
            <div className="left">
              <div className="panel">
                <div className="panel-head">
                  <span className="label strong">최근 갱신 문서</span>
                  <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => navigate('/wiki')}>
                    전체 ›
                  </button>
                </div>
                {recent.map((d) => (
                  <button key={d.id} className="row dash-doc" data-cat={d.category} onClick={() => navigate(`/wiki/${d.id}`)}>
                    <span className="tc dash-doc-code">{d.code}</span>
                    <span className="grow">{d.title}</span>
                    <span className="muted dash-doc-by">{d.updatedBy}</span>
                    <span className="tc muted">{d.updatedAt.slice(5)}</span>
                    <FreshLamp updatedAt={d.updatedAt} />
                  </button>
                ))}
              </div>

              {/* 왼쪽 열 둘째 칸 — 열마다 칸 2개로 높이를 맞추고, 한 열로 내려앉을 때 둘째로 올라온다 */}
              <div id="engine">
                <CliStatus />
              </div>
            </div>

            <div className="right">
              <div className="panel">
                <div className="panel-head">
                  <span className="label strong">{isAdmin ? '승인 대기 요청' : '내 요청'}</span>
                  <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => navigate(requestsPath)}>
                    {isAdmin ? '승인 관리' : '전체'} ›
                  </button>
                </div>
                {requests.map((r) => (
                  <button key={r.id} className="row" onClick={() => navigate(requestsPath)}>
                    <span className="tag">{r.kind}</span>
                    <span className="grow">{r.title}</span>
                    {isAdmin && <span className="muted">{r.by}</span>}
                    <span className="tc muted">{r.at.slice(5, 10)}</span>
                    <StatusTag status={r.status} doc={r.kind === '문서'} />
                  </button>
                ))}
                {requests.length === 0 && (
                  <div className="row muted">{isAdmin ? '대기 중인 요청이 없어요' : '아직 낸 요청이 없어요'}</div>
                )}
              </div>

              <div className="panel">
                <div className="panel-head">
                  <span className="label strong">자주 쓰는 시스템</span>
                  <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => navigate('/systems')}>
                    전체 ›
                  </button>
                </div>
                {favorites.length > 0 ? (
                  <>
                    <div className="sys-grid">
                      {favorites.slice(0, FAVORITE_LIMIT).map((s) => (
                        <SystemCard key={s.id} system={s} />
                      ))}
                    </div>
                    {favorites.length > FAVORITE_LIMIT && (
                      <Link className="sys-more" to="/systems">
                        외 {favorites.length - FAVORITE_LIMIT}개 · 전체 ›
                      </Link>
                    )}
                  </>
                ) : (
                  <div className="empty">
                    <div className="box" />
                    시스템 화면에서 별표를 누르면 여기에 모여요
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
