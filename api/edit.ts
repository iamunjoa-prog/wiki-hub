import { join } from 'node:path'
import { guardApi, RATE_EDIT } from '../server/guard.js'
import { readGeminiFallbackModel, readGeminiKey, readGeminiModel } from '../server/env.js'
import { editGemini, geminiErrorBody } from '../server/gemini.js'
import { MAX_EDIT_BYTES, parseEditInput, type EditInput } from '../server/knowledge.js'

/**
 * 배포 허브(Vercel)의 "AI로 수정" — CLI가 없으므로 Gemini API로 고친다.
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로 중계가 쓰인다.
 */

const PROMPT_FILE = join(process.cwd(), 'server', 'edit-prompt.md')

const error = (status: number, message: string) => Response.json({ error: message }, { status })

export async function POST(request: Request): Promise<Response> {
  // 다른 사이트의 페이지가 이 함수를 불러 API 키를 쓰지 못하게 — 출처·형식·크기·로그인·호출 횟수를 입구에서 본다
  const guard = await guardApi(request, { paid: true, maxBytes: MAX_EDIT_BYTES, rate: RATE_EDIT })
  if (!guard.ok) return guard.response

  const apiKey = readGeminiKey()
  if (!apiKey) return error(503, 'GEMINI_API_KEY가 설정되지 않았습니다')

  let input: EditInput
  try {
    input = parseEditInput(guard.body)
  } catch (err) {
    return error(400, (err as Error).message)
  }

  try {
    return Response.json(
      await editGemini(input, {
        apiKey,
        model: readGeminiModel(),
        fallbackModel: readGeminiFallbackModel(),
        promptFile: PROMPT_FILE,
      }),
    )
  } catch (err) {
    console.error('[api/edit] gemini', err)
    // 원문 API 오류는 로그에만 — 화면에는 분류된 문장과 code 를 준다
    return Response.json(geminiErrorBody(err), { status: 502 })
  }
}
