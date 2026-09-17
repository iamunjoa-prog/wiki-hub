import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { categories, subcategories } from '../data/docs'
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
  const activeSub = location.pathname === '/wiki' ? params.get('sub') : null
  const currentCategory = activeDoc?.category ?? activeCategory
  const currentSub = activeDoc?.subcategory ?? activeSub

  /**
   * 카테고리는 한 번에 하나만 펼친다.
   * 누르는 족족 쌓이면 문서가 많은 프로모션에서 목록이 화면을 넘겨
   * 정작 찾던 문서가 스크롤 밖으로 밀린다. 서브메뉴도 카테고리 안에서 하나만 펼친다.
   */
  const [openCategory, setOpenCategory] = useState<string | null>(currentCategory ?? null)
  const [openSub, setOpenSub] = useState<string | null>(currentSub ?? null)

  useEffect(() => {
    if (currentCategory) setOpenCategory(currentCategory)
  }, [currentCategory])

  useEffect(() => {
    if (currentSub) setOpenSub(currentSub)
  }, [currentSub])

  const toggle = (id: string) => setOpenCategory((prev) => (prev === id ? null : id))
  const toggleSub = (id: string) => setOpenSub((prev) => (prev === id ? null : id))

  const rootOn = location.pathname === '/wiki' && !activeCategory

  const docLeaf = (d: (typeof docs)[number]) => (
    <button
      key={d.id}
      className={`nav-item sub leaf${d.id === activeDocId ? ' on' : ''}`}
      onClick={() => navigate(`/wiki/${d.id}`)}
      title={d.title}
    >
      <span className="nav-ellipsis">{d.title}</span>
    </button>
  )

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
          const catOn = activeCategory === c.id && !activeSub
          const catTrail = activeDoc?.category === c.id
          const subs = subcategories[c.id]
          // 서브메뉴가 있는 카테고리인데 소속이 없는 문서(예: 편성표 승격 문서)는 '기타'로 묶어 놓치지 않는다
          const unassigned = subs.length > 0 ? children.filter((d) => !subs.some((s) => s.id === d.subcategory)) : []
          const subsWithOthers = unassigned.length > 0 ? [...subs, { id: '__unassigned__', label: '기타' }] : subs

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
              {open && subs.length === 0 && (
                <div className="nav-children depth2">
                  {children.length === 0 ? (
                    <div className="nav-empty">문서 없음</div>
                  ) : (
                    children.map(docLeaf)
                  )}
                </div>
              )}
              {open && subsWithOthers.length > 0 && (
                <div className="nav-children depth2">
                  {subsWithOthers.map((s) => {
                    const subOpen = openSub === s.id
                    const subChildren = s.id === '__unassigned__' ? unassigned : children.filter((d) => d.subcategory === s.id)
                    const subOn = activeCategory === c.id && activeSub === s.id
                    const subTrail = activeDoc?.category === c.id && activeDoc?.subcategory === s.id
                    return (
                      <div key={s.id}>
                        <div className={`nav-item sub has-toggle${subOn ? ' on' : subTrail ? ' trail' : ''}`}>
                          <button
                            className="nav-toggle"
                            onClick={() => toggleSub(s.id)}
                            aria-expanded={subOpen}
                            aria-label={`${s.label} ${subOpen ? '접기' : '펼치기'}`}
                          >
                            <Chevron open={subOpen} />
                          </button>
                          <button
                            className="nav-label"
                            onClick={() => {
                              navigate(`/wiki?category=${c.id}&sub=${s.id}`)
                              if (!subOpen) toggleSub(s.id)
                            }}
                          >
                            {s.label}
                          </button>
                          <span className="nav-count">{subChildren.length}</span>
                        </div>
                        {subOpen && (
                          <div className="nav-children depth3">
                            {subChildren.length === 0 ? (
                              <div className="nav-empty">문서 없음</div>
                            ) : (
                              subChildren.map(docLeaf)
                            )}
                          </div>
                        )}
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

/* ---------- 사이드바 너비 조절 ---------- */

const SIDEBAR_W_KEY = 'sidebar-width'
const SIDEBAR_W_MIN = 200
const SIDEBAR_W_MAX = 420
const clampSidebarWidth = (w: number) => Math.min(Math.max(w, SIDEBAR_W_MIN), SIDEBAR_W_MAX)

function readStoredSidebarWidth() {
  try {
    const raw = localStorage.getItem(SIDEBAR_W_KEY)
    if (raw) return clampSidebarWidth(Number(raw))
  } catch {
    /* 저장소를 못 쓰는 브라우저면 기본값으로 */
  }
  return 248
}

/** 오른쪽 경계를 마우스로 끌어 사이드바 너비를 바꾼다. 드래그 중엔 본문이 선택되지 않게 body에 클래스를 건다. */
function useSidebarResize() {
  const [width, setWidth] = useState(readStoredSidebarWidth)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => setWidth(clampSidebarWidth(e.clientX))
    const onUp = () => setDragging(false)
    document.body.classList.add('resizing-x')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      document.body.classList.remove('resizing-x')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging])

  useEffect(() => {
    if (dragging) return
    try {
      localStorage.setItem(SIDEBAR_W_KEY, String(width))
    } catch {
      /* 저장 못 해도 이번 세션 너비는 유지된다 */
    }
  }, [dragging, width])

  /** 키보드로도 조절 — 화살표 16px, 홈/엔드로 최소·최대 */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16
    if (e.key === 'ArrowLeft') setWidth((w) => clampSidebarWidth(w - step))
    else if (e.key === 'ArrowRight') setWidth((w) => clampSidebarWidth(w + step))
    else if (e.key === 'Home') setWidth(SIDEBAR_W_MIN)
    else if (e.key === 'End') setWidth(SIDEBAR_W_MAX)
    else return
    e.preventDefault()
  }, [])

  return { width, dragging, startDrag: () => setDragging(true), onKeyDown }
}

function Sidebar() {
  const { session, setRole, proposals, promotions, systemRequests } = useApp()
  const pendingCount =
    proposals.filter((p) => p.status === 'pending').length +
    promotions.filter((p) => p.status === 'pending').length +
    systemRequests.filter((r) => r.status === 'pending').length
  const { width, dragging, startDrag, onKeyDown } = useSidebarResize()

  return (
    <aside className="sidebar" style={{ width }}>
      <div
        className={`sidebar-resizer${dragging ? ' on' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="메뉴 너비 조절"
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault()
          startDrag()
        }}
        onKeyDown={onKeyDown}
      />
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

        <NavLink to="/systems" className={({ isActive }) => `nav-item${isActive ? ' on' : ''}`}>
          시스템
        </NavLink>

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
