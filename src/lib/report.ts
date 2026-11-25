import type { CategoryId, ChatMessage, ChatReport, ProductScope, ReportType, WikiDoc } from '../types'
import type { DocVia } from './publicCheck'

/* ── 리포트 모드 화면 쪽 (docs/plan/2026-11-18-cli-report-mode.md, docs/sections/requests-report.md) ── */

/**
 * 리포트 요청을 화면이 기다리는 한도 — 서버 리포트 한도(claude 300초 · codex 360초) + 30초.
 * Gemini 는 리포트를 만들지 않고 바로 안내를 돌려주므로 평소 한도를 그대로 쓴다
 */
export const REPORT_TIMEOUT_MS = { claude: 330_000, codex: 390_000 } as const

/** 리포트 대기 안내의 평소 소요 시간 — 조사 실측 기준 */
export const REPORT_WAIT_HINT = '보통 2~3분'

/*
 * 리포트로 판정될 질문인지 미리 짐작한다. 판정은 서버(server/knowledge.ts detectReportIntent)가 하고 화면은 응답 mode 를 따른다.
 * 여기서는 기다리는 한도와 대기 문구만 고른다 — 서버 규칙과 같은 신호를 쓰되, 서버는 브라우저에서 못 불러오는 모듈(node:fs)을 함께 들고 있어 옮겨 적었다.
 * 서버 규칙을 바꾸면 이쪽도 맞춘다
 */
const REPORT_SIGNALS: { re: RegExp; weight: 1 | 2; weak?: true }[] = [
  { re: /리포트|레포트|보고서|보고\s*자료|보고용|장표|문서로\s*정리|정리해서\s*문서/, weight: 2 },
  { re: /타사|경쟁사|업계|벤치마킹|비교해|비교\s*분석/, weight: 2 },
  { re: /대비/, weight: 1, weak: true },
  { re: /이슈\s*(?:체크|점검)/, weight: 2 },
  { re: /개선점|점검|진단|문제점|체크해|전반|전체적으로|도출/, weight: 1 },
  { re: /인사이트\s*(?:정리|종합)/, weight: 2 },
  { re: /인사이트/, weight: 1 },
  { re: /종합|한눈에|총정리/, weight: 1 },
  { re: /(?:추천|제안)[^.?!]*(?:근거|이유|데이터|자료)|(?:근거|이유|데이터|자료)[^.?!]*(?:추천|제안)/, weight: 1 },
  { re: /위키\s*전체|모든\s*문서|전체\s*문서/, weight: 1 },
]
const SHORT_ANSWER = /짧게|한\s*줄로|간단히|간단하게|요약만/
const EDIT_REQUEST = /고쳐|수정해|바꿔\s*줘|반영해|올려\s*줘|추가해\s*줘|삭제해|지워\s*줘/

export function mayBeReport(query: string, modeOverride?: 'qa' | 'report'): boolean {
  if (modeOverride) return modeOverride === 'report'
  if (SHORT_ANSWER.test(query) || EDIT_REQUEST.test(query)) return false
  let score = 0
  let firm = 0
  for (const s of REPORT_SIGNALS) {
    if (!s.re.test(query)) continue
    score += s.weight
    if (!s.weak) firm += s.weight
  }
  return firm > 0 && score >= 2
}

/** 리포트 뒤 "짧게 답해줘"·"한 줄로" — 주제 없이 모드만 바꾸는 말이면 리포트의 질문을 짧은 답으로 다시 보낸다 */
export function isShortAnswerRequest(query: string): boolean {
  const q = query.replace(/\s+/g, ' ').trim()
  return q.length <= 20 && SHORT_ANSWER.test(q)
}

export const REPORT_TYPE_NAME: Record<ReportType, string> = {
  compare: '타사 비교·개선점',
  audit: '위키 전반 점검',
  insight: '인사이트·판단 근거',
  brief: '업무 정리',
}

/** 반영본 "이 문서는" 문단의 유형 이름 (6-2) */
const REFLECT_TYPE_NAME: Record<ReportType, string> = {
  compare: '비교 자료',
  audit: '점검 결과',
  insight: '판단 자료',
  brief: '업무 정리',
}

export const WEB_OFF_TEXT: Record<NonNullable<ChatReport['webSearchOff']>, string> = {
  engine: '이 엔진은 외부 검색을 하지 않았습니다. 위키 문서만 근거로 만들었습니다.',
  terms: '공개하면 안 되는 이름 목록이 이 허브에 연결되지 않아 외부 검색을 끄고 위키 문서만 근거로 만들었습니다.',
  type: '점검 리포트는 외부 검색 없이 위키 문서만 근거로 만듭니다.',
}

/** 리포트의 질문 — 같은 질문을 칩으로 다시 보낼 때 쓴다. 답 메시지에 없으면 바로 앞 사용자 말풍선에서 읽는다 */
export function questionOf(messages: ChatMessage[], messageId: string): string | null {
  const at = messages.findIndex((m) => m.id === messageId)
  if (at < 0) return null
  if (messages[at].query) return messages[at].query!
  for (let i = at - 1; i >= 0; i--) if (messages[i].role === 'user') return messages[i].text
  return null
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 서버가 [추정]으로 내린 문장(목록에 없는 근거를 단 [위키]·[외부])은 본문에서도 [추정]으로 보이게 맞춘다.
 * 카드·.md 저장·복사·반영본이 모두 이 본문을 쓴다
 */
export function reportMarkdown(report: ChatReport): string {
  let md = report.markdown
  for (const c of report.claims) {
    if (c.basis !== 'inference' || c.text.length < 6) continue
    md = md.replace(new RegExp(`(${escapeRe(c.text)}[\\s.。]*)\\[(?:위키|외부)\\]`, 'g'), '$1[추정]')
  }
  return md
}

const kstDate = (iso?: string) => new Date((iso ? Date.parse(iso) : Date.now()) + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

function slug(title: string): string {
  const s = title
    .replace(/[\\/:*?"<>|#%&{}$!'`@+=]/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .replace(/-+$/, '')
  return s || '리포트'
}

/** .md로 저장 파일 이름 — `YYYY-MM-DD-<제목 슬러그>.md` */
export const reportFileName = (msg: Pick<ChatMessage, 'report' | 'reportMeta'>) =>
  `${kstDate(msg.reportMeta?.createdAt)}-${slug(msg.report?.title ?? '리포트')}.md`

/** .md로 저장 내용 — 머리에 제목·작성일·엔진·근거 범위. 문자열은 JSON 표기로 감싸 YAML 로도 그대로 읽힌다 */
export function reportFile(msg: Pick<ChatMessage, 'report' | 'reportMeta'>): string {
  const report = msg.report!
  const front = [
    '---',
    `title: ${JSON.stringify(report.title)}`,
    `date: ${kstDate(msg.reportMeta?.createdAt)}`,
    `engine: ${JSON.stringify(msg.reportMeta?.engine ?? '')}`,
    `basis: ${JSON.stringify(report.externalSources.length ? '위키 + 외부 공개 자료' : '위키만')}`,
    `type: ${report.reportType}`,
    '---',
    '',
  ]
  return `${front.join('\n')}${reportMarkdown(report).trim()}\n`
}

/* ── 리포트 직후 "위키에 반영해 줘" (requests-report.md 5절) ── */

export type ReflectAsk = 'go' | 'how' | 'go-fix' | 'go-existing'

const REFLECT_VERB = /반영|올려|올리|등록|넣어|추가해|문서로\s*만들/
const REFLECT_NEGATION = /하지\s*마|안\s*해|말고|안\s*해도|취소/
/** 방법을 묻는다 — 흐름을 시작하지 않고 버튼을 알려 준다 */
const REFLECT_HOW = /어떻게|방법|하려면|되나|돼\s*[?？]|가능|할\s*수\s*있/
/** 고칠 점이 함께 있다 — 자동으로 고치지 않고 새 문서 화면에서 고쳐 달라고 덧붙인다 */
const REFLECT_FIX = /빼고|빼서|지우고|지워서|바꿔서|바꾸고|고쳐서|고치고|수정해서|수정하고|제외하고|없애고/
/** "○○ 문서에" — 새 문서·위키 문서가 아니면 기존 문서를 짚은 것이다 */
const EXISTING_DOC = /([가-힣A-Za-z0-9-]+)\s*문서에/

/**
 * 가장 최근 어시스턴트 메시지가 리포트일 때만 반영 요청으로 본다. 아니면 null — 지금처럼 수정 제안 안내(detectKnowledgeEdit)로 간다.
 * 판별 예시는 보고 표에 적는다
 */
export function detectReportReflect(query: string, lastAssistant: ChatMessage | undefined, docs: WikiDoc[]): ReflectAsk | null {
  if (!lastAssistant?.report) return null
  const q = query.replace(/\s+/g, ' ').trim()
  if (!REFLECT_VERB.test(q) || REFLECT_NEGATION.test(q)) return null
  if (REFLECT_HOW.test(q)) return 'how'
  const lower = q.toLowerCase()
  const named =
    docs.some((d) => lower.includes(d.code.toLowerCase()) || (d.title.length >= 4 && q.includes(d.title))) ||
    (() => {
      const m = q.match(EXISTING_DOC)
      return Boolean(m && !/^(?:새|위키|이|그|해당)$/.test(m[1]))
    })()
  if (named) return 'go-existing'
  if (REFLECT_FIX.test(q)) return 'go-fix'
  return 'go'
}

export const reflectStartText = (title: string) =>
  `방금 리포트 「${title}」을 위키 새 문서로 올릴 준비를 합니다. 먼저 공개해도 되는 내용인지 검사합니다.`
export const REFLECT_HOW_TEXT =
  '리포트 카드의 [위키에 반영 요청]을 누르면 새 문서 화면이 리포트 내용으로 채워져 열립니다. 제출하면 관리자가 승인(머지)한 뒤 다음 배포 때 위키에 보입니다.'
export const REFLECT_FIX_TEXT = '말씀하신 고칠 점은 새 문서 화면에서 직접 고쳐 주세요. 리포트 내용을 자동으로 바꾸지는 않습니다.'
export const REFLECT_EXISTING_TEXT = '리포트는 새 문서로만 올라갑니다. 기존 문서를 고치려면 그 문서의 [✎ 고치기]를 써 주세요.'

/* ── 반영본 만들기 (6절) — 브라우저 안에서 규칙대로만 바꾼다 ── */

export interface NewDocPrefill {
  category: CategoryId
  subcategory: string | null
  scope: ProductScope | '공통'
  title: string
  body: string
  reason: string
  via: DocVia
  /** 미리 채운 출처 리포트 메시지 — 제출이 성공하면 그 카드에 결과 한 줄을 남긴다 */
  fromMessageId?: string
  /** 화면 맨 위 안내에 쓰는 리포트 제목 */
  reportTitle?: string
}

const SUB_BY_TYPE: Record<ReportType, string> = {
  compare: 'insight',
  insight: 'insight',
  audit: 'ops-reference',
  brief: 'ops-reference',
}

const ENGINE_NAME = /claude|codex|gemini|클로드|코덱스|제미나이|엔진/i

/** 본문을 `## ` 절로 나눈다 — 절 이름으로 빼거나 바꾸는 규칙이 이 단위로 돈다 */
function sections(md: string): { head: string; lines: string[] }[] {
  const out: { head: string; lines: string[] }[] = [{ head: '', lines: [] }]
  for (const line of md.split('\n')) {
    if (/^##\s+/.test(line)) out.push({ head: line.replace(/^##\s+/, '').trim(), lines: [] })
    else out[out.length - 1].lines.push(line)
  }
  return out
}

export function buildReflectDraft(msg: ChatMessage, docs: WikiDoc[]): NewDocPrefill {
  const report = msg.report!
  let md = reportMarkdown(report).replace(/\r\n?/g, '\n').trim()

  // 프론트매터 — 서버가 붙이므로 두 겹이 되지 않게 뺀다
  md = md.replace(/^---\n[\s\S]*?\n---\n*/, '')

  // 맨 위 # 제목은 제목 칸으로
  let title = report.title
  const h1 = md.match(/^#\s+(.+)\n*/)
  if (h1) {
    title = title || h1[1].trim()
    md = md.slice(h1[0].length)
  }
  title = title.replace(/[\r\n]+/g, ' ').trim().slice(0, 80)

  // 머리 인용 — 대상 상품은 적용 상품 칸으로 읽고, 작성일·엔진 줄은 뺀다(엔진 이름은 문서·PR 에 남기지 않는다)
  const headQuote = md.match(/^(?:>.*\n?)+/)
  let scope: NewDocPrefill['scope'] = '공통'
  if (headQuote) {
    const quote = headQuote[0]
    const ppv = /\[PPV\]/.test(quote)
    const ppm = /\[PPM\]/.test(quote)
    if (ppv !== ppm) scope = ppv ? 'PPV' : 'PPM'
    const kept = quote
      .split('\n')
      .filter((l) => l.replace(/^>/, '').trim() && !ENGINE_NAME.test(l) && !/작성일/.test(l))
      .join('\n')
    md = (kept ? `${kept}\n` : '') + md.slice(quote.length)
  }

  // 우측 목차는 ##·### 만 잡는다 — 그 아래 소제목은 굵은 줄로
  md = md.replace(/^#{4,6}\s+(.+)$/gm, (_, t: string) => `**${t.trim()}**`)

  const docOf = (p: string) => docs.find((d) => d.path === p.replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^지식\//, ''))
  const refRows = report.sourcePaths
    .map(docOf)
    .filter((d): d is WikiDoc => Boolean(d))
    .map((d) => `| [${d.title}](${d.code}) | ${d.code} |`)
  const refTable = refRows.length ? ['| 문서 | 코드 |', '| --- | --- |', ...refRows].join('\n') : ''

  let hasGaps = false
  let hasRefs = false
  const parts = sections(md).flatMap((s, i) => {
    if (i === 0) return s.lines.join('\n').trim() ? [s.lines.join('\n').trim()] : []
    // 사용한 검색어는 개인 리포트의 작업 기록이다
    if (/검색어/.test(s.head)) return []
    if (/빈칸|아직\s*채우지\s*못한/.test(s.head)) {
      hasGaps = true
      const body = s.lines.join('\n').trim()
      const extra = report.gaps.filter((g) => !body.includes(g)).map((g) => `- ${g}`)
      const list = extra.length ? (body ? ['', '**위키에 없는 것**', '', ...extra] : extra) : []
      return [`## 아직 채우지 못한 것\n\n${[body, ...list].join('\n').trim()}`]
    }
    if (/^참고\s*문서/.test(s.head) && refTable) {
      hasRefs = true
      return [`## 참고 문서\n\n${refTable}`]
    }
    return [`## ${s.head}\n${s.lines.join('\n').replace(/\s+$/, '')}`]
  })
  if (!hasGaps && report.gaps.length) parts.push(`## 아직 채우지 못한 것\n\n${report.gaps.map((g) => `- ${g}`).join('\n')}`)
  if (!hasRefs && refTable) parts.push(`## 참고 문서\n\n${refTable}`)

  const intro = /^##\s+이 문서는/m.test(md)
    ? ''
    : `## 이 문서는\n\n${kstDate(msg.reportMeta?.createdAt)}에 챗봇 리포트로 정리한 ${REFLECT_TYPE_NAME[report.reportType]}입니다. 문장 끝 표시는 근거를 뜻합니다 — [위키] 위키 문서에 적힌 내용, [외부] 공개된 외부 자료, [추정] 위 둘을 바탕으로 한 판단입니다. [추정] 문장은 정해진 정책이 아닙니다.\n\n`
  const body = `${intro}${parts.join('\n\n')}`.replace(/\n{3,}/g, '\n\n').trim() + '\n'

  const inferences = report.claims.filter((c) => c.basis === 'inference').length
  const reason = [
    `챗봇 리포트 「${title}」을 위키 문서로 올립니다.`,
    `근거: 위키 문서 ${refRows.length}건 · 외부 공개 자료 ${report.externalSources.length}건 · 판단([추정]) 문장 ${inferences}개`,
  ].join('\n')

  return {
    category: 'promotion',
    subcategory: SUB_BY_TYPE[report.reportType],
    scope,
    title,
    body,
    reason,
    via: 'report',
    fromMessageId: msg.id,
    reportTitle: report.title,
  }
}

/* ── 새 문서 화면으로 넘기는 통로 — 화면 이동 state + sessionStorage (주소창에는 본문을 싣지 않는다) ── */

const PREFILL_KEY = 'wiki-hub:newdoc-prefill'

// 공용 PC에 남지 않게 localStorage 는 쓰지 않는다 — 탭을 닫으면 사라진다
export function savePrefill(prefill: NewDocPrefill) {
  try {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify(prefill))
  } catch {
    /* 저장을 못 해도 화면 이동 state 로 넘어간다 — 새로고침하면 사라질 뿐이다 */
  }
}

export function readPrefill(): NewDocPrefill | null {
  try {
    const raw = sessionStorage.getItem(PREFILL_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as NewDocPrefill
    return typeof p.title === 'string' && typeof p.body === 'string' ? p : null
  } catch {
    return null
  }
}

export function clearPrefill() {
  try {
    sessionStorage.removeItem(PREFILL_KEY)
  } catch {
    /* 지우지 못해도 탭을 닫으면 사라진다 */
  }
}
