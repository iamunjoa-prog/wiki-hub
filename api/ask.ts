import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { requireUser } from '../server/auth.js'
import { readGeminiFallbackModel, readGeminiKey, readGeminiModel } from '../server/env.js'
import { askGemini, geminiErrorBody } from '../server/gemini.js'
import { buildDocsBlock, parseAskInput, type AskInput } from '../server/knowledge.js'

/**
 * 배포 허브(Vercel)의 챗봇 답변 — CLI가 없으므로 Gemini API로 답한다.
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로 중계가 쓰인다.
 */

const ROOT = process.cwd()

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

  // 계정 기능이 켜진 배포면 로그인한 담당자만 쓴다
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response

  let input: AskInput
  try {
    input = parseAskInput(await request.json())
  } catch (err) {
    return error(400, (err as Error).message || '요청 형식이 올바르지 않습니다')
  }

  // 문서·프롬프트가 배포 번들에 빠지면 Gemini 호출이 파일 없음으로 죽는다. 그때 "응답 실패"가
  // 아니라 무엇이 빠졌는지 알려 준다 → vercel.json 의 includeFiles 설정 문제다.
  if (!existsSync(PROMPT_FILE))
    return error(500, '배포에 server/assistant-prompt.md 가 없습니다 — vercel.json 의 includeFiles를 확인해 주세요')
  if (!existsSync(KNOWLEDGE_DIR))
    return error(500, '배포에 지식 문서 폴더가 없습니다 — vercel.json 의 includeFiles를 확인해 주세요')

  try {
    const reply = await askGemini(input, {
      apiKey,
      model: readGeminiModel(),
      fallbackModel: readGeminiFallbackModel(),
      knowledgeDir: KNOWLEDGE_DIR,
      promptFile: PROMPT_FILE,
    })
    return Response.json(reply)
  } catch (err) {
    console.error('[api/ask] gemini', err)
    // 원문 API 오류는 위 로그와 server/gemini.ts 로그에만 — 화면에는 분류된 문장과 code 를 준다
    return Response.json(geminiErrorBody(err), { status: 502 })
  }
}
