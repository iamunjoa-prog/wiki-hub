import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { categories } from '../data/docs'
import { useApp } from '../store/AppStore'
import { AssistantDock } from './AssistantDock'

function WikiTree() {
  const { docs } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const activeDocId = location.pathname.startsWith('/wiki/')
    ? location.pathname.split('/')[2]
    : null
  const activeDoc = docs.find((d) => d.id === activeDocId)

  const [expanded, setExpanded] = useState<string[]>(
    activeDoc ? [activeDoc.category] : ['insight'],
  )

  useEffect(() => {
    if (activeDoc) setExpanded((prev) => (prev.includes(activeDoc.category) ? prev : [...prev, activeDoc.category]))
  }, [activeDoc])

  const toggle = (id: string) =>
    setExpanded((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  return (
    <>
      {categories.map((c) => {
        const open = expanded.includes(c.id)
        const children = docs.filter((d) => d.category === c.id)
        return (
          <div key={c.id}>
            <button className="nav-item sub" onClick={() => toggle(c.id)}>
              {open ? '▾' : '▸'} {c.label}
            </button>
            {open &&
              children.map((d) => (
                <button
                  key={d.id}
                  className={`nav-item sub depth2${d.id === activeDocId ? ' on' : ''}`}
                  onClick={() => navigate(`/wiki/${d.id}`)}
                >
                  {d.title}
                </button>
              ))}
          </div>
        )
      })}
    </>
  )
}

function Sidebar() {
  const { session, setRole, proposals, promotions } = useApp()
  const location = useLocation()
  const pendingCount =
    proposals.filter((p) => p.status === 'pending').length +
    promotions.filter((p) => p.status === 'pending').length

  const inWiki = location.pathname.startsWith('/wiki')
  const inSheets = location.pathname.startsWith('/sheets')

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="dot" />
        본부 지식 허브
      </div>
      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? ' on' : ''}`}>
          대시보드
        </NavLink>

        <NavLink to="/wiki" end className={({ isActive }) => `nav-item${isActive ? ' on' : ''}`}>
          위키 문서
        </NavLink>
        {inWiki ? (
          <WikiTree />
        ) : (
          categories.map((c) => (
            <NavLink key={c.id} to={`/wiki?category=${c.id}`} className="nav-item sub">
              {c.label}
            </NavLink>
          ))
        )}

        <NavLink to="/sheets" className={() => `nav-item${inSheets ? ' on' : ''}`}>
          GNB별 편성표
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
        <div className="rail">
          <button onClick={openDock} aria-label="어시스턴트 열기" title="편성·마케팅 어시스턴트" />
          <span className="vlabel">챗봇 열기</span>
          {assistant.campaignDraft && <span className="badge">캠페인 조건 대기</span>}
        </div>
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}
