import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

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
  return { query, history }
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

/** 수정 제안 화면의 "AI로 수정" — 문서 본문과 요청을 받아 고친 본문 전체를 돌려준다 */
export interface EditInput {
  title: string
  code: string
  path: string
  body: string
  instruction: string
}

export interface EditReply {
  body: string
  summary: string
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
  return input
}

export function buildEditRequest(input: EditInput): string {
  return [
    `## 수정할 문서\n\n- 제목: ${input.title}\n- 문서 코드: ${input.code}\n- 경로: ${input.path}`,
    `<document>\n${input.body}\n</document>`,
    `## 수정 요청\n\n${input.instruction}`,
  ].join('\n\n')
}

export function checkEditReply(out: unknown): EditReply {
  const o = (out ?? {}) as Partial<EditReply>
  if (typeof o.body !== 'string' || !o.body.trim()) throw new Error('AI가 수정한 본문을 돌려주지 않았습니다')
  return { body: o.body.replace(/\r\n?/g, '\n'), summary: typeof o.summary === 'string' ? o.summary.trim() : '' }
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

/** 편성표는 날짜(m/d)로 찾으므로, 모델이 "오늘"을 스스로 추측하지 않도록 서버 시각을 박아 준다. */
export function todayLine(): string {
  const n = new Date()
  return `오늘 날짜: ${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')} (${n.getMonth() + 1}/${n.getDate()})`
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
