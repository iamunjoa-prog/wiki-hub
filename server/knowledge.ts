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

/** 답변 검증 — claude·codex·gemini 세 엔진의 응답이 모두 이 함수를 지난다. */
export function checkAskReply(out: unknown): CliReply {
  const r = (out ?? {}) as Partial<CliReply>
  if (typeof r.text !== 'string') throw new Error('답변 형식이 올바르지 않습니다')
  return {
    text: balanceBold(unescapeNewlines(r.text).trim()),
    sourcePaths: Array.isArray(r.sourcePaths) ? r.sourcePaths.filter((p): p is string => typeof p === 'string') : [],
  }
}
