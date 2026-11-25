import { useNavigate } from 'react-router-dom'
import { headingId, headingPlain } from '../lib/docEdit'
import type { SourceRef, WikiDoc } from '../types'
import { FreshLamp, ScopeChip, subLabel } from './DocBits'

/** anchor 는 본문 제목 id(`h-…`) 또는 소제목 글자로 온다 — 글자면 문서 화면과 같은 규칙으로 id 를 만든다 */
const anchorId = (a: string) => (a.startsWith('h-') ? a : headingId(a))

/** 근거 문서 주소 — 소제목(anchor)이 있으면 그 장으로 바로 보낸다 */
export function sourceHref(s: Pick<SourceRef, 'docId' | 'anchor'>): string {
  const a = s.anchor?.trim()
  return a ? `/wiki/${s.docId}#${encodeURIComponent(anchorId(a))}` : `/wiki/${s.docId}`
}

/** anchor 가 가리키는 소제목 글자 — 본문에서 같은 id 의 제목을 찾는다. 못 찾으면 보이지 않는다 */
function anchorTitle(doc: WikiDoc, anchor?: string): string | null {
  const a = anchor?.trim()
  if (!a) return null
  const id = anchorId(a)
  for (const line of doc.body.split('\n')) {
    const m = line.match(/^#{2,3}\s+(.*)$/)
    if (m && headingId(m[1].trim()) === id) return headingPlain(m[1].trim())
  }
  return null
}

export type SourceItem = { doc: WikiDoc; anchor?: string }

/**
 * "이 답의 근거 문서" — 카테고리 띠 · 코드 · 제목 · 2단 메뉴 › 소제목 · 적용대상 칩 · 최신성 램프.
 * 누르면 그 장으로 간다. 챗봇 창과 내 대화 기록이 같은 부품을 쓴다 (identity-redesign 4-3)
 */
export function SourceCards({ items, onOpen }: { items: SourceItem[]; onOpen?: () => void }) {
  const navigate = useNavigate()
  if (items.length === 0) return null
  return (
    <div className="source-cards">
      <span className="source-cards-title">
        이 답의 근거 문서 <span className="tc">{items.length}</span>
      </span>
      {items.map(({ doc, anchor }) => {
        const sub = subLabel(doc)
        const section = anchorTitle(doc, anchor)
        const href = sourceHref({ docId: doc.id, anchor: section ? anchor : undefined })
        return (
          <a
            key={`${doc.id}#${anchor ?? ''}`}
            href={href}
            className="source-card"
            data-cat={doc.category}
            onClick={(e) => {
              e.preventDefault()
              navigate(href)
              onOpen?.()
            }}
          >
            <span className="source-card-top">
              <span className="tc source-card-code">{doc.code}</span>
              <span className="source-card-title">{doc.title}</span>
              <ScopeChip scope={doc.scope} />
            </span>
            <span className="source-card-bottom">
              <span className="source-card-path">
                {[sub, section].filter(Boolean).join(' › ') || '문서 처음'} ›
              </span>
              <FreshLamp updatedAt={doc.updatedAt} />
            </span>
          </a>
        )
      })}
    </div>
  )
}
