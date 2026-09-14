import { docs } from '../data/docs'
import type { WikiDoc } from '../types'

const STOPWORDS = new Set([
  '그리고', '그래서', '하지만', '어떻게', '무엇', '뭐야', '알려줘', '해줘', '있나요', '인가요',
  '있어', '없어', '이거', '저거', '관련', '대해', '대한', '경우', '정도', '것', '수', '좀',
])

/** 한글/영문/숫자 토큰 추출. 한글은 조사 흡수를 줄이기 위해 2글자 이상 접두 조각도 함께 만든다. */
export function tokenize(text: string): string[] {
  const raw = text
    .toLowerCase()
    .split(/[^0-9a-z가-힣]+/i)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))

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

export function searchDocs(query: string, pool: WikiDoc[] = docs): ScoredDoc[] {
  const terms = tokenize(query)
  if (terms.length === 0) return []

  const scored: ScoredDoc[] = []
  for (const doc of pool) {
    const title = doc.title.toLowerCase()
    const body = doc.body.toLowerCase()
    let score = 0
    for (const t of terms) {
      score += countOccurrences(title, t) * 8
      score += countOccurrences(doc.code.toLowerCase(), t) * 10
      score += Math.min(countOccurrences(body, t), 6) * 2
    }
    if (score > 0) scored.push({ doc, score, excerpt: bestParagraph(doc.body, terms) })
  }
  return scored.sort((a, b) => b.score - a.score)
}

/** 문서 본문에서 질의와 가장 관련 있는 문장 n개를 뽑는다 (추출 요약). */
export function extractSentences(doc: WikiDoc, query: string, limit = 3): string[] {
  const terms = tokenize(query)
  const lines = doc.body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 10 && !l.startsWith('#') && !l.startsWith('|') && !l.startsWith('---'))
    .map((l) => stripMarkdown(l.replace(/^[-*>]\s*/, '')))

  return lines
    .map((line) => {
      const lower = line.toLowerCase()
      const score = terms.reduce((s, t) => s + countOccurrences(lower, t), 0)
      return { line, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.line)
}
