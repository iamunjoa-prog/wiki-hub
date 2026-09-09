import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
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
  const { docs } = useApp()
  const doc = docs.find((d) => d.id === docId)
  const [showHistory, setShowHistory] = useState(false)
  const [activeHeading, setActiveHeading] = useState<string | null>(null)

  const headings = useMemo(() => (doc ? parseHeadings(doc.body) : []), [doc])

  useEffect(() => {
    setShowHistory(false)
    setActiveHeading(headings[0] ? headingId(headings[0].text) : null)
  }, [docId, headings])

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
      <div className="content flush" style={{ overflow: 'auto' }}>
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
                remarkPlugins={[remarkGfm]}
                components={{
                  h2: ({ children }) => <h2 id={headingId(String(children))}>{children}</h2>,
                  h3: ({ children }) => <h3 id={headingId(String(children))}>{children}</h3>,
                  a: ({ href, children }) => {
                    const target = docs.find((d) => d.code === href)
                    if (target)
                      return (
                        <a
                          href={`/wiki/${target.id}`}
                          onClick={(e) => {
                            e.preventDefault()
                            navigate(`/wiki/${target.id}`)
                          }}
                          style={{ borderBottom: '1px solid var(--line)' }}
                        >
                          {children}
                        </a>
                      )
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
