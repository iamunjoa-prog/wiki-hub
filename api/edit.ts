import { join } from 'node:path'
import { readGeminiKey } from '../server/env.js'
import { editGemini } from '../server/gemini.js'
import { parseEditInput, type EditInput } from '../server/knowledge.js'

/**
 * 배포 허브(Vercel)의 "AI로 수정" — CLI가 없으므로 Gemini API로 고친다.
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로 중계가 쓰인다.
 */

const PROMPT_FILE = join(process.cwd(), 'server', 'edit-prompt.md')

const error = (status: number, message: string) => Response.json({ error: message }, { status })

export async function POST(request: Request): Promise<Response> {
  const apiKey = readGeminiKey()
  if (!apiKey) return error(503, 'GEMINI_API_KEY가 설정되지 않았습니다')

  // 다른 사이트의 페이지가 이 함수를 불러 API 키를 쓰지 못하게, 브라우저 요청은 같은 출처만 받는다
  const origin = request.headers.get('origin')
  if (origin && new URL(origin).host !== new URL(request.url).host) return error(403, '허용되지 않은 요청입니다')

  let input: EditInput
  try {
    input = parseEditInput(await request.json())
  } catch (err) {
    return error(400, err instanceof SyntaxError ? '요청 형식이 올바르지 않습니다' : (err as Error).message)
  }

  try {
    return Response.json(await editGemini(input, { apiKey, model: process.env.GEMINI_MODEL, promptFile: PROMPT_FILE }))
  } catch (err) {
    console.error('[api/edit] gemini', err)
    return error(502, (err as Error).message)
  }
}
