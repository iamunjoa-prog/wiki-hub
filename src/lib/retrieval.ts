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

/** 한 단어와 그 접두 조각들. 조사가 붙은 "반응률이"가 "반응률"과 이어지게 한다. */
function expand(term: string): string[] {
  const out = [term]
  if (/^[가-힣]+$/.test(term) && term.length > 2) {
    out.push(term.slice(0, term.length - 1))
    if (term.length > 3) out.push(term.slice(0, term.length - 2))
  }
  return out
}

export function tokenize(text: string): string[] {
  const out = new Set<string>()
  for (const t of rawTerms(text)) for (const v of expand(t)) out.add(v)
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

const WORD_CHAR = /[0-9a-zA-Z가-힣]/

/**
 * 강조 기호는 떼고 **가린 실명은 남긴다.** 별표를 싹 지우면 `류*영`이 "류영"이 되어,
 * 가린 이름이 **있지도 않은 실명**으로 근거 문장에 들어간다.
 *
 * 글자 사이의 **별표 하나**만 마스킹으로 본다. `**`는 굵게로 보고 지운다 —
 * 한국어는 `**Swing 접점공지**는` 처럼 굵게 바로 뒤에 조사가 붙어서, `**`까지 마스킹으로
 * 보면 멀쩡한 강조가 전부 `접점공지**는`으로 남는다.
 *
 * 그래서 부서명을 `미디어**팀`으로 가린 표기는 여기서 살릴 수 없다 — 마크다운 굵게와 글자가
 * 겹쳐 구분이 불가능하다. 위키 쪽에서 `미디어*팀`처럼 별표 하나로 통일해야 그대로 남는다.
 */
function stripEmphasis(text: string): string {
  return text.replace(/\*+/g, (stars, offset: number, whole: string) => {
    if (stars.length !== 1) return ''
    const before = whole[offset - 1]
    const after = whole[offset + 1]
    const masked = before !== undefined && after !== undefined && WORD_CHAR.test(before) && WORD_CHAR.test(after)
    return masked ? stars : ''
  })
}

/** 마크다운 표기(링크·강조·인용)를 벗겨 사람이 읽는 문장만 남긴다. */
function stripMarkdown(text: string): string {
  return (
    stripEmphasis(text)
      // 링크 주소에 괄호가 들어가기도 한다 (`#h-프로모션-운영-프로세스-(Step-1~6)`) — 한 겹까지 함께 먹는다
      .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, '$1')
      .replace(/[`>#|]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  )
}

/** `| --- | --- |` 같은 표 구분선 */
const TABLE_SEPARATOR = /^\|[\s:|-]+\|?$/

const isTableRow = (line: string) => line.startsWith('|')

/**
 * 표 한 줄을 읽을 수 있는 문장으로 편다. `| **Step 2** 시행 품의 | 프로모션 예산 기안 |` → `Step 2 시행 품의 — 프로모션 예산 기안`.
 *
 * 이 위키는 **본문 4줄 중 1줄이 표**다. 운영 프로세스 Step 1~6, 캠페인 플레이북 조합표처럼
 * 질문에 바로 답이 되는 내용이 표 안에만 있어서, 표를 버리면 그 문서에서 뽑을 문장이 없다.
 */
function flattenTableRow(line: string): string {
  return line
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => stripMarkdown(cell))
    .filter((cell) => cell.length > 0 && cell !== '—' && cell !== '-')
    .join(' — ')
}

/** 목록·인용 기호와 번호를 떼고 표는 펴서, 한 줄을 그대로 인용할 수 있는 문장으로 만든다. */
function readableLine(line: string): string {
  if (isTableRow(line)) return flattenTableRow(line)
  return stripMarkdown(line.replace(/^[-*>]\s*/, '').replace(/^\d+\.\s+/, ''))
}

/** 문서를 소제목 단위로 쪼갠 조각. 질문이 소제목에 걸리면 이 조각을 통째로 근거로 쓴다. */
export interface DocSection {
  /** `##`~`####` 소제목 텍스트. 문서 맨 앞 머리말은 빈 문자열 */
  heading: string
  /** 소제목 아래 본문 — **문서에 적힌 순서대로** 담는다 */
  lines: string[]
}

const HEADING = /^(#{2,4})\s+(.*)$/

/**
 * 소제목 단위로 문서를 쪼갠다. 표를 한 줄씩 펴서 담으므로, 절차표가 있는 소제목은
 * Step 1~6이 **문서 순서 그대로** 남는다 — 점수순으로 뽑으면 순서가 깨진다.
 */
export function parseSections(body: string): DocSection[] {
  const sections: DocSection[] = [{ heading: '', lines: [] }]
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    const heading = HEADING.exec(line)
    if (heading) {
      sections.push({ heading: stripMarkdown(heading[2]), lines: [] })
      continue
    }
    if (!line || line.startsWith('---')) continue
    const current = sections[sections.length - 1]
    if (TABLE_SEPARATOR.test(line)) {
      // 구분선 바로 위는 표의 머리글이다. 값이 없어 근거로 쓸 수 없으니 되돌려 뺀다.
      current.lines.pop()
      continue
    }
    const text = readableLine(line)
    if (text.length > 1) current.lines.push(text)
  }
  return sections.filter((s) => s.heading || s.lines.length > 0)
}

/**
 * 질의와 가장 잘 맞는 소제목 조각. `## 프로모션 운영 프로세스 (Step 1~6)` 처럼
 * **소제목 자체가 답의 범위**인 질문을 집어내는 통로다. 없으면 null.
 */
export function findSection(doc: WikiDoc, query: string | SearchInput): DocSection | null {
  const search: SearchInput = typeof query === 'string' ? { query } : query
  const weights = weighTerms(search)
  const typed = rawTerms(search.query)

  let best: DocSection | null = null
  let bestScore = 0
  for (const section of parseSections(doc.body)) {
    if (!section.heading || section.lines.length === 0) continue
    const lower = section.heading.toLowerCase()
    // 소제목에는 사용자가 **실제로 친 단어**가 걸려야 한다 — 조사용 접두 조각만 스친 소제목은 세지 않는다
    if (!typed.some((t) => lower.includes(t))) continue
    let score = 0
    for (const [t, w] of weights) score += countOccurrences(lower, t) * w
    if (score > bestScore) {
      bestScore = score
      best = section
    }
  }
  return best
}

/** `Step 3`, `4단계`, `②` 처럼 순서가 매겨진 줄 */
const STEP_LINE = /^(?:step\s*\d|p\d\s|[1-9]\d*\s*(?:단계|\.)|[①②③④⑤⑥⑦⑧⑨])/i

/**
 * 소제목 조각에서 **절차만** 순서대로 뽑는다. 단계가 매겨진 줄이 둘 이상이면 그 줄들만 쓴다 —
 * 조각 앞머리의 적용대상·재정의 안내 같은 메타 문장이 단계를 밀어내지 않게 하기 위함이다.
 */
export function sequenceLines(section: DocSection, limit: number): string[] {
  const steps = section.lines.filter((l) => STEP_LINE.test(l))
  return (steps.length >= 2 ? steps : section.lines).slice(0, limit)
}

function bestParagraph(body: string, terms: string[]): string {
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) =>
      block
        .trim()
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !TABLE_SEPARATOR.test(l))
        .map((l) => (isTableRow(l) ? flattenTableRow(l) : l))
        .join(' '),
    )
    .filter((p) => p.length > 20 && !p.startsWith('##'))

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
  /**
   * 이 서브메뉴들의 문서를 먼저 본다. 판단을 묻는 질문에는 정책 문서보다
   * 프로모션 인사이트가 답에 가깝다 — 같은 점수면 이쪽을 위로 올린다.
   */
  preferSubcategory?: string[] | null
}

/** 선호 메뉴 가산 — 순위를 뒤집을 만큼은 올리되, 관련 없는 문서를 끌어올리지는 않는 배수 */
const PREFERRED_CATEGORY_BOOST = 1.8

/**
 * 흔한 단어는 근거로서 값이 싸다. '메뉴'는 거의 모든 매뉴얼에 있지만 '띠배너'는 몇 문서에만 있다.
 * 문서 빈도의 역수로 가중해, 스치듯 겹친 단어가 점수를 끌어올리지 못하게 한다.
 */
const idfCache = new WeakMap<WikiDoc[], Map<string, number>>()

function idfFor(pool: WikiDoc[], term: string): number {
  let table = idfCache.get(pool)
  if (!table) {
    table = new Map()
    idfCache.set(pool, table)
  }
  const cached = table.get(term)
  if (cached !== undefined) return cached

  let df = 0
  for (const doc of pool) {
    if (`${doc.title} ${doc.code} ${doc.body}`.toLowerCase().includes(term)) df++
  }
  const idf = Math.log(pool.length / (1 + df)) + 1
  const value = Math.max(idf, 0.2)
  table.set(term, value)
  return value
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
  // 조사까지 그대로 일치할 필요는 없다 — "반응률이"는 "반응률"로도 걸린다.
  return terms.filter((t) => expand(t).some((v) => haystack.includes(v))).length
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
      const weight = w * idfFor(pool, t)
      score += countOccurrences(title, t) * 8 * weight
      score += countOccurrences(doc.code.toLowerCase(), t) * 10 * weight
      score += Math.min(countOccurrences(body, t), 6) * 2 * weight
    }
    if (search.preferSubcategory && doc.subcategory && search.preferSubcategory.includes(doc.subcategory))
      score *= PREFERRED_CATEGORY_BOOST
    if (score > 0) scored.push({ doc, score, excerpt: bestParagraph(doc.body, terms) })
  }
  return scored.sort((a, b) => b.score - a.score)
}

/** 문서 본문에서 질의와 가장 관련 있는 문장 n개를 뽑는다 (추출 요약). */
export function extractSentences(doc: WikiDoc, query: string | SearchInput, limit = 3): string[] {
  const weights = weighTerms(typeof query === 'string' ? { query } : query)
  // 표를 펴서 함께 담는다. 예전처럼 `|` 로 시작하는 줄을 버리면 표에만 있는 내용은 영영 인용되지 않는다.
  const lines = parseSections(doc.body)
    .flatMap((s) => s.lines)
    .filter((l) => l.length > 5)

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
