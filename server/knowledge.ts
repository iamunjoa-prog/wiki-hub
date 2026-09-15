import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'

/** 로컬 CLI 중계(vite 플러그인)와 배포 함수(api/)가 함께 쓰는 답변 형식·문서 묶음 */

export interface CliReply {
  text: string
  sourcePaths: string[]
}

// OpenAI·Gemini 구조화 출력 모두 받아들이는 형태: additionalProperties:false 와 전체 required
export const REPLY_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string' },
    sourcePaths: { type: 'array', items: { type: 'string' } },
  },
  required: ['text', 'sourcePaths'],
  additionalProperties: false,
}

/** 어시스턴트 대화 한 턴 — 기획 상담은 여러 턴에 걸쳐 조건을 모으므로 이력이 필요하다 */
export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface AskInput {
  query: string
  history: ChatTurn[]
}

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
    chars += text.length
    if (chars > MAX_HISTORY_CHARS) break
    history.unshift({ role, text })
  }
  return { query, history }
}

/** 이력을 프롬프트 한 덩어리로 편다 — 멀티턴 입력을 받지 않는 CLI 엔진용 */
export function buildAskRequest({ query, history }: AskInput): string {
  if (history.length === 0) return `## 질문\n\n${query}`
  const transcript = history.map((t) => `${t.role === 'user' ? '사용자' : '어시스턴트'}: ${t.text}`).join('\n\n')
  return [
    '## 지금까지의 대화',
    '이미 답을 들은 항목은 다시 묻지 말고, 아직 비어 있는 조건만 이어서 물어라.',
    transcript,
    `## 이번 질문\n\n${query}`,
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
