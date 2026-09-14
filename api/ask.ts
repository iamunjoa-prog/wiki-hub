import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { readGeminiKey } from '../server/env.js'
import { askGemini } from '../server/gemini.js'
import { buildDocsBlock } from '../server/knowledge.js'

/**
 * 배포 허브(Vercel)의 챗봇 답변 — CLI가 없으므로 Gemini API로 답한다.
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로 중계가 쓰인다.
 */

const ROOT = process.cwd()
const MAX_QUERY = 2000

const KNOWLEDGE_DIR = join(ROOT, '지식')
const PROMPT_FILE = join(ROOT, 'server', 'assistant-prompt.md')

const error = (status: number, message: string) => Response.json({ error: message }, { status })

/** 점검용 — 배포 번들에 위키 문서·프롬프트가 들어갔는지와 키 설정 여부만 알려준다 (키 값은 노출하지 않음) */
export function GET(): Response {
  let docsBytes = 0
  try {
    docsBytes = buildDocsBlock(KNOWLEDGE_DIR).length
  } catch {
    docsBytes = 0
  }
  return Response.json({ docsBytes, promptFound: existsSync(PROMPT_FILE), geminiKey: Boolean(readGeminiKey()) })
}

export async function POST(request: Request): Promise<Response> {
  const apiKey = readGeminiKey()
  if (!apiKey) return error(503, 'GEMINI_API_KEY가 설정되지 않았습니다')

  // 다른 사이트의 페이지가 이 함수를 불러 API 키를 쓰지 못하게, 브라우저 요청은 같은 출처만 받는다
  const origin = request.headers.get('origin')
  if (origin && new URL(origin).host !== new URL(request.url).host) return error(403, '허용되지 않은 요청입니다')

  let query = ''
  try {
    const body = (await request.json()) as { query?: unknown }
    query = String(body.query ?? '').trim()
  } catch {
    return error(400, '요청 형식이 올바르지 않습니다')
  }
  if (!query) return error(400, '질문이 비어 있습니다')
  if (query.length > MAX_QUERY) return error(400, `질문은 ${MAX_QUERY}자 이내로 입력해 주세요`)

  try {
    const reply = await askGemini(query, {
      apiKey,
      model: process.env.GEMINI_MODEL,
      knowledgeDir: KNOWLEDGE_DIR,
      promptFile: PROMPT_FILE,
    })
    return Response.json(reply)
  } catch (err) {
    console.error('[api/ask] gemini', err)
    return error(502, (err as Error).message)
  }
}
