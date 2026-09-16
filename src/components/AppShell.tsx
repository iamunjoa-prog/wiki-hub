import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { categories } from '../data/docs'
import { platformLabel } from '../data/sheets'
import type { SheetPlatform } from '../types'
import { useApp } from '../store/AppStore'
import { AssistantDock } from './AssistantDock'

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      className={`chev${open ? ' open' : ''}`}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m9 6 6 6-6 6" />
    </svg>
  )
}

// 위키 문서 > 카테고리 > 문서 트리. 어느 페이지에서든 같은 구조로 보이고,
// 화살표는 펼침/접힘만 담당한다(이동은 라벨 클릭).
function WikiTree() {
  const { docs } = useApp()
  const location = useLocation()
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const inWiki = location.pathname.startsWith('/wiki')
  const activeDocId = location.pathname.startsWith('/wiki/') ? location.pathname.split('/')[2] : null
  const activeDoc = docs.find((d) => d.id === activeDocId)
  const activeCategory = location.pathname === '/wiki' ? params.get('category') : null
  const currentCategory = activeDoc?.category ?? activeCategory

  const [expanded, setExpanded] = useState<string[]>(currentCategory ? [currentCategory] : [])

  useEffect(() => {
    if (currentCategory)
      setExpanded((prev) => (prev.includes(currentCategory) ? prev : [...prev, currentCategory]))
  }, [currentCategory])

  const toggle = (id: string) =>
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const rootOn = location.pathname === '/wiki' && !activeCategory

  return (
    <div className="nav-group">
      <NavLink
        to="/wiki"
        end
        className={`nav-item${rootOn ? ' on' : inWiki ? ' trail' : ''}`}
      >
        위키 문서
      </NavLink>
      <div className="nav-children">
        {categories.map((c) => {
          const open = expanded.includes(c.id)
          const children = docs.filter((d) => d.category === c.id)
          const catOn = activeCategory === c.id
          const catTrail = activeDoc?.category === c.id
          return (
            <div key={c.id}>
              <div className={`nav-item sub has-toggle${catOn ? ' on' : catTrail ? ' trail' : ''}`}>
                <button
                  className="nav-toggle"
                  onClick={() => toggle(c.id)}
                  aria-expanded={open}
                  aria-label={`${c.label} ${open ? '접기' : '펼치기'}`}
                >
                  <Chevron open={open} />
                </button>
                <button
                  className="nav-label"
                  onClick={() => {
                    navigate(`/wiki?category=${c.id}`)
                    if (!open) toggle(c.id)
                  }}
                >
                  {c.label}
                </button>
                <span className="nav-count">{children.length}</span>
              </div>
              {open && (
                <div className="nav-children depth2">
                  {children.length === 0 ? (
                    <div className="nav-empty">문서 없음</div>
                  ) : (
                    children.map((d) => (
                      <button
                        key={d.id}
                        className={`nav-item sub leaf${d.id === activeDocId ? ' on' : ''}`}
                        onClick={() => navigate(`/wiki/${d.id}`)}
                        title={d.title}
                      >
                        <span className="nav-ellipsis">{d.title}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

const HOME_LIST_URL = `/sheets?gnb=${encodeURIComponent('홈')}`
// B tv는 목록이 아니라 Today B tv 스케줄링 화면으로 바로 간다
const BTV_URL = '/sheets/btv'
// 모바일 B tv는 하위에 빅배너 스케줄 화면을 둔다
const BIG_BANNER_URL = '/sheets/mobile/big-banner'

// 편성/스케줄 > 홈(B tv · 모바일 B tv) · 캠페인. 캠페인은 하위 없이 바로 웹앱 화면으로 간다.
function ScheduleTree() {
  const location = useLocation()
  const [params] = useSearchParams()
  const navigate = useNavigate()

  const onList = location.pathname === '/sheets'
  const gnb = onList ? params.get('gnb') : null
  const platform = onList ? params.get('platform') : null
  const onBtv = location.pathname === '/sheets/btv'
  const onBigBanner = location.pathname === BIG_BANNER_URL
  const inHome = gnb === '홈' || onBtv || onBigBanner
  const onCampaign = location.pathname === '/sheets/campaign'
  const rootOn = onList && !gnb
  const inSchedule = location.pathname.startsWith('/sheets')

  const [homeOpen, setHomeOpen] = useState(inHome)
  useEffect(() => {
    if (inHome) setHomeOpen(true)
  }, [inHome])

  return (
    <div className="nav-group">
      <NavLink to="/sheets" end className={`nav-item${rootOn ? ' on' : inSchedule ? ' trail' : ''}`}>
        편성/스케줄
      </NavLink>
      <div className="nav-children">
        <div>
          <div
            className={`nav-item sub has-toggle${
              inHome && !platform && !onBtv && !onBigBanner ? ' on' : inHome ? ' trail' : ''
            }`}
          >
            <button
              className="nav-toggle"
              onClick={() => setHomeOpen((o) => !o)}
              aria-expanded={homeOpen}
              aria-label={`홈 ${homeOpen ? '접기' : '펼치기'}`}
            >
              <Chevron open={homeOpen} />
            </button>
            <button
              className="nav-label"
              onClick={() => {
                navigate(HOME_LIST_URL)
                setHomeOpen(true)
              }}
            >
              홈
            </button>
          </div>
          {homeOpen && (
            <div className="nav-children depth2">
              {(Object.keys(platformLabel) as SheetPlatform[]).map((p) => (
                <div key={p}>
                  <button
                    className={`nav-item sub leaf${
                      (p === 'btv' ? onBtv : inHome && platform === p) ? ' on' : p === 'mobile' && onBigBanner ? ' trail' : ''
                    }`}
                    onClick={() => navigate(p === 'btv' ? BTV_URL : `${HOME_LIST_URL}&platform=${p}`)}
                  >
                    {platformLabel[p]}
                  </button>
                  {/* 모바일 B tv 아래 빅배너 스케줄 — 시트를 그대로 옮긴 화면이라 목록을 거치지 않는다 */}
                  {p === 'mobile' && (
                    <div className="nav-children depth3">
                      <button
                        className={`nav-item sub leaf${onBigBanner ? ' on' : ''}`}
                        onClick={() => navigate(BIG_BANNER_URL)}
                      >
                        빅배너 스케줄
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <NavLink to="/sheets/campaign" className={`nav-item sub no-toggle${onCampaign ? ' on' : ''}`}>
          캠페인
        </NavLink>
      </div>
    </div>
  )
}

function Sidebar() {
  const { session, setRole, proposals, promotions } = useApp()
  const pendingCount =
    proposals.filter((p) => p.status === 'pending').length +
    promotions.filter((p) => p.status === 'pending').length

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="dot" />
        플랫폼 담당 지식 허브
      </div>
      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? ' on' : ''}`}>
          대시보드
        </NavLink>

        <WikiTree />

        <ScheduleTree />
        <NavLink to="/requests" className={({ isActive }) => `nav-item${isActive ? ' on' : ''}`}>
          내 요청 현황
        </NavLink>

        {session.role === 'admin' && (
          <NavLink to="/approvals" className={({ isActive }) => `nav-item${isActive ? ' on' : ''}`}>
            승인 관리
            <span className="count">{pendingCount}</span>
          </NavLink>
        )}
      </nav>

      <div className="sidebar-foot">
        <span>
          {session.name} · {session.team}
        </span>
        <button
          className="btn sm"
          style={{ marginLeft: 'auto' }}
          onClick={() => setRole(session.role === 'admin' ? 'member' : 'admin')}
          title="데모용 권한 전환"
        >
          {session.role === 'admin' ? '관리자' : '실무자'}
        </button>
      </div>
    </aside>
  )
}

export function TopBar({ children }: { children?: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    if (!location.pathname.startsWith('/search')) setQ('')
  }, [location.pathname])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="topbar">
      <form
        className="search-input"
        onSubmit={(e) => {
          e.preventDefault()
          if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`)
        }}
      >
        <span className="mono muted">⌕</span>
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="지식 문서 검색"
          aria-label="지식 문서 검색"
        />
        <span className="kbd">⌘K</span>
      </form>
      {children}
    </div>
  )
}

export function AppShell() {
  const { assistant, openDock, toast } = useApp()

  return (
    <div className="shell">
      <Sidebar />
      <div className="main">
        <Outlet />
      </div>
      {assistant.open ? (
        <AssistantDock />
      ) : (
        <button className="fab" onClick={openDock} title="무엇이든 물어보세요 — 편성·프로모션 챗봇">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
          </svg>
          챗봇
          {assistant.campaignDraft && <span className="fab-badge">프로모션 조건 대기</span>}
        </button>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
