import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { readPrivateTermsFile } from './env.js'

/**
 * 공개 규칙 검사 — 위키는 공개 저장소에 올라가므로 금액·비공개 이름·별표 2개 가림을 PR 전에 거른다.
 * 새 문서 제출(createDocPR 앞)·수정 제안(createEditPR 앞), /api/publicCheck, 리포트 후검사, 리포트 웹 검색 훅이 모두 이 규칙을 쓴다
 * (docs/sections/requests-report.md 7절). 로컬 중계와 배포 함수가 함께 쓰므로 node 내장 모듈만 쓴다.
 */

export type HitKind = 'amount' | 'name' | 'doubleStar' | 'company' | 'url' | 'email' | 'phone' | 'todo' | 'figure'
export type HitWhere = 'title' | 'body' | 'reason'

/** 걸린 곳 하나 — text 는 사용자가 보낸 글자 중 걸린 부분만이다. 이름 목록의 다른 항목은 절대 싣지 않는다 */
export interface Hit {
  kind: HitKind
  where: HitWhere
  /** 본문 줄 번호(1부터). 제목·사유는 null */
  line: number | null
  text: string
}

/** 진입 — PR 본문 `- 진입:` 줄과 검사 기준(금액 차단·수치 경고)을 가른다 */
export type DocVia = 'form' | 'chat' | 'report' | 'attachment'
export const DOC_VIAS: DocVia[] = ['form', 'chat', 'report', 'attachment']

export interface PublicCheckInput {
  title: string
  body: string
  reason?: string
  via?: DocVia
  /** 수정 제안도 새 문서처럼 이름·별표 2개는 차단, 금액은 늘 경고다(상용화 결정 D2 ②, requests-doc-edit.md S1) */
  target?: 'new' | 'edit'
  /**
   * 수정 제안의 main 제목·본문 — 주면 이미 있던 줄(같은 제목)에서 걸린 것은 빼고 새로 생기거나 바뀐 줄만 돌려준다.
   * 고칠 수 없는 기존 표기로 제안이 막히지 않게 하는 화면(usePublicWarnings)과 같은 기준이다. 사유는 늘 검사한다
   */
  base?: { title?: string; body: string }
}

export interface PublicCheckResult {
  blocks: Hit[]
  warnings: Hit[]
  /** 비공개 이름 목록을 읽어 이름 검사를 했는지 — 목록이 없으면 false (배포본은 항상 false, R-B) */
  namesChecked: boolean
}

/* ── 패턴 ─────────────────────────────────────────────── */

// 숫자 바로 뒤 '원'이 낱말의 첫 글자(원칙·원인·원본…)인 경우는 금액이 아니다
const WON = '원(?!칙|인|본|리|소|점|형|래|문|자|천|칸|작|론|활|룸|정|장|격)'
const NUM = '\\d[\\d,]*(?:\\.\\d+)?'

/** 금액 표기 — 숫자+원·만 원·억, 한글 수사+원, 통화 기호·단위+숫자. 띄어쓰기 차이는 무시한다 */
const AMOUNT_SOURCES = [
  `${NUM}\\s*(?:조|억|천만|백만|십만|만|천)?\\s*(?:${WON}|달러|불(?![가-힣]))`,
  `${NUM}\\s*(?:억|천만|백만)`,
  `(?<![가-힣])[일이삼사오육칠팔구]?(?:[일이삼사오육칠팔구]?[십백천만억조])+\\s*${WON}`,
  `(?:₩|\\$|KRW|USD)\\s?${NUM}`,
  `${NUM}\\s?(?:KRW|USD)\\b`,
]
const AMOUNT_SOURCE = AMOUNT_SOURCES.map((s) => `(?:${s})`).join('|')
const amountRe = () => new RegExp(AMOUNT_SOURCE, 'g')

/** 별표 2개 가림 — src/lib/docEdit.ts doubleStarMasks 와 같은 규칙. 짝이 맞는 **굵게** 를 걷어낸 뒤에 남는 것만 본다 */
function doubleStarMasks(line: string): string[] {
  const rest = line.replace(/\*\*[^*\n]+\*\*/g, ' ')
  return [...rest.matchAll(/[가-힣]+\*\*[가-힣]*/g)].map((m) => m[0])
}

const COMPANY_MARK = /주식회사\s*[가-힣A-Za-z0-9]*|\(주\)\s*[가-힣A-Za-z0-9]*|㈜\s*[가-힣A-Za-z0-9]*|\b[A-Z][A-Za-z0-9&.\-]*,?\s+(?:Inc|Corp|Co\.,?\s*Ltd)\.?/g
// "○○사" 꼴 중 회사 이름이 아닌 일반 낱말 — 경고가 너무 많이 뜨지 않게 뺀다
const NOT_COMPANY = new RegExp(
  '(?:회사|타사|자사|당사|본사|각사|양사|해당사|행사|감사|검사|조사|기사|인사|의사|역사|봉사|심사|답사|탐사|입사|퇴사|이사|실사|시사|복사|묘사|' +
    '변호사|간호사|요리사|회계사|세무사|미용사|기술사|교사|강사|박사|석사|학사|명사|동사|부사|형용사|' +
    '경쟁사|제휴사|협력사|통신사|방송사|운영사|대행사|제작사|배급사|투자사|관계사|계열사|고객사|파트너사|공급사|여행사|보험사|카드사|금융사|증권사|플랫폼사)$',
)
const COMPANY_WORD = /(?<![가-힣])[가-힣]{2,8}사(?=$|[^가-힣]|[은는이가의를을도와과에로])/g

const URL_RE = /https?:\/\/[^\s)<>\]"'`]+/g
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const PHONE_RE = /(?<![\d-])(?:0\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}|1[5-9]\d{2}-\d{4})(?![\d-])/g
const TODO_RE = /\(보완 필요\)/g
/** 수치 — 범위 표기(1~3회)·날짜·문서 코드는 단위가 붙지 않거나 앞에 ~ 가 있어 빠진다 */
const FIGURE_RE = /(?<![\d.,~\-–]\s?)\d+(?:\.\d+)?\s*(?:%p|%|퍼센트|배(?!너|송|포|치)|건(?!물|강)|명(?!칭|시|확)|회(?!의|사|원|차)|p(?![A-Za-z]))/g

/* ── 비공개 이름 목록 ─────────────────────────────────── */

/** 비교용 정규화 — 대소문자·띄어쓰기를 무시한다. 별표는 남겨 가린 표기(홍*동)가 이름과 일치하지 않게 한다 */
export const normalizeTerm = (s: string) => s.toLowerCase().replace(/\s+/g, '')

/**
 * 목록 파일 → 정규화한 이름들. 한 줄에 하나, `#` 으로 시작하는 줄은 주석. JSON 배열(["…"])도 받는다.
 * 두 글자 미만은 다른 낱말과 너무 쉽게 겹쳐 버린다
 */
export function parsePrivateTerms(source: string): string[] {
  const text = source.replace(/^﻿/, '').trim()
  let items: string[]
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text) as unknown
    items = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } else {
    items = text.split(/\r?\n/).filter((l) => !l.trim().startsWith('#'))
  }
  return [...new Set(items.map(normalizeTerm).filter((t) => t.length >= 2))]
}

const TERMS_TTL_MS = 60_000
let termsCache: { path: string; mtimeMs: number; at: number; terms: string[] } | null = null

/**
 * HUB_PRIVATE_TERMS_FILE 이 가리키는 공유 드라이브 파일을 읽는다. 없거나 못 읽으면 null — 이름 검사를 못 한 것이다.
 * 공유 드라이브는 느릴 수 있어 1분 동안은 파일 시각만 보고 다시 읽지 않는다. 목록 내용은 로그에 남기지 않는다
 */
export function loadPrivateTerms(env: Record<string, string | undefined> = process.env): string[] | null {
  const configured = readPrivateTermsFile(env)
  if (!configured) return null
  const path = resolve(configured)
  try {
    if (termsCache && termsCache.path === path && Date.now() - termsCache.at < TERMS_TTL_MS) return termsCache.terms
    const { mtimeMs } = statSync(path)
    if (termsCache && termsCache.path === path && termsCache.mtimeMs === mtimeMs) {
      termsCache.at = Date.now()
      return termsCache.terms
    }
    const terms = parsePrivateTerms(readFileSync(path, 'utf8'))
    termsCache = { path, mtimeMs, at: Date.now(), terms }
    return terms
  } catch {
    termsCache = null
    return null
  }
}

/** 한 줄에서 목록 이름이 걸린 원문 구간들 — 띄어쓰기를 무시하고 찾은 뒤 원래 글자로 되돌린다 */
function termSpans(line: string, terms: string[]): Array<[number, number]> {
  if (!terms.length) return []
  const map: number[] = []
  let norm = ''
  for (let i = 0; i < line.length; i++) {
    if (/\s/.test(line[i])) continue
    norm += line[i].toLowerCase()
    map.push(i)
  }
  const spans: Array<[number, number]> = []
  for (const term of terms) {
    for (let at = norm.indexOf(term); at >= 0; at = norm.indexOf(term, at + 1)) {
      spans.push([map[at], map[at + term.length - 1] + 1])
    }
  }
  return spans
}

/* ── 검사 ─────────────────────────────────────────────── */

interface Rules {
  terms: string[] | null
  figures: boolean
  /** 리포트 반영본의 외부 출처 절 URL 은 공개 자료라 경고하지 않는다(D4) */
  skipExternalUrls: boolean
}

function scanText(text: string, where: HitWhere, rules: Rules): Hit[] {
  const hits: Hit[] = []
  let external = false
  text.split('\n').forEach((line, i) => {
    const at = where === 'body' ? i + 1 : null
    const push = (kind: HitKind, t: string) => hits.push({ kind, where, line: at, text: t.trim() })

    const heading = line.match(/^(#{1,6})\s+(.*)$/)
    if (heading) external = /외부\s*출처/.test(heading[2])

    for (const m of line.matchAll(amountRe())) push('amount', m[0])
    const named = new Set<string>()
    for (const [s, e] of termSpans(line, rules.terms ?? [])) {
      const t = line.slice(s, e)
      if (!named.has(t)) push('name', t)
      named.add(t)
    }
    for (const t of new Set(doubleStarMasks(line))) push('doubleStar', t)

    for (const m of line.matchAll(COMPANY_MARK)) if (!named.has(m[0].trim())) push('company', m[0])
    for (const m of line.matchAll(COMPANY_WORD)) {
      if (NOT_COMPANY.test(m[0]) || [...named].some((n) => n.includes(m[0]) || m[0].includes(n))) continue
      push('company', m[0])
    }
    if (!(rules.skipExternalUrls && external)) for (const m of line.matchAll(URL_RE)) push('url', m[0])
    for (const m of line.matchAll(EMAIL_RE)) push('email', m[0])
    for (const m of line.matchAll(PHONE_RE)) push('phone', m[0])
    for (const m of line.matchAll(TODO_RE)) push('todo', m[0])
    if (rules.figures) for (const m of line.matchAll(FIGURE_RE)) push('figure', m[0])
  })
  return hits
}

/**
 * 제목·본문·등록 사유를 검사한다. PM 결정(2026-11-18):
 * - 비공개 이름 목록 일치·별표 2개 가림은 새 문서에서 항상 차단
 * - 금액은 리포트에서 넘어온 반영(via:'report')일 때만 차단, 직접 작성한 새 문서는 경고
 * - 수치 경고는 리포트 반영에만 — 규격 문서의 픽셀·글자 수처럼 정당한 수치가 많다
 * - 수정 제안(target:'edit')도 이름·별표 2개는 차단, 금액은 진입과 상관없이 경고(D2 ② — 쿠폰 금액 문서를 막지 않는다)
 * terms 를 넘기지 않으면(undefined) HUB_PRIVATE_TERMS_FILE 을 읽는다. null 이면 이름 검사를 하지 않는다
 */
export function publicLeaks(
  input: PublicCheckInput,
  opts: { terms?: string[] | null; env?: Record<string, string | undefined> } = {},
): PublicCheckResult {
  const terms = opts.terms === undefined ? loadPrivateTerms(opts.env) : opts.terms
  const report = input.via === 'report'
  const rules: Rules = { terms, figures: report, skipExternalUrls: report }
  const title = input.title.replace(/[\r\n]+/g, ' ')
  const body = input.body.replace(/\r\n?/g, '\n')
  let hits = [
    ...scanText(title, 'title', rules),
    ...scanText(body, 'body', rules),
    ...(input.reason ? scanText(input.reason.replace(/\r\n?/g, '\n'), 'reason', rules) : []),
  ]
  if (input.base) {
    const before = new Set(input.base.body.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trim()))
    const lines = body.split('\n')
    const sameTitle = input.base.title !== undefined && input.base.title.trim() === title.trim()
    hits = hits.filter((h) =>
      h.where === 'reason' ? true : h.where === 'title' ? !sameTitle : !before.has((lines[(h.line ?? 0) - 1] ?? '').trim()),
    )
  }
  const edit = input.target === 'edit'
  const blocking = (h: Hit) => h.kind === 'name' || h.kind === 'doubleStar' || (h.kind === 'amount' && report && !edit)
  return { blocks: hits.filter(blocking), warnings: hits.filter((h) => !blocking(h)), namesChecked: terms !== null }
}

/** 로그용 — 걸린 글자는 남기지 않고 종류별 건수만 (예: `amount=2 name=1`) */
export function hitCounts(hits: Array<{ kind: string }>): string {
  const counts = new Map<string, number>()
  for (const h of hits) counts.set(h.kind, (counts.get(h.kind) ?? 0) + 1)
  return [...counts].map(([k, n]) => `${k}=${n}`).join(' ') || '0'
}

/**
 * 리포트 후검사 — 개인 문서라 막지는 않지만, 금액과 목록 이름은 서버가 가려서 돌려준다
 * (조사 S3: 프롬프트에 금지를 넣어도 위키의 가격 표기가 옮겨졌다)
 */
export function maskPublicLeaks(text: string, terms: string[] | null): { text: string; amount: number; name: number } {
  let amount = 0
  let name = 0
  const lines = text.split('\n').map((line) => {
    let out = line.replace(amountRe(), () => {
      amount++
      return '(금액 생략)'
    })
    const spans = termSpans(out, terms ?? []).sort((a, b) => b[0] - a[0])
    let lastStart = Infinity
    for (const [s, e] of spans) {
      if (e > lastStart) continue // 겹친 구간은 앞의 것만 가린다
      out = `${out.slice(0, s)}(이름 생략)${out.slice(e)}`
      lastStart = s
      name++
    }
    return out
  })
  return { text: lines.join('\n'), amount, name }
}

/* ── 리포트 웹 검색 훅에 넘기는 규칙 ─────────────────────── */

/**
 * server/reportGuard.mjs(claude PreToolUse 훅)는 node 로 바로 돌아 TS 를 불러올 수 없다.
 * 규칙을 두 벌 두지 않게 정규식 원문을 환경 변수로 넘기고, 훅은 대조만 한다
 */
export interface SearchGuardRules {
  patterns: Array<{ kind: string; source: string; flags: string }>
  terms: string[]
}

export function searchGuardRules(terms: string[]): SearchGuardRules {
  return {
    patterns: [
      { kind: 'amount', source: AMOUNT_SOURCE, flags: 'g' },
      // 가린 이름(류*영·미디어*팀장)도 검색어로 내보내지 않는다
      { kind: 'masked', source: '[가-힣A-Za-z]+\\*+[가-힣A-Za-z]*', flags: 'g' },
      { kind: 'docCode', source: '\\b(?:[A-Z]{2,5}-(?:[A-Z]{1,3}-)?\\d{2,3}|PPC-[A-Z]{3})\\b', flags: 'g' },
      { kind: 'system', source: '\\b(?:ACS|CBS|Swing)\\b', flags: 'gi' },
    ],
    terms,
  }
}

/* ── /api/publicCheck 입력 ────────────────────────────── */

const MAX_CHECK_TITLE = 200
const MAX_CHECK_BODY = 50_000
const MAX_CHECK_REASON = 2_000

/** 요청 본문을 검증한다. 잘못되면 사용자에게 보여줄 메시지로 throw 한다 */
export function parsePublicCheckInput(raw: unknown): PublicCheckInput {
  const r = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const input: PublicCheckInput = {
    title: str(r.title).trim(),
    body: str(r.body).replace(/\r\n?/g, '\n'),
    reason: str(r.reason).replace(/\r\n?/g, '\n').trim(),
    via: DOC_VIAS.includes(r.via as DocVia) ? (r.via as DocVia) : 'form',
    target: r.target === 'edit' ? 'edit' : 'new',
  }
  if (!input.title && !input.body.trim() && !input.reason) throw new Error('검사할 내용이 비어 있습니다')
  if (input.title.length > MAX_CHECK_TITLE) throw new Error(`제목은 ${MAX_CHECK_TITLE}자 이내로 보내 주세요`)
  if (input.body.length > MAX_CHECK_BODY) throw new Error('본문이 너무 깁니다')
  if ((input.reason ?? '').length > MAX_CHECK_REASON) throw new Error(`사유는 ${MAX_CHECK_REASON}자 이내로 보내 주세요`)
  return input
}
