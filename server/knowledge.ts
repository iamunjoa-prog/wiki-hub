import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { maskPublicLeaks, publicLeaks, type Hit } from './publicCheck.js'

/** 로컬 CLI 중계(vite 플러그인)와 배포 함수(api/)가 함께 쓰는 답변 형식·문서 묶음 */

/**
 * 대화로 만든 문서 초안 재료(server/assistant-prompt.md 「지식 입력·수정」). 서버는 GitHub 을 부르지 않고 재료만 돌려준다 —
 * 수정은 화면이 이 칸으로 /api/edit 를 부르고, 제출은 사용자가 카드의 [제안 제출]을 눌러야만 된다
 */
export interface AskAction {
  type: 'none' | 'edit' | 'new'
  /** edit — `지식/` 기준 경로 */
  docPath: string
  /** edit — /api/edit 의 instruction 으로 그대로 넘긴다 */
  instruction: string
  /** edit·new — 사용자가 밝힌 근거. 없으면 '' (화면이 "근거 미기재"를 붙인다) */
  reason: string
  category: string
  /** 서브메뉴 없는 카테고리(이용 안내)는 '' */
  subcategory: string
  title: string
  scope: 'PPM' | 'PPV' | '공통' | ''
  body: string
}

export interface CliReply {
  text: string
  sourcePaths: string[]
  action: AskAction
}

export const NO_ACTION: AskAction = {
  type: 'none',
  docPath: '',
  instruction: '',
  reason: '',
  category: '',
  subcategory: '',
  title: '',
  scope: '',
  body: '',
}

// OpenAI·Gemini 구조화 출력 모두 받아들이는 형태: 중첩 객체까지 additionalProperties:false 와 전체 required
export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    sourcePaths: { type: 'array', items: { type: 'string' } },
    action: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['none', 'edit', 'new'] },
        docPath: { type: 'string' },
        instruction: { type: 'string' },
        reason: { type: 'string' },
        category: { type: 'string' },
        subcategory: { type: 'string' },
        title: { type: 'string' },
        scope: { type: 'string' },
        body: { type: 'string' },
      },
      required: ['type', 'docPath', 'instruction', 'reason', 'category', 'subcategory', 'title', 'scope', 'body'],
      additionalProperties: false,
    },
  },
  required: ['text', 'sourcePaths', 'action'],
  additionalProperties: false,
}

/**
 * 새 문서가 놓일 수 있는 카테고리·서브메뉴 — src/data/docs.ts 의 categories·subcategories 와 같아야 한다.
 * 서버는 화면 모듈(import.meta.glob 을 쓰는 knowledgeDocs.ts)을 불러올 수 없어 id 만 옮겨 둔다
 */
export const DOC_SUBCATEGORIES: Record<string, string[]> = {
  programming: ['movie-series', 'tv', 'animation', 'kids', 'free'],
  promotion: ['start', 'policy', 'process', 'system', 'banner-spec', 'insight', 'copy-guide', 'ops-reference'],
  guide: [],
}

/** 카테고리·서브메뉴 조합이 목록에 있는가 — 서브메뉴 없는 카테고리는 빈 값만 맞다 */
export function isKnownPlace(category: string, subcategory: string): boolean {
  const subs = DOC_SUBCATEGORIES[category]
  if (!subs) return false
  return subs.length === 0 ? subcategory === '' : subs.includes(subcategory)
}

/** 어시스턴트 대화 한 턴 — 기획 상담은 여러 턴에 걸쳐 조건을 모으므로 이력이 필요하다 */
export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
  /** assistant 턴 — 그 답의 근거 문서. 엔진은 앞 답의 근거를 따로 볼 수 없어 이력에 한 줄로 붙인다 */
  sourcePaths?: string[]
  /** assistant 턴 — 그 답에 실린 초안. 다음 턴의 "두 번째 줄은 빼줘"가 어느 초안을 고치는지 알게 한다 */
  action?: Pick<AskAction, 'type' | 'docPath' | 'instruction' | 'title'>
}

export interface AskInput {
  query: string
  history: ChatTurn[]
  /** 사용자가 칩으로 고른 모드 — 자동 판정(detectReportIntent)보다 우선한다. 그 질문 한 번에만 적용된다 */
  modeOverride?: 'qa' | 'report'
  /** 대화 기록(server/chatLog.ts)이 묶음으로 쓰는 화면 대화 ID — 형식이 틀리면 없는 것으로 본다. 답에는 쓰지 않는다 */
  chatId?: string
  /** 같은 질문의 엔진 넘기기 시도들이 함께 쓰는 턴 ID */
  turnId?: string
  /** 다시 묻기 경로(예: 「짧게 답 받기」) — 기록 참고값. 직접 다시 친 질문과 가르는 데만 쓰고 답에는 쓰지 않는다 */
  via?: string
}

/** 대화·턴 ID 형식 — 화면의 crypto.randomUUID()·말풍선 ID 가 들어가는 범위 */
const LOG_ID_RE = /^[a-zA-Z0-9-]{8,64}$/
const readLogId = (v: unknown): string | undefined => (typeof v === 'string' && LOG_ID_RE.test(v) ? v : undefined)
const MAX_VIA = 40
/** 한 줄 짧은 값만 — 길거나 비면 없는 것으로 본다 */
const readVia = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.replace(/[\r\n\t]+/g, ' ').trim() : ''
  return s && s.length <= MAX_VIA ? s : undefined
}

/**
 * 요청 본문 바이트 상한 — 배포 함수와 로컬 중계가 같은 값으로 자른다(server/guard.ts).
 * 글자 수 검사(MAX_QUERY 등)보다 앞에서 큰 본문을 읽기 전에 거절하려는 것이다. 한글은 UTF-8 한 글자가 3바이트다
 */
export const MAX_ASK_BYTES = 64 * 1024
export const MAX_EDIT_BYTES = 512 * 1024
/** 새 문서·수정 제안 PR — 본문 50,000자 상한(server/github.ts)을 한글로 채워도 들어가는 크기 */
export const MAX_PR_BYTES = 512 * 1024
/** 로그인·계정 관리·시스템 목록·CLI 로그인 창처럼 작은 양식 */
export const MAX_FORM_BYTES = 16 * 1024

const MAX_QUERY = 2000
/** 이력이 길어지면 앞쪽을 버린다 — 조건 수집에 필요한 건 최근 대화다 */
const MAX_HISTORY_TURNS = 12
const MAX_HISTORY_CHARS = 8000

/** /api/ask 요청 본문을 검증한다. 잘못되면 사용자에게 보여줄 메시지로 throw 한다. */
export function parseAskInput(raw: unknown): AskInput {
  const r = (raw ?? {}) as Record<string, unknown>
  const query = String(r.query ?? '').trim()
  if (!query) throw new Error('질문이 비어 있습니다')
  if (query.length > MAX_QUERY) throw new Error(`질문은 ${MAX_QUERY}자 이내로 입력해 주세요`)

  const raws = Array.isArray(r.history) ? r.history : []
  const history: ChatTurn[] = []
  let chars = 0
  // 뒤에서부터 담아 최근 대화를 우선 남기고, 마지막에 원래 순서로 되돌린다
  for (const item of raws.slice(-MAX_HISTORY_TURNS).reverse()) {
    const t = (item ?? {}) as Record<string, unknown>
    const text = String(t.text ?? '').trim()
    const role = t.role === 'assistant' ? 'assistant' : 'user'
    if (!text) continue
    // 글자 수는 본문만 센다 — 화면(src/lib/assistant.ts recentHistory)이 같은 규칙으로 잘라 보낸다
    chars += text.length
    if (chars > MAX_HISTORY_CHARS) break
    history.unshift(role === 'assistant' ? { role, text, ...parseTurnExtras(t) } : { role, text })
  }
  const modeOverride = r.modeOverride === 'qa' || r.modeOverride === 'report' ? r.modeOverride : undefined
  const chatId = readLogId(r.chatId)
  const turnId = readLogId(r.turnId)
  const via = readVia(r.via)
  return {
    query,
    history,
    ...(modeOverride ? { modeOverride } : {}),
    ...(chatId ? { chatId } : {}),
    ...(turnId ? { turnId } : {}),
    ...(via ? { via } : {}),
  }
}

const MAX_TURN_PATHS = 5
const MAX_TURN_FIELD = 300

/** 이력 턴의 선택 칸 — 프롬프트에 그대로 들어가므로 짧은 한 줄 값만 받는다 */
function parseTurnExtras(t: Record<string, unknown>): Pick<ChatTurn, 'sourcePaths' | 'action'> {
  const line = (v: unknown, max = MAX_TURN_FIELD) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '')
  const out: Pick<ChatTurn, 'sourcePaths' | 'action'> = {}
  if (Array.isArray(t.sourcePaths)) {
    const paths = t.sourcePaths.map((p) => line(p, 200)).filter(Boolean).slice(0, MAX_TURN_PATHS)
    if (paths.length) out.sourcePaths = paths
  }
  const a = (t.action ?? null) as Record<string, unknown> | null
  if (a && (a.type === 'edit' || a.type === 'new'))
    out.action = { type: a.type, docPath: line(a.docPath, 200), instruction: line(a.instruction), title: line(a.title, 80) }
  return out
}

/**
 * 이력 한 턴을 엔진에 넘길 글로 편다 — CLI(한 덩어리 프롬프트)와 Gemini(멀티턴) 모두 이 글을 쓴다.
 * assistant 턴에는 근거 문서와 초안을 한 줄씩 붙여, "그 문서 고쳐줘"·"두 번째 줄은 빼줘"가 앞 답을 가리킬 수 있게 한다
 */
export function historyTurnText(t: ChatTurn): string {
  if (t.role !== 'assistant') return t.text
  const lines = [t.text]
  const paths = [...new Set([...(t.sourcePaths ?? []), ...(t.action?.type === 'edit' && t.action.docPath ? [t.action.docPath] : [])])]
  if (paths.length) lines.push(`근거: ${paths.join(', ')}`)
  if (t.action?.type === 'edit') lines.push(`초안: 문서 수정 · ${t.action.docPath} · 요청: ${t.action.instruction}`)
  else if (t.action?.type === 'new') lines.push(`초안: 새 문서 · 「${t.action.title}」`)
  return lines.join('\n')
}

/** 이력을 프롬프트 한 덩어리로 편다 — 멀티턴 입력을 받지 않는 CLI 엔진용 */
export function buildAskRequest({ query, history }: AskInput): string {
  if (history.length === 0) return `## 질문\n\n${query}`
  const transcript = history.map((t) => `${t.role === 'user' ? '사용자' : '어시스턴트'}: ${historyTurnText(t)}`).join('\n\n')
  return [
    '## 지금까지의 대화',
    // 되물은 문장이 사용자의 조건으로 굳어지면 PPV 질문에 PPM 정책이 딸려 나온다
    '맥락으로만 쓴다. 사용자가 직접 말한 것만 확정된 조건이고, 어시스턴트가 되물은 문장은 조건이 아니다.',
    '이미 답을 들은 것은 다시 묻지 않는다.',
    transcript,
    `## 이번 질문\n\n이 질문에 답하라. 앞 대화는 이 질문을 이해하는 데 필요한 만큼만 참고한다.\n\n${query}`,
  ].join('\n\n')
}

/** 수정 제안 화면의 "AI로 수정" — 문서 본문과 요청을 받아 고친 본문 전체를 돌려준다. section 이 있으면 그 장만 */
export interface EditInput {
  title: string
  code: string
  path: string
  body: string
  instruction: string
  /** 장 단위 수정(doc-editing 2-5) — 있으면 엔진에는 이 장과 목차만 보내고, 돌려줄 때도 이 장만 돌려준다 */
  section?: EditSection
}

export interface EditSection {
  /** 장 제목(`## ` 뒤 글자). 머리말은 '' — 장 원문 첫 줄에서 뽑는다 */
  title: string
  /** 화면이 보낸 장 앵커(`h-…`·`intro`) — 응답에 그대로 돌려줄 뿐 판단에는 쓰지 않는다 */
  anchor: string
  /** 그 장 원문 — `## ` 제목 줄부터 다음 장 앞까지 */
  body: string
  /** 문서의 장 제목 순서(머리말 제외) — 엔진이 앞뒤 문맥과 용어를 맞추는 데만 쓴다 */
  outline: string[]
}

export interface EditReply {
  body: string
  summary: string
}

/** /api/edit 응답 — section 입력이면 body 는 그 장만이고 section 칸이 붙는다 */
export interface EditResponse extends EditReply {
  section?: {
    title: string
    anchor: string
    /** 엔진이 장 밖(다른 장)까지 써 와서 서버가 그 장만 잘라 냈으면 true */
    trimmed: boolean
  }
}

export const EDIT_SCHEMA = {
  type: 'object',
  properties: {
    body: { type: 'string' },
    summary: { type: 'string' },
  },
  required: ['body', 'summary'],
  additionalProperties: false,
}

const MAX_EDIT_BODY = 200_000
const MAX_INSTRUCTION = 2000
const MAX_OUTLINE = 100
const MAX_OUTLINE_TITLE = 200

/**
 * 본문을 `## ` 장으로 가른다. 코드 블록 안의 `## ` 는 장이 아니다 — src/lib/draft.ts splitSections 와 같은 규칙이어야
 * 화면이 나눈 장과 서버가 자른 장이 어긋나지 않는다. 첫 조각은 머리말(title '')이고 비어 있으면 뺀다
 */
export function splitH2(body: string): { title: string; text: string }[] {
  const out: { title: string; lines: string[] }[] = [{ title: '', lines: [] }]
  let fence: string | null = null
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    const f = /^\s*(```|~~~)/.exec(line)
    if (f) fence = fence === null ? f[1] : fence === f[1] ? null : fence
    if (fence === null && !f && /^##\s/.test(line)) out.push({ title: line.replace(/^##\s+/, '').trim(), lines: [] })
    out[out.length - 1].lines.push(line)
  }
  return out.filter((s, i) => i > 0 || s.lines.length > 0).map(({ title, lines }) => ({ title, text: lines.join('\n') }))
}

const oneLine = (v: string) => v.replace(/[\r\n]+/g, ' ').trim()

function parseEditSection(raw: unknown, docBody: string): EditSection | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error('고칠 장(section) 형식이 올바르지 않습니다')
  const r = raw as Record<string, unknown>
  const body = typeof r.body === 'string' ? r.body.replace(/\r\n?/g, '\n') : ''
  if (!body.trim()) throw new Error('고칠 장 본문이 비어 있습니다')
  if (body.length > MAX_EDIT_BODY) throw new Error('장이 너무 커서 AI로 수정할 수 없습니다')
  const parts = splitH2(body).filter((p) => p.title || p.text.trim())
  // 장 둘 이상을 보내면 "그 장 밖은 바꾸지 않는다"를 지킬 기준이 없다
  if (parts.length !== 1) throw new Error('장 하나만 보내 주세요')
  const title = parts[0].title
  if (typeof r.title === 'string' && oneLine(r.title) !== title) throw new Error('장 제목이 장 본문 첫 줄과 맞지 않습니다')
  // 목차는 화면이 주면 그대로, 없으면 함께 온 문서 전체 본문에서 뽑는다
  const given = Array.isArray(r.outline) ? r.outline.filter((t): t is string => typeof t === 'string') : null
  const outline = (given ?? splitH2(docBody).map((p) => p.title))
    .map(oneLine)
    .filter(Boolean)
    .slice(0, MAX_OUTLINE)
    .map((t) => t.slice(0, MAX_OUTLINE_TITLE))
  return { title, anchor: typeof r.anchor === 'string' ? oneLine(r.anchor).slice(0, MAX_OUTLINE_TITLE) : '', body, outline }
}

/** 요청 본문을 검증한다. 잘못되면 사용자에게 보여줄 메시지로 throw 한다. */
export function parseEditInput(raw: unknown): EditInput {
  const r = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  const input: EditInput = {
    title: str(r.title).trim(),
    code: str(r.code).trim(),
    path: str(r.path).trim(),
    body: str(r.body),
    instruction: str(r.instruction).trim(),
  }
  if (!input.instruction) throw new Error('수정 요청이 비어 있습니다')
  if (input.instruction.length > MAX_INSTRUCTION) throw new Error(`수정 요청은 ${MAX_INSTRUCTION}자 이내로 입력해 주세요`)
  if (input.body.length > MAX_EDIT_BODY) throw new Error('문서가 너무 커서 AI로 수정할 수 없습니다')
  const section = parseEditSection(r.section, input.body)
  if (section) input.section = section
  return input
}

/** 엔진에 보낼 요청 — section 이면 문서 본문 대신 그 장과 목차만 실어 짧고 빠르게 */
export function buildEditRequest(input: EditInput): string {
  const head = `## 수정할 문서\n\n- 제목: ${input.title}\n- 문서 코드: ${input.code}\n- 경로: ${input.path}`
  const ask = `## 수정 요청\n\n${input.instruction}`
  const s = input.section
  if (!s) return [head, `<document>\n${input.body}\n</document>`, ask].join('\n\n')
  const toc = s.outline.length
    ? s.outline.map((t) => `- ${t}${t === s.title ? '  ← 지금 고칠 장' : ''}`).join('\n')
    : '- (목차 없음)'
  return [
    head,
    `## 문서 목차 (참고용 — 용어와 이름을 다른 장과 맞추는 데만 쓴다)\n\n${toc}`,
    `## 고칠 장: ${s.title || '머리말'}\n\n이번에는 문서 전체가 아니라 아래 <section> 의 장 하나만 받았다. \`body\` 에는 이 장만 돌려준다. 장 제목 줄은 그대로 두고, 다른 장의 제목이나 내용을 새로 쓰지 않는다.`,
    `<section>\n${s.body}\n</section>`,
    ask,
  ].join('\n\n')
}

export function checkEditReply(out: unknown): EditReply {
  const o = (out ?? {}) as Partial<EditReply>
  if (typeof o.body !== 'string' || !o.body.trim()) throw new Error('AI가 수정한 본문을 돌려주지 않았습니다')
  return { body: o.body.replace(/\r\n?/g, '\n'), summary: typeof o.summary === 'string' ? o.summary.trim() : '' }
}

/** 엔진이 장 밖을 바꿔 와 그 장만 골라낼 수도 없었다 — 화면은 받지 않고 다시 부탁하게 한다 */
export class SectionOutsideError extends Error {
  readonly status = 422
  readonly code = 'outside'
  constructor() {
    super('AI가 이 장 밖까지 바꿔 와서 받지 않았습니다')
    this.name = 'SectionOutsideError'
  }
}

/** 장 밖 거절 응답 본문 — 배포 api/edit.ts 와 로컬 중계가 같은 칸으로 내보낸다 */
export const sectionOutsideBody = (err: SectionOutsideError) => ({ error: err.message, code: err.code })

/**
 * 엔진 답을 응답으로 — section 이면 그 장만 남긴다(장 밖은 서버에서도 바꾸지 않는다).
 * 다른 장이 딸려 오면 제목이 같은 장만 잘라 내고, 고를 수 없으면 SectionOutsideError. 장 끝 빈 줄은 원문대로 둔다(다음 장과의 간격)
 */
export function finishEditReply(input: EditInput, reply: EditReply): EditResponse {
  const s = input.section
  if (!s) return reply
  const parts = splitH2(reply.body).filter((p) => p.title || p.text.trim())
  let text: string | undefined
  if (s.title) {
    text = parts.find((p) => p.title === s.title)?.text
    // 제목 줄만 빼먹고 장 내용만 돌려준 경우 — 원래 제목 줄을 다시 붙인다
    if (text === undefined && parts.length === 1 && !parts[0].title)
      text = `${s.body.split('\n', 1)[0]}\n${parts[0].text.replace(/^\n+/, '')}`
  } else {
    // 머리말은 제목이 없다 — 첫 `## ` 앞 조각만 머리말이다
    text = parts.find((p) => !p.title)?.text
  }
  if (text === undefined || !text.trim()) throw new SectionOutsideError()
  const tail = /\s*$/.exec(s.body)?.[0] ?? ''
  return {
    body: text.replace(/\s+$/, '') + tail,
    summary: reply.summary,
    section: { title: s.title, anchor: s.anchor, trimmed: parts.length > 1 },
  }
}

function listDocs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name)
    if (e.isDirectory()) return listDocs(full)
    return e.name.endsWith('.md') ? [full] : []
  })
}

const docsCache = new Map<string, string>()
const pathsCache = new Map<string, Set<string>>()

/** 위키 문서 경로(`지식/` 기준, `/` 구분) — 초안의 docPath 가 실제 문서인지 본다 */
export function listDocPaths(knowledgeDir: string): Set<string> {
  const cached = pathsCache.get(knowledgeDir)
  if (cached) return cached
  const paths = new Set(listDocs(knowledgeDir).map((file) => relative(knowledgeDir, file).replace(/\\/g, '/')))
  pathsCache.set(knowledgeDir, paths)
  return paths
}

/**
 * 위키 문서 전체(약 100KB)를 한 프롬프트 블록으로 묶는다 — 문서를 직접 열어볼 수 없는 엔진(Codex 샌드박스, Gemini API)용.
 * 서버가 떠 있는 동안 문서는 바뀌지 않으므로 폴더별로 한 번만 읽는다.
 */
export function buildDocsBlock(knowledgeDir: string): string {
  const cached = docsCache.get(knowledgeDir)
  if (cached) return cached
  const block = listDocs(knowledgeDir)
    .map((file) => {
      const path = relative(knowledgeDir, file).replace(/\\/g, '/')
      return `<document path="${path}">\n${readFileSync(file, 'utf8')}\n</document>`
    })
    .join('\n\n')
  docsCache.set(knowledgeDir, block)
  return block
}

/**
 * 편성표는 날짜(m/d)로 찾으므로, 모델이 "오늘"을 스스로 추측하지 않도록 서버 시각을 박아 준다.
 * 배포 함수는 UTC 로 돌아서 한국 시각(KST)으로 맞춘다 — 그대로 두면 아침 9시 전엔 어제 날짜가 된다
 */
export function todayLine(): string {
  const n = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return `오늘 날짜: ${n.getUTCFullYear()}-${String(n.getUTCMonth() + 1).padStart(2, '0')}-${String(n.getUTCDate()).padStart(2, '0')} (${n.getUTCMonth() + 1}/${n.getUTCDate()})`
}

/**
 * 모델이 JSON 문자열 안에 이스케이프를 한 번 더 넣어 보내는 경우가 있다.
 * 그러면 `\n` 이 줄바꿈이 아니라 글자 그대로 렌더돼 답변 전체가 한 문단으로 뭉친다.
 *
 * 실제 줄바꿈이 하나도 없으면서 리터럴 `\n` 만 있을 때로 좁혀서 되돌린다 —
 * 문서 본문에 정상적으로 들어 있는 백슬래시까지 건드리지 않기 위해서다.
 */
export function unescapeNewlines(text: string): string {
  if (text.includes('\n') || !text.includes('\\n')) return text
  return text.replace(/\\([nt"\\])/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))
}

/**
 * 가림 표기는 별표 하나(`미디어*팀장`)지만, 예전 표기(`미디어**팀장`)가 남았거나 모델이 별표를 겹쳐 쓰면 굵게 기호와 섞여 짝이 깨진다.
 * 안전장치로 한 줄의 `**` 가 홀수일 때만 손댄다 — 짝이 맞는 줄은 정상 굵게로 본다.
 * 여는 기호(앞이 공백·줄 처음) 사이에서 마지막으로 닫을 수 있는 `**` 를 닫는 기호로 고르고,
 * 그 사이에 낀 `**` 는 가림 표시로 보고 전각 `＊＊` 로 바꿔 글자 그대로 보이게 한다. 단일 `*`(류*영)는 건드리지 않는다.
 */
export function balanceBold(text: string): string {
  return text.split('\n').map(balanceBoldLine).join('\n')
}

function balanceBoldLine(line: string): string {
  // 정확히 두 개짜리 별표 묶음만 굵게 후보로 본다
  const marks = [...line.matchAll(/(?<!\*)\*\*(?!\*)/g)].map((m) => {
    const at = m.index!
    const prev = line[at - 1]
    const next = line[at + 2]
    return { at, open: next !== undefined && !/\s/.test(next), close: prev !== undefined && !/\s/.test(prev) }
  })
  if (marks.length % 2 === 0) return line
  const literal = new Set<number>()
  let i = 0
  while (i < marks.length) {
    if (!marks[i].open) {
      literal.add(marks[i].at)
      i++
      continue
    }
    // 다음 '여는 기호만 되는' 자리 전까지가 이 굵게 구절이 닫힐 수 있는 범위다
    let end = i + 1
    while (end < marks.length && !(marks[end].open && !marks[end].close)) end++
    let closer = -1
    for (let j = end - 1; j > i; j--) {
      if (marks[j].close) {
        closer = j
        break
      }
    }
    if (closer < 0) {
      literal.add(marks[i].at)
      i++
      continue
    }
    for (let j = i + 1; j < closer; j++) literal.add(marks[j].at)
    i = closer + 1
  }
  let out = ''
  let last = 0
  for (const at of [...literal].sort((a, b) => a - b)) {
    out += line.slice(last, at) + '＊＊'
    last = at + 2
  }
  return out + line.slice(last)
}

/** 초안을 버렸을 때 본문 끝에 붙는 줄 — docs/sections/requests-chat-draft.md 5-8 */
export const ACTION_DROPPED_TEXT = '초안을 만들지 못했습니다. 바꿀 내용을 한 번 더 알려 주세요.'

/** 새 문서 제목·본문 상한 — server/github.ts 의 PR 입력 검사와 같은 값이라 카드에서 제출해도 걸리지 않는다 */
export const MAX_DOC_TITLE = 80
export const MAX_DOC_BODY = 50_000
const MAX_ACTION_REASON = 2000

/** 모델이 `./`·`지식/`·역슬래시를 붙여 보내도 같은 문서로 본다 */
const normalizeDocPath = (p: string) => p.trim().replace(/\\/g, '/').replace(/^\.?\//, '').replace(/^지식\//, '')

/**
 * 초안 재료 검증. 쓸 수 없는 초안은 none 으로 바꾸고 dropped 로 알린다 — 카드가 틀린 문서·빈 본문으로 뜨지 않게.
 * 안 쓰는 칸은 비워서 돌려준다(모델이 edit 에 body 를 채워 보내도 화면이 헷갈리지 않게)
 */
function checkAction(raw: unknown, docPaths: Set<string>): { action: AskAction; dropped: boolean } {
  const a = (raw ?? {}) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? unescapeNewlines(v).replace(/\r\n?/g, '\n').trim() : '')
  const line = (v: unknown) => str(v).replace(/\n+/g, ' ')
  const reason = line(a.reason).slice(0, MAX_ACTION_REASON)
  const drop = { action: NO_ACTION, dropped: true }

  if (a.type === 'edit') {
    const docPath = normalizeDocPath(str(a.docPath))
    const instruction = str(a.instruction)
    if (!docPaths.has(docPath) || !instruction || instruction.length > MAX_INSTRUCTION) return drop
    return { action: { ...NO_ACTION, type: 'edit', docPath, instruction, reason }, dropped: false }
  }
  if (a.type === 'new') {
    const category = line(a.category)
    const subcategory = line(a.subcategory)
    const title = line(a.title)
    const body = str(a.body)
    if (!isKnownPlace(category, subcategory)) return drop
    if (!title || title.length > MAX_DOC_TITLE) return drop
    // 프론트매터는 서버가 PR 을 만들 때 쓴다 — 본문에 --- 블록이 오면 지어낸 것이다
    if (!body || body.length > MAX_DOC_BODY || /^---\s*\n/.test(body)) return drop
    const scope = a.scope === 'PPM' || a.scope === 'PPV' ? a.scope : '공통'
    return { action: { ...NO_ACTION, type: 'new', reason, category, subcategory, title, scope, body }, dropped: false }
  }
  return { action: NO_ACTION, dropped: false }
}

/** 답변 검증 — claude·codex·gemini 세 엔진의 응답이 모두 이 함수를 지난다. knowledgeDir 는 초안 docPath 를 대조할 위키 폴더 */
export function checkAskReply(out: unknown, knowledgeDir: string): CliReply {
  const r = (out ?? {}) as Partial<CliReply>
  if (typeof r.text !== 'string') throw new Error('답변 형식이 올바르지 않습니다')
  const sourcePaths = Array.isArray(r.sourcePaths) ? r.sourcePaths.filter((p): p is string => typeof p === 'string') : []
  const { action, dropped } = checkAction(r.action, listDocPaths(knowledgeDir))
  let text = balanceBold(unescapeNewlines(r.text).trim())
  if (dropped) text = text ? `${text}\n\n${ACTION_DROPPED_TEXT}` : ACTION_DROPPED_TEXT
  // 수정 대상은 근거 칩에도 보여야 한다 — 화면이 sourcePaths 로 출처를 그린다
  if (action.type === 'edit' && !sourcePaths.map(normalizeDocPath).includes(action.docPath)) sourcePaths.unshift(action.docPath)
  return { text, sourcePaths, action }
}

/* ── 리포트 모드 (docs/plan/2026-11-18-cli-report-mode.md) ──────────────────────────
 * 비교·점검·인사이트 정리 질문은 짧은 Q&A 규약 대신 server/report-prompt.md 로 보고 문서를 만든다.
 * 판정은 로컬 중계와 배포 함수가 같은 규칙을 써야 배포본 안내도 같은 질문에서 나온다.
 * REPLY_SCHEMA·checkAskReply 는 Gemini 도 쓰므로 건드리지 않고 리포트 전용 형식을 따로 둔다
 */

export type ReportType = 'compare' | 'audit' | 'insight' | 'brief'
export const REPORT_TYPES: ReportType[] = ['compare', 'audit', 'insight', 'brief']

/** 프롬프트에 넘기는 유형 이름 — server/report-prompt.md "리포트 유형" 표와 같은 이름 */
export const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  compare: 'A. 타사 비교·개선점 도출',
  audit: 'B. 위키 전반 이슈 점검',
  insight: 'C. 상품별 인사이트·판단 근거',
  brief: 'D. 업무 정리·보고서 초안',
}

export interface ReportIntent {
  /** report: 리포트로 답한다 · offer: 짧은 답 + 「리포트로 자세히 받기」 칩 · qa: 지금처럼 */
  mode: 'report' | 'offer' | 'qa'
  /** 리포트로 갈 때 쓸 유형 — 모델이 고르게 두면 흔들려서(조사 S3) 서버가 정한다 */
  type: ReportType
}

interface ReportSignal {
  re: RegExp
  /** 2 는 하나로 충분한 강한 신호, 1 은 둘 이상 모여야 리포트 */
  weight: 1 | 2
  type?: ReportType
  /** 다른 신호와 함께일 때만 센다 — 혼자서는 칩도 붙이지 않는다 */
  weak?: true
}

const REPORT_SIGNALS: ReportSignal[] = [
  { re: /리포트|레포트|보고서|보고\s*자료|보고용|장표|문서로\s*정리|정리해서\s*문서/, weight: 2 },
  { re: /타사|경쟁사|업계|벤치마킹|비교해|비교\s*분석/, weight: 2, type: 'compare' },
  // "대비"는 "장애 대비"처럼 준비라는 뜻도 있어 혼자서는 리포트로 보지 않는다
  { re: /대비/, weight: 1, type: 'compare', weak: true },
  { re: /이슈\s*(?:체크|점검)/, weight: 2, type: 'audit' },
  { re: /개선점|점검|진단|문제점|체크해|전반|전체적으로|도출/, weight: 1, type: 'audit' },
  { re: /인사이트\s*(?:정리|종합)/, weight: 2, type: 'insight' },
  { re: /인사이트/, weight: 1, type: 'insight' },
  { re: /종합|한눈에|총정리/, weight: 1 },
  { re: /(?:추천|제안)[^.?!]*(?:근거|이유|데이터|자료)|(?:근거|이유|데이터|자료)[^.?!]*(?:추천|제안)/, weight: 1, type: 'insight' },
  { re: /위키\s*전체|모든\s*문서|전체\s*문서/, weight: 1, type: 'audit' },
]

/** 있으면 일반 Q&A — 짧은 답을 원하거나, 지식 입력·수정 요청이다 */
const SHORT_ANSWER = /짧게|한\s*줄로|간단히|간단하게|요약만/
const EDIT_REQUEST = /고쳐|수정해|바꿔\s*줘|반영해|올려\s*줘|추가해\s*줘|삭제해|지워\s*줘/
/** 판단 요청 — 짧은 답으로 먼저 답하고 리포트 칩을 붙인다(열린 질문 Q2 가안) */
const JUDGMENT = /추천|어떻게\s*정하|얼마로|몇\s*%|할인율|적정|정해\s*줘|골라\s*줘|뭐가\s*나아|어느\s*쪽이\s*나아/

const TYPE_ORDER: ReportType[] = ['compare', 'audit', 'insight']

function scoreReport(text: string): { score: number; types: Set<ReportType> } {
  let score = 0
  let firm = 0
  const types = new Set<ReportType>()
  for (const s of REPORT_SIGNALS) {
    if (!s.re.test(text)) continue
    score += s.weight
    if (!s.weak) firm += s.weight
    if (s.type) types.add(s.type)
  }
  if (JUDGMENT.test(text)) types.add('insight')
  return { score: firm ? score : 0, types }
}

const pickType = (types: Set<ReportType>): ReportType | null => TYPE_ORDER.find((t) => types.has(t)) ?? null

/**
 * 질문을 보고 리포트로 답할지 정한다. 화면은 따로 판정하지 않고 서버가 돌려준 mode 를 따른다.
 * "리포트로 정리해줘"처럼 주제 없이 모드만 바꾸는 말이면 앞 질문(이력의 마지막 사용자 턴)에서 유형을 읽는다
 */
export function detectReportIntent(query: string, history: ChatTurn[] = [], modeOverride?: 'qa' | 'report'): ReportIntent {
  const { score, types } = scoreReport(query)
  const prevUser = [...history].reverse().find((t) => t.role === 'user')
  const type = pickType(types) ?? (prevUser ? pickType(scoreReport(prevUser.text).types) : null) ?? 'brief'

  if (modeOverride) return { mode: modeOverride, type }
  if (SHORT_ANSWER.test(query) || EDIT_REQUEST.test(query)) return { mode: 'qa', type }
  if (score >= 2) return { mode: 'report', type }
  if (score === 1 || JUDGMENT.test(query)) return { mode: 'offer', type }
  return { mode: 'qa', type }
}

/** 배포본·로컬 Gemini·규칙 기반에서 리포트성 질문을 받았을 때 — 최종 문구는 chatbot-planner 소관 */
export const REPORT_LOCAL_ONLY_TEXT =
  '비교·점검·인사이트 정리 같은 리포트는 로컬 허브의 Claude·Codex에서 만들 수 있습니다. 여기서는 위키 문서 기준의 짧은 답만 드립니다.'

/** 리포트 근거로 위키 문서 대신 쓸 수 있는 편성표 표기 — sourcePaths 밖이어도 [추정]으로 내리지 않는다 */
export const SCHEDULE_REFS = ['schedule:today-btv', 'schedule:big-banner']

export interface ReportClaim {
  text: string
  basis: 'wiki' | 'external' | 'inference'
  refs: string[]
}

export interface ExternalSource {
  title: string
  url: string
  accessedAt: string
}

// claude --json-schema · codex --output-schema 둘 다 받아들이는 형태: 중첩 객체까지 additionalProperties:false 와 전체 required
export const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    markdown: { type: 'string' },
    reportType: { type: 'string', enum: REPORT_TYPES },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          text: { type: 'string' },
          basis: { type: 'string', enum: ['wiki', 'external', 'inference'] },
          refs: { type: 'array', items: { type: 'string' } },
        },
        required: ['text', 'basis', 'refs'],
        additionalProperties: false,
      },
    },
    sourcePaths: { type: 'array', items: { type: 'string' } },
    externalSources: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, url: { type: 'string' }, accessedAt: { type: 'string' } },
        required: ['title', 'url', 'accessedAt'],
        additionalProperties: false,
      },
    },
    searchQueries: { type: 'array', items: { type: 'string' } },
    gaps: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'summary', 'markdown', 'reportType', 'claims', 'sourcePaths', 'externalSources', 'searchQueries', 'gaps'],
  additionalProperties: false,
}

/** 웹 검색을 끈 이유 — engine: 사전 차단이 안 되는 엔진(codex) · terms: 비공개 이름 목록 없음 · type: 점검 유형은 검색하지 않음 */
export type WebSearchOff = 'engine' | 'terms' | 'type'

export interface ReportReply {
  title: string
  /** 대화창 말풍선의 3줄 요약 — 굵게만 쓴다. 앞 대화 이력으로는 이 칸만 넘어간다 */
  summary: string
  markdown: string
  reportType: ReportType
  claims: ReportClaim[]
  sourcePaths: string[]
  externalSources: ExternalSource[]
  /** 실제로 내보낸 검색어 — claude 는 훅 기록으로 덮어쓴다 */
  searchQueries: string[]
  gaps: string[]
  /** 이번 리포트에서 웹 검색을 켰는지. 꺼졌으면 webSearchOff 에 이유 */
  webSearch: boolean
  webSearchOff: WebSearchOff | null
  /** 서버가 본문에서 가린 건수 — 금액은 "(금액 생략)", 목록 이름은 "(이름 생략)" */
  masked: { amount: number; name: number }
  /** 가린 뒤에도 남은 공개 규칙 경고(별표 2개·회사 표기·이메일·전화) — 개인 문서라 막지는 않는다 */
  warnings: Hit[]
}

const WEB_OFF_REASON: Record<WebSearchOff, string> = {
  engine: '이 엔진은 웹 검색을 하지 않는다',
  terms: '공개하면 안 되는 이름 목록이 연결되지 않아 이번에는 웹 검색을 끈다',
  type: '점검 유형은 웹 검색을 하지 않는다',
}

/** 리포트 요청 머리 — 오늘 날짜·엔진·웹 검색 여부·서버가 정한 유형을 넘기고, 질문·이력은 Q&A 와 같은 형식으로 붙인다 */
export function buildReportRequest(
  input: AskInput,
  ctx: { type: ReportType; engineLabel: string; webSearchOff: WebSearchOff | null },
): string {
  return [
    [
      '## 리포트 조건',
      `- ${todayLine()}`,
      `- 사용 엔진: ${ctx.engineLabel}`,
      `- 웹 검색: ${ctx.webSearchOff ? `꺼짐 — ${WEB_OFF_REASON[ctx.webSearchOff]}` : '켜짐'}`,
      `- 리포트 유형: ${REPORT_TYPE_LABEL[ctx.type]} (\`${ctx.type}\`) — 앱이 정한 유형이다. 이 유형의 골격으로 쓰고 reportType 에 그대로 넣는다.`,
    ].join('\n'),
    buildAskRequest(input),
  ].join('\n\n')
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function httpsUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim())
    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

const todayIso = () => new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)

/**
 * 리포트 검증 — claude·codex 응답이 모두 이 함수를 지난다.
 * 근거 태그를 목록과 맞추고(없는 근거는 [추정]으로), https 출처만 남기고, 금액·목록 이름은 가려서 돌려준다
 */
export function checkReportReply(
  out: unknown,
  ctx: {
    reportType: ReportType
    webSearchOff: WebSearchOff | null
    terms: string[] | null
    /** 훅이 기록한 실제 검색어 — 있으면 모델이 채운 searchQueries 대신 쓴다 */
    observedQueries?: string[]
  },
): ReportReply {
  const r = (out ?? {}) as Record<string, unknown>
  if (typeof r.markdown !== 'string' || !r.markdown.trim()) throw new Error('리포트 본문을 돌려주지 않았습니다')
  const webSearch = ctx.webSearchOff === null

  const masked = { amount: 0, name: 0 }
  const mask = (text: string, count = false) => {
    const m = maskPublicLeaks(text, ctx.terms)
    if (count) {
      masked.amount += m.amount
      masked.name += m.name
    }
    return m.text
  }

  const markdown = mask(unescapeNewlines(r.markdown).replace(/\r\n?/g, '\n').trim(), true)
  const firstHeading = markdown.match(/^#\s+(.+)$/m)?.[1].trim() ?? ''
  const title = mask((typeof r.title === 'string' && r.title.trim()) || firstHeading || '리포트', true).replace(/[\r\n]+/g, ' ')
  const summary = balanceBold(mask(unescapeNewlines(typeof r.summary === 'string' ? r.summary : '').trim(), true))

  const sourcePaths = [...new Set(strings(r.sourcePaths).map(normalizeDocPath).filter(Boolean))]
  const externalSources: ExternalSource[] = []
  if (webSearch && Array.isArray(r.externalSources)) {
    const seen = new Set<string>()
    for (const item of r.externalSources) {
      const s = (item ?? {}) as Record<string, unknown>
      const url = httpsUrl(typeof s.url === 'string' ? s.url : '')
      if (!url || seen.has(url)) continue
      seen.add(url)
      externalSources.push({
        title: mask(typeof s.title === 'string' && s.title.trim() ? s.title.trim() : url),
        url,
        accessedAt: typeof s.accessedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.accessedAt) ? s.accessedAt : todayIso(),
      })
    }
  }

  const wikiRefs = new Set([...sourcePaths, ...SCHEDULE_REFS])
  const urlRefs = new Set(externalSources.map((s) => s.url))
  const claims: ReportClaim[] = (Array.isArray(r.claims) ? r.claims : []).flatMap((item) => {
    const c = (item ?? {}) as Record<string, unknown>
    if (typeof c.text !== 'string' || !c.text.trim()) return []
    let basis: ReportClaim['basis'] = c.basis === 'wiki' || c.basis === 'external' ? c.basis : 'inference'
    const refs = strings(c.refs).map((ref) => (/^https?:/.test(ref.trim()) ? (httpsUrl(ref) ?? ref.trim()) : normalizeDocPath(ref)))
    // 목록에 없는 근거를 단 [위키]·[외부] 문장은 화면에서 [추정]으로 보인다.
    // [외부]는 위키+외부가 섞인 문장에도 붙으므로(가장 약한 쪽) 위키 경로가 함께 있어도 되고, 목록에 있는 URL 이 하나는 있어야 한다
    if (basis === 'wiki' && (refs.length === 0 || !refs.every((ref) => wikiRefs.has(ref)))) basis = 'inference'
    if (basis === 'external' && (!refs.some((ref) => urlRefs.has(ref)) || !refs.every((ref) => urlRefs.has(ref) || wikiRefs.has(ref))))
      basis = 'inference'
    return [{ text: mask(unescapeNewlines(c.text).trim()), basis, refs }]
  })

  const modelQueries = strings(r.searchQueries)
  const searchQueries = webSearch ? (ctx.observedQueries ?? modelQueries).map((q) => mask(q.trim())).filter(Boolean) : []
  const gaps = strings(r.gaps).map((g) => mask(g.trim())).filter(Boolean)

  const warnKinds = new Set(['doubleStar', 'company', 'email', 'phone'])
  const check = publicLeaks({ title, body: markdown, via: 'report' }, { terms: ctx.terms })
  const warnings = [...check.blocks, ...check.warnings].filter((h) => warnKinds.has(h.kind))

  return {
    title,
    summary,
    markdown,
    reportType: ctx.reportType,
    claims,
    sourcePaths,
    externalSources,
    searchQueries,
    gaps,
    webSearch,
    webSearchOff: ctx.webSearchOff,
    masked,
    warnings,
  }
}

/**
 * /api/ask 응답 — 로컬·배포 공통. 리포트도 text(=요약)·sourcePaths 를 함께 실어,
 * 리포트 카드를 아직 모르는 화면도 짧은 답처럼 그릴 수 있게 한다
 */
export type AskResponse =
  | (CliReply & { mode: 'qa'; reportHint?: 'offer' | 'local-only'; notice?: string })
  | (CliReply & { mode: 'report'; report: ReportReply })
  | (CliReply & { mode: 'report-unavailable' })

/** 짧은 답 응답 — 판단 요청(offer)이면 리포트를 만들 수 있는 엔진은 칩을, 아니면 로컬 허브 안내 한 줄을 붙인다 */
export function qaResponse(reply: CliReply, intent: ReportIntent, canReport: boolean): AskResponse {
  if (intent.mode !== 'offer') return { mode: 'qa', ...reply }
  return canReport
    ? { mode: 'qa', ...reply, reportHint: 'offer' }
    : { mode: 'qa', ...reply, reportHint: 'local-only', notice: REPORT_LOCAL_ONLY_TEXT }
}

export const reportUnavailable = (): AskResponse => ({
  mode: 'report-unavailable',
  text: REPORT_LOCAL_ONLY_TEXT,
  sourcePaths: [],
  action: NO_ACTION,
})

/** 리포트 응답 — 리포트 카드를 모르는 화면도 요약을 짧은 답처럼 그린다 */
export const reportResponse = (report: ReportReply): AskResponse => ({
  mode: 'report',
  text: report.summary || report.title,
  sourcePaths: report.sourcePaths,
  // 리포트는 초안을 만들지 않는다 — 짧은 답과 같은 칸을 비워 둔다
  action: NO_ACTION,
  report,
})
