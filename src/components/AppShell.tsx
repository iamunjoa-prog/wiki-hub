import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { categories, subcategories } from '../data/docs'
import type { ScheduleLeaf } from '../data/scheduleNav'
import { isGroup, scheduleNav, scheduleTrail } from '../data/scheduleNav'
import { detectOs, forgetSessionSeen } from '../lib/localHub'
import { useApp } from '../store/AppStore'
import { AssistantDock } from './AssistantDock'
import { useAuth } from './AuthGate'
import { HubUpdateNotice } from './HubUpdateNotice'
import { ColorBarMark, Icon } from './Icon'
import { LocalHubOnboarding } from './LocalHubOnboarding'

/** 휴대폰 폭(760px 이하)에서 사이드바를 서랍으로 연다 — 버튼은 각 화면의 TopBar 에 있어 상태를 셸에서 나눠 준다 */
const DrawerContext = createContext<{ open: boolean; setOpen: (v: boolean) => void }>({ open: false, setOpen: () => {} })

export function Chevron({ open }: { open: boolean }) {
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

  // 문서가 0건인 메뉴는 막다른 길이라 맨 아래로 내리고 펼치지 못하게 한다. 건수는 문서 데이터에서 세므로 문서가 생기면 저절로 열린다
  const emptyRow = (key: string, label: string, level: 'cat' | 'sub' = 'sub') => (
    <div key={key} className={`nav-item ${level} no-toggle nav-unready`} aria-disabled="true" title={`${label} — 아직 문서가 없습니다`}>
      {level === 'cat' && <span className="cat-dot" aria-hidden="true" />}
      <span className="nav-ellipsis">{label}</span>
      <span className="nav-soon">준비중</span>
    </div>
  )
  const filledFirst = <T,>(items: T[], count: (item: T) => number) =>
    [...items].sort((a, b) => Number(count(b) > 0) - Number(count(a) > 0))

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
      {/* "위키 문서" 부모 줄 대신 묶음 제목 — 카테고리가 한 단계 덜 들어가 긴 문서 제목이 덜 잘린다 (identity-redesign 3-1) */}
      <div className="label nav-section nav-section-row">
        위키
        <NavLink to="/wiki" end className={`nav-section-link${rootOn ? ' on' : inWiki ? ' trail' : ''}`}>
          전체 <span className="tc">{docs.length}</span> ›
        </NavLink>
      </div>
      <div className="nav-cats">
        {filledFirst(categories, (c) => docs.filter((d) => d.category === c.id).length).map((c) => {
          const open = openCategory === c.id
          const children = docs.filter((d) => d.category === c.id)
          if (children.length === 0) return <div key={c.id} className="nav-cat" data-cat={c.id}>{emptyRow(c.id, c.label, 'cat')}</div>
          const catOn = activeCategory === c.id && !activeSub
          const catTrail = activeDoc?.category === c.id
          const subs = subcategories[c.id]
          // 서브메뉴가 있는 카테고리인데 소속이 없는 문서(예: 편성표 승격 문서)는 '기타'로 묶어 놓치지 않는다
          const unassigned = subs.length > 0 ? children.filter((d) => !subs.some((s) => s.id === d.subcategory)) : []
          const subsWithOthers = unassigned.length > 0 ? [...subs, { id: '__unassigned__', label: '기타' }] : subs

          return (
            <div key={c.id} className="nav-cat" data-cat={c.id}>
              <div className={`nav-item cat has-toggle${catOn ? ' on' : catTrail ? ' trail' : ''}`}>
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
                  <span className="cat-dot" aria-hidden="true" />
                  {c.label}
                </button>
                <span className="nav-count tc">{children.length}</span>
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
                  {filledFirst(subsWithOthers, (s) =>
                    s.id === '__unassigned__' ? unassigned.length : children.filter((d) => d.subcategory === s.id).length,
                  ).map((s) => {
                    const subOpen = openSub === s.id
                    const subChildren = s.id === '__unassigned__' ? unassigned : children.filter((d) => d.subcategory === s.id)
                    if (subChildren.length === 0) return emptyRow(s.id, s.label)
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

  // 다른 화면에서는 접어 둔다 — 늘 펼쳐 두면 아래 1단 메뉴가 첫 화면 밖으로 밀린다
  const [openPlatform, setOpenPlatform] = useState<string | null>(activePlatform ?? (inSchedule ? 'B tv' : null))
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
        <Icon name="grid-time" />
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

/** 상단바 검색 입력 — 사이드바 고정 줄의 [검색]도 같은 입력으로 포커스를 옮긴다 */
const SEARCH_INPUT_ID = 'hub-search'

function Sidebar({ drawerOpen }: { drawerOpen: boolean }) {
  const { session, setRole, proposals, promotions, systemRequests, chatLog, openDock } = useApp()
  const { user: account, signOut } = useAuth()
  const drawer = useContext(DrawerContext)
  // 대화 기록 메뉴는 저장 상태로만 고른다 — 내 PC용 허브는 데모 버튼으로 관리자가 돼도 기록을 읽을 API 가 없다
  const showMyChatLog = chatLog?.mine === true
  const showChatLog = account?.role === 'admin' && chatLog?.enabled === true
  const isAdmin = session.role === 'admin'
  const pendingCount =
    (proposals ?? []).filter((p) => p.status === 'pending').length +
    promotions.filter((p) => p.status === 'pending').length +
    systemRequests.filter((r) => r.status === 'pending').length
  const myPendingCount =
    (proposals ?? []).filter((p) => p.status === 'pending' && p.requestedBy === session.name).length +
    promotions.filter((p) => p.status === 'pending' && p.requestedBy === session.name).length +
    systemRequests.filter((r) => r.status === 'pending' && r.requestedBy === session.name).length
  const { width, dragging, startDrag, onKeyDown } = useSidebarResize()
  const navOn = ({ isActive }: { isActive: boolean }) => `nav-item${isActive ? ' on' : ''}`

  const focusSearch = () => {
    // 휴대폰 폭에서는 서랍이 검색창을 덮는다 — 닫은 뒤 포커스를 옮긴다
    drawer.setOpen(false)
    requestAnimationFrame(() => document.getElementById(SEARCH_INPUT_ID)?.focus())
  }

  return (
    <aside className={`sidebar${drawerOpen ? ' drawer-open' : ''}`} style={{ width }} id="app-sidebar">
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
      {/* 정식 이름은 그대로 두고 CUE 를 앞에 붙인다 — 방송 큐시트에서 온 표기, 상표 아님 (identity-redesign 1-3) */}
      <div className="brand">
        <ColorBarMark />
        <b className="brand-cue">CUE</b>
        <span className="brand-name">플랫폼 담당 지식 허브</span>
      </div>
      {/* 자주 쓰는 4개는 메뉴를 펼쳐도 밀리지 않게 스크롤 밖에 둔다 (identity-redesign 3-1) */}
      <div className="nav-fixed">
        <button type="button" className="nav-item nav-search" onClick={focusSearch}>
          <Icon name="search" />
          검색
          <span className="kbd">{detectOs() === 'mac' ? '⌘K' : 'Ctrl K'}</span>
        </button>
        <NavLink to="/" end className={navOn}>
          <Icon name="home" />
          홈
        </NavLink>
        <button type="button" className="nav-item" onClick={openDock}>
          <Icon name="ask" />
          묻기
          <span className="nav-hint">큐 어시스턴트</span>
        </button>
        {/* 관리자는 처리할 일이 먼저다 — 대시보드 요청 칸과 같이 승인 대기로 보낸다. 본인 요청은 '내 기록'에 둔다 */}
        {isAdmin ? (
          <NavLink to="/approvals" className={navOn}>
            <Icon name="inbox" />
            승인 대기
            {pendingCount > 0 && <span className="count tc">{pendingCount}</span>}
          </NavLink>
        ) : (
          <NavLink to="/requests" className={navOn}>
            <Icon name="inbox" />
            내 요청
            {myPendingCount > 0 && (
              <span className="count tc" title={`대기 중 ${myPendingCount}건`}>
                {myPendingCount}
              </span>
            )}
          </NavLink>
        )}
      </div>

      <nav className="nav">
        <WikiTree />

        <div className="label nav-section">업무 화면</div>
        <ScheduleTree />

        <NavLink to="/jira-schedule" className={navOn}>
          <Icon name="calendar" />
          Jira 스케줄 확인
        </NavLink>

        {/* 위키의 '시스템 매뉴얼'과 헷갈리지 않게 접속 주소 화면이라는 것을 이름에 담는다 */}
        <NavLink to="/systems" className={navOn}>
          <Icon name="link-out" />
          시스템 바로가기
        </NavLink>

        {(showMyChatLog || isAdmin) && (
          <>
            <div className="label nav-section">내 기록</div>
            {isAdmin && (
              <NavLink to="/requests" className={navOn}>
                <Icon name="inbox" />
                내 요청
              </NavLink>
            )}
            {showMyChatLog && (
              <NavLink to="/my-chat-log" className={navOn}>
                <Icon name="history" />
                내 대화 기록
              </NavLink>
            )}
          </>
        )}

        {isAdmin && (
          <>
            <div className="label nav-section">관리</div>
            <NavLink to="/approvals" className={navOn}>
              <Icon name="check-badge" />
              승인 관리
              <span className="count tc">{pendingCount}</span>
            </NavLink>
            {account?.role === 'admin' && (
              <NavLink to="/accounts" className={navOn}>
                <Icon name="users" />
                계정 관리
              </NavLink>
            )}
            {showChatLog && (
              <NavLink to="/chat-log" className={navOn}>
                <Icon name="history" />
                대화 기록
              </NavLink>
            )}
          </>
        )}
      </nav>

      <div className="sidebar-foot">
        <span>
          {session.name} · {session.team}
          {account?.role === 'admin' && ' · 관리자'}
        </span>
        {account ? (
          // 권한은 관리자가 계정 관리에서 정한다 — 화면에서 바꿀 수 없고 표시만 한다
          <button
            className="btn sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              // 같은 탭에서 다시 로그인해도 새 세션으로 보고 첫 안내 창 횟수를 센다
              forgetSessionSeen(account.loginId)
              signOut()
            }}
            title={account.loginId}
          >
            로그아웃
          </button>
        ) : (
          <button
            className="btn sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => setRole(session.role === 'admin' ? 'member' : 'admin')}
            title="데모용 권한 전환"
          >
            {session.role === 'admin' ? '관리자' : '실무자'}
          </button>
        )}
      </div>
    </aside>
  )
}

export function TopBar({ children }: { children?: React.ReactNode }) {
  const navigate = useNavigate()
  const location = useLocation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const drawer = useContext(DrawerContext)

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
      <button
        className="nav-burger"
        onClick={() => drawer.setOpen(!drawer.open)}
        aria-label={drawer.open ? '메뉴 닫기' : '메뉴 열기'}
        aria-expanded={drawer.open}
        aria-controls="app-sidebar"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
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
          id={SEARCH_INPUT_ID}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="지식 문서 검색"
          aria-label="지식 문서 검색"
        />
        {/* 실무자 PC는 Windows다 — 맥이 아니면 Ctrl 로 보여 준다(단축키는 둘 다 받는다) */}
        <span className="kbd">{detectOs() === 'mac' ? '⌘K' : 'Ctrl K'}</span>
      </form>
      {children}
    </div>
  )
}

export function AppShell() {
  const { assistant, openDock, toast } = useApp()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 메뉴를 고르면(주소가 바뀌면) 서랍을 닫는다
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawerOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen])

  return (
    <DrawerContext.Provider value={{ open: drawerOpen, setOpen: setDrawerOpen }}>
      <div className="shell">
        <Sidebar drawerOpen={drawerOpen} />
        {drawerOpen && <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)} aria-hidden="true" />}
        <div className="main">
          <HubUpdateNotice />
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
        <LocalHubOnboarding />
        {toast && <div className="toast">{toast}</div>}
      </div>
    </DrawerContext.Provider>
  )
}
