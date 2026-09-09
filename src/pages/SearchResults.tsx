import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { categories, categoryShort } from '../data/docs'
import { searchDocs, tokenize } from '../lib/retrieval'
import { useApp } from '../store/AppStore'
import type { CategoryId } from '../types'

function Highlight({ text, terms }: { text: string; terms: string[] }) {
  if (terms.length === 0 || !text) return <>{text}</>
  const pattern = new RegExp(`(${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return (
    <>
      {text.split(pattern).map((part, i) =>
        pattern.test(part) ? <mark key={i}>{part}</mark> : <span key={i}>{part}</span>,
      )}
    </>
  )
}

export function SearchResults() {
  const [params] = useSearchParams()
  const query = params.get('q') ?? ''
  const navigate = useNavigate()
  const { docs, ask } = useApp()
  const [category, setCategory] = useState<CategoryId | null>(null)
  const [sort, setSort] = useState<'relevance' | 'recent'>('relevance')

  const hits = useMemo(() => searchDocs(query, docs), [query, docs])
  const terms = useMemo(() => tokenize(query), [query])

  const filtered = category ? hits.filter((h) => h.doc.category === category) : hits
  const sorted =
    sort === 'recent'
      ? [...filtered].sort((a, b) => b.doc.updatedAt.localeCompare(a.doc.updatedAt))
      : filtered

  return (
    <>
      <TopBar />
      <div className="content">
        <div className="page-head">
          <span className="page-title">검색 결과</span>
          <span className="mono muted" style={{ fontSize: 11 }}>
            “{query}” · {hits.length}건
          </span>
        </div>

        <div className="filter-bar">
          <button className={`btn sm${category ? '' : ' primary'}`} onClick={() => setCategory(null)}>
            전체 {hits.length}
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`btn sm${category === c.id ? ' primary' : ''}`}
              onClick={() => setCategory(c.id)}
            >
              {categoryShort[c.id]} {hits.filter((h) => h.doc.category === c.id).length}
            </button>
          ))}
          <button
            className="btn sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => setSort((s) => (s === 'relevance' ? 'recent' : 'relevance'))}
          >
            {sort === 'relevance' ? '정확도순' : '최신순'} ▾
          </button>
        </div>

        {sorted.map((h) => (
          <button key={h.doc.id} className="result" onClick={() => navigate(`/wiki/${h.doc.id}`)}>
            <span className="rt">{h.doc.title}</span>
            <span className="rm">
              <span className="tag">{categoryShort[h.doc.category]}</span>
              <span className="mono muted" style={{ fontSize: 10.5 }}>
                {h.doc.updatedAt.slice(5)} · {h.doc.updatedBy} · v{h.doc.version}
              </span>
            </span>
            <span className="rx">
              <Highlight text={h.excerpt} terms={terms} />
            </span>
          </button>
        ))}

        {sorted.length === 0 && (
          <div className="empty">
            <div className="box" />
            일치하는 지식 문서가 없습니다
          </div>
        )}

        <div className="ask-assistant">
          <div className="txt">
            {hits.length === 0
              ? '검색으로 찾지 못했나요? 어시스턴트가 문서 전체를 근거로 정리해 드립니다'
              : `원하는 답이 없나요? 문서 ${docs.length}건을 근거로 어시스턴트가 정리해 드립니다`}
          </div>
          <button className="btn accent sm" onClick={() => ask(query)}>
            어시스턴트에게 묻기
          </button>
        </div>

        <div className="mono muted" style={{ fontSize: 10.5, marginTop: 12 }}>
          ※ 검색 대상은 위키 지식 문서 본문 · 편성표는 편성표 메뉴에서 이름/담당자로 필터
        </div>
      </div>
    </>
  )
}
