import { docs } from '../data/docs'
import type { ProductScope, WikiDoc } from '../types'

const STOPWORDS = new Set([
  '그리고', '그래서', '하지만', '어떻게', '무엇', '뭐야', '알려줘', '해줘', '있나요', '인가요',
  '있어', '없어', '이거', '저거', '관련', '대해', '대한', '경우', '정도', '것', '수', '좀',
])

/** 한글/영문/숫자 토큰 추출. 한글은 조사 흡수를 줄이기 위해 2글자 이상 접두 조각도 함께 만든다. */
function rawTerms(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/i)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

export function tokenize(text: string): string[] {
  const raw = rawTerms(text)

  const out = new Set<string>()
  for (const t of raw) {
    out.add(t)
    if (/^[가-힣]+$/.test(t) && t.length > 2) {
      out.add(t.slice(0, t.length - 1))
      if (t.length > 3) out.add(t.slice(0, t.length - 2))
    }
  }
  return [...out]
}

export interface ScoredDoc {
  doc: WikiDoc
  score: number
  /** 질의어와 가장 많이 겹치는 본문 문단 */
  excerpt: string
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0
  let count = 0
  let idx = haystack.indexOf(needle)
  while (idx !== -1) {
    count++
    idx = haystack.indexOf(needle, idx + needle.length)
  }
  return count
}

/** 마크다운 표기(링크·강조·인용)를 벗겨 사람이 읽는 문장만 남긴다. */
function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*`>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function bestParagraph(body: string, terms: string[]): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 20 && !p.startsWith('|') && !p.startsWith('##'))

  let best = ''
  let bestScore = -1
  for (const p of paragraphs) {
    const lower = p.toLowerCase()
    const score = terms.reduce((s, t) => s + countOccurrences(lower, t), 0)
    if (score > bestScore) {
      bestScore = score
      best = p
    }
  }
  return stripMarkdown(best)
}

/**
 * 검색 입력. 문자열 하나로 넘기면 예전처럼 동작하고(위키 검색 화면),
 * 챗봇은 **이번 발화 / 앞선 대화 / 상품 스코프**를 나눠 넘긴다.
 */
export interface SearchInput {
  /** 이번 질문 — 가장 무겁게 반영한다 */
  query: string
  /** 앞선 사용자 발화 — 대명사("그건 얼마야?")를 받쳐 줄 보조 맥락이라 가중치를 낮게 준다 */
  context?: string
  /** 사용자가 밝힌 상품 유형. 지정하면 반대 상품 전용 문서는 근거에서 뺀다 */
  scope?: ProductScope | null
}

/** 이번 발화의 단어가 앞선 대화의 단어를 항상 이기도록 가중치를 매긴다. */
const QUERY_WEIGHT = 3
const CONTEXT_WEIGHT = 1

function weighTerms(input: SearchInput): Map<string, number> {
  const weights = new Map<string, number>()
  const add = (text: string, weight: number) => {
    for (const t of tokenize(text)) weights.set(t, Math.max(weights.get(t) ?? 0, weight))
  }
  add(input.context ?? '', CONTEXT_WEIGHT)
  add(input.query, QUERY_WEIGHT)
  return weights
}

/**
 * 근거는 사용자가 **실제로 친 단어**에 걸려야 한다. 조사를 떼려고 만든 접두 조각만 스친 문서는
 * 세지 않는다 — "점심 메뉴 추천해줘"가 '추천' 하나로 CBS 매뉴얼에 걸리는 식의 오답을 막는다.
 */
function countTermsMentioned(doc: WikiDoc, terms: string[]): number {
  const haystack = `${doc.title} ${doc.code} ${doc.body}`.toLowerCase()
  return terms.filter((t) => haystack.includes(t)).length
}

/** PPV를 물었는데 PPM 전용 정책이 근거로 올라오는 일을 막는다. 공통 문서는 어느 쪽이든 남긴다. */
function inScope(doc: WikiDoc, scope: ProductScope | null | undefined): boolean {
  if (!scope || !doc.scope || doc.scope === '공통') return true
  return doc.scope === scope
}

export function searchDocs(input: string | SearchInput, pool: WikiDoc[] = docs): ScoredDoc[] {
  const search: SearchInput = typeof input === 'string' ? { query: input } : input
  const weights = weighTerms(search)
  if (weights.size === 0) return []
  const terms = [...weights.keys()]
  const typed = rawTerms(search.query)

  const scored: ScoredDoc[] = []
  for (const doc of pool) {
    if (!inScope(doc, search.scope)) continue
    // 한 단어만 스친 문서는 근거로 보지 않는다. 한 단어짜리 질문("쿠폰")은 그 한 단어로 충분하다.
    if (typed.length > 0 && countTermsMentioned(doc, typed) < Math.min(2, typed.length)) continue
    const title = doc.title.toLowerCase()
    const body = doc.body.toLowerCase()
    let score = 0
    for (const [t, w] of weights) {
      score += countOccurrences(title, t) * 8 * w
      score += countOccurrences(doc.code.toLowerCase(), t) * 10 * w
      score += Math.min(countOccurrences(body, t), 6) * 2 * w
    }
    if (score > 0) scored.push({ doc, score, excerpt: bestParagraph(doc.body, terms) })
  }
  return scored.sort((a, b) => b.score - a.score)
}

/** 문서 본문에서 질의와 가장 관련 있는 문장 n개를 뽑는다 (추출 요약). */
export function extractSentences(doc: WikiDoc, query: string | SearchInput, limit = 3): string[] {
  const weights = weighTerms(typeof query === 'string' ? { query } : query)
  const lines = doc.body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 10 && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('---'))
    .map((l) => stripMarkdown(l.replace(/^[-*>]\s*/, '')))

  return lines
    .map((line) => {
      const lower = line.toLowerCase()
      let score = 0
      for (const [t, w] of weights) score += countOccurrences(lower, t) * w
      return { line, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.line)
}
