import { readGithubToken } from '../server/env.js'
import { createDocPR, parseCreateDocInput } from '../server/github.js'

/**
 * 위키 문서 목록의 "+ 새 문서" — GitHub API로 브랜치를 만들고 PR을 연다.
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로 중계가 쓰인다.
 */

const error = (status: number, message: string) => Response.json({ error: message }, { status })

export async function POST(request: Request): Promise<Response> {
  const token = readGithubToken()
  if (!token) return error(503, 'GITHUB_TOKEN이 설정되지 않았습니다')

  const origin = request.headers.get('origin')
  if (origin && new URL(origin).host !== new URL(request.url).host) return error(403, '허용되지 않은 요청입니다')

  try {
    const input = parseCreateDocInput(await request.json())
    const result = await createDocPR(input, { token })
    return Response.json(result)
  } catch (err) {
    if (err instanceof SyntaxError) return error(400, '요청 형식이 올바르지 않습니다')
    console.error('[api/createDoc]', err)
    return error(502, (err as Error).message)
  }
}
