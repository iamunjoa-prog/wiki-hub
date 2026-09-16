import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { categories } from '../data/docs'
import type { ScheduleLeaf } from '../data/scheduleNav'
import { isGroup, scheduleNav, scheduleTrail } from '../data/scheduleNav'
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

  /**
   * 카테고리는 한 번에 하나만 펼친다.
   * 누르는 족족 쌓이면 문서가 많은 인사이트·프로모션에서 목록이 화면을 넘겨
   * 정작 찾던 문서가 스크롤 밖으로 밀린다.
   */
  const [openCategory, setOpenCategory] = useState<string | null>(currentCategory ?? null)

  useEffect(() => {
    if (currentCategory) setOpenCategory(currentCategory)
  }, [currentCategory])

  const toggle = (id: string) => setOpenCategory((prev) => (prev === id ? null : id))

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
          const open = openCategory === c.id
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

// 편성/스케줄 > B tv · 모바일 B tv > (홈 묶음 | 단일 화면). 트리 정의는 data/scheduleNav.ts 한 곳에 둔다.
function ScheduleTree() {
  const location = useLocation()
  const navigate = useNavigate()

  const inSchedule = location.pathname.startsWith('/sheets')
  const rootOn = location.pathname === '/sheets'
  const here = location.pathname

  /** 지금 보고 있는 화면이 속한 플랫폼·묶음 — 열어 둔 채로 보여야 위치를 알 수 있다 */
  const trail = scheduleTrail(here)
  const activePlatform = trail?.[1] ?? null
  const activeGroup = trail?.length === 4 ? trail[2] : null

  const [openPlatform, setOpenPlatform] = useState<string | null>(activePlatform ?? 'B tv')
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup)

  useEffect(() => {
    if (activePlatform) setOpenPlatform(activePlatform)
    if (activeGroup) setOpenGroup(activeGroup)
  }, [activePlatform, activeGroup])

  const leaf = (l: ScheduleLeaf) => (
    <button
      key={l.path}
      className={`nav-item sub leaf${here === l.path ? ' on' : ''}`}
      onClick={() => navigate(l.path)}
    >
      <span className="nav-ellipsis">{l.label}</span>
      {l.soon && <span className="nav-soon">{l.soon}</span>}
    </button>
  )

  return (
    <div className="nav-group">
      <NavLink to="/sheets" end className={`nav-item${rootOn ? ' on' : inSchedule ? ' trail' : ''}`}>
        편성/스케줄
      </NavLink>
      <div className="nav-children">
        {scheduleNav.map((platform) => {
          const open = openPlatform === platform.label
          const onTrail = activePlatform === platform.label
          return (
            <div key={platform.label}>
              <div className={`nav-item sub has-toggle${onTrail ? ' trail' : ''}`}>
                <button
                  className="nav-toggle"
                  onClick={() => setOpenPlatform((o) => (o === platform.label ? null : platform.label))}
                  aria-expanded={open}
                  aria-label={`${platform.label} ${open ? '접기' : '펼치기'}`}
                >
                  <Chevron open={open} />
                </button>
                <button
                  className="nav-label"
                  onClick={() => setOpenPlatform((o) => (o === platform.label ? null : platform.label))}
                >
                  {platform.label}
                </button>
              </div>
              {open && (
                <div className="nav-children depth2">
                  {platform.children.map((node) => {
                    if (!isGroup(node)) return leaf(node)
                    const key = node.label
                    const groupOpen = openGroup === key || activeGroup === key
                    const groupTrail = onTrail && activeGroup === key
                    return (
                      <div key={key}>
                        <div className={`nav-item sub has-toggle${groupTrail ? ' trail' : ''}`}>
                          <button
                            className="nav-toggle"
                            onClick={() => setOpenGroup((o) => (o === key ? null : key))}
                            aria-expanded={groupOpen}
                            aria-label={`${key} ${groupOpen ? '접기' : '펼치기'}`}
                          >
                            <Chevron open={groupOpen} />
                          </button>
                          <button className="nav-label" onClick={() => setOpenGroup((o) => (o === key ? null : key))}>
                            {key}
                          </button>
                        </div>
                        {groupOpen && <div className="nav-children depth3">{node.children.map(leaf)}</div>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
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
