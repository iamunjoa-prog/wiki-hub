import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TopBar } from '../components/AppShell'
import { categoryShort, docCommits } from '../data/docs'
import { useApp } from '../store/AppStore'

const headingId = (text: string) => `h-${text.trim().replace(/\s+/g, '-')}`

interface Heading {
  level: 2 | 3
  text: string
}

function parseHeadings(body: string): Heading[] {
  return body
    .split('\n')
    .map((l) => l.match(/^(#{2,3})\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ level: m[1].length as 2 | 3, text: m[2].trim() }))
}

export function WikiDoc() {
  const { docId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const { docs } = useApp()
  const doc = docs.find((d) => d.id === docId)
  const [showHistory, setShowHistory] = useState(false)
  const [activeHeading, setActiveHeading] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)

  const headings = useMemo(() => (doc ? parseHeadings(doc.body) : []), [doc])
  // location.hash는 퍼센트 인코딩된 상태다 — getElementById는 원문(디코딩된) id로 찾아야 한다
  const hashId = location.hash ? decodeURIComponent(location.hash.slice(1)) : null

  /**
   * 다른 문서로 이동하면 스크롤을 밑에 남겨 두지 않고 맨 위에서 새로 읽는다.
   * 단, 다른 문서의 특정 소제목을 가리키는 링크(`#h-...`)를 타고 왔으면
   * 그 소제목이 시작하는 위치로 바로 스크롤한다 — 문서 맨 위부터 다시 찾게 하지 않는다.
   */
  useEffect(() => {
    if (hashId) {
      const el = document.getElementById(hashId)
      if (el) {
        el.scrollIntoView({ block: 'start' })
        return
      }
    }
    contentRef.current?.scrollTo({ top: 0 })
  }, [docId, hashId])

  useEffect(() => {
    setShowHistory(false)
    setActiveHeading(hashId && headings.some((h) => headingId(h.text) === hashId) ? hashId : headings[0] ? headingId(headings[0].text) : null)
  }, [docId, headings, hashId])

  useEffect(() => {
    if (headings.length === 0) return
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting)
        if (visible[0]) setActiveHeading(visible[0].target.id)
      },
      { rootMargin: '0px 0px -70% 0px', threshold: 0 },
    )
    headings.forEach((h) => {
      const el = document.getElementById(headingId(h.text))
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [headings, docId])

  if (!doc) {
    return (
      <>
        <TopBar />
        <div className="content">
          <div className="empty">문서를 찾을 수 없습니다</div>
        </div>
      </>
    )
  }

  const commits = docCommits[doc.id] ?? [
    { version: doc.version, author: doc.updatedBy, at: doc.updatedAt, message: '문서 등록' },
  ]

  return (
    <>
      <TopBar />
      <div className="content flush" style={{ overflow: 'auto' }} ref={contentRef}>
        <div className="doc-layout">
          <div className="doc-body">
            <div className="doc-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <h1>{doc.title}</h1>
                <div className="doc-meta">
                  <span className="tag">{categoryShort[doc.category]}</span>
                  <span className="tag">{doc.code}</span>
                  <span>
                    최종 수정 {doc.updatedBy} · {doc.updatedAt} · v{doc.version}
                  </span>
                </div>
              </div>
              <button className="btn sm" onClick={() => setShowHistory((v) => !v)}>
                ⎇ 히스토리
              </button>
              <button className="btn sm primary" onClick={() => navigate(`/wiki/${doc.id}/propose`)}>
                ✎ 수정 제안
              </button>
            </div>

            {showHistory && (
              <div className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-head">
                  <span className="label strong">수정 이력</span>
                </div>
                {commits.map((c) => (
                  <div key={c.version} className="row">
                    <span className="tag">v{c.version}</span>
                    <span className="grow">{c.message}</span>
                    <span className="muted">{c.author}</span>
                    <span className="muted">{c.at}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="md">
              <ReactMarkdown
                remarkPlugins={[[remarkGfm, { singleTilde: false }]]}
                components={{
                  h2: ({ children }) => <h2 id={headingId(String(children))}>{children}</h2>,
                  h3: ({ children }) => <h3 id={headingId(String(children))}>{children}</h3>,
                  a: ({ href, children }) => {
                    // 문서 코드 뒤에 #소제목을 붙이면(예: PPC-P-02#h-다크패턴-대응) 그 소제목으로 바로 스크롤한다
                    const [code, anchor] = (href ?? '').split('#')
                    const target = docs.find((d) => d.code === code)
                    if (target) {
                      const to = `/wiki/${target.id}${anchor ? `#${anchor}` : ''}`
                      return (
                        <a
                          href={to}
                          onClick={(e) => {
                            e.preventDefault()
                            navigate(to)
                          }}
                          style={{ borderBottom: '1px solid var(--line)' }}
                        >
                          {children}
                        </a>
                      )
                    }
                    return (
                      <a href={href} target="_blank" rel="noreferrer" style={{ borderBottom: '1px solid var(--line)' }}>
                        {children}
                      </a>
                    )
                  },
                }}
              >
                {doc.body}
              </ReactMarkdown>
            </div>
          </div>

          <nav className="doc-toc">
            <div className="label" style={{ marginBottom: 8 }}>
              목차
            </div>
            {headings.map((h) => {
              const id = headingId(h.text)
              return (
                <a
                  key={id}
                  href={`#${id}`}
                  className={`${h.level === 3 ? 'h3' : ''}${activeHeading === id ? ' on' : ''}`}
                  onClick={(e) => {
                    e.preventDefault()
                    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                >
                  {h.text}
                </a>
              )
            })}
          </nav>
        </div>
      </div>
    </>
  )
}
