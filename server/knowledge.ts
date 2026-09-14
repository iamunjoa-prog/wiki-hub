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
