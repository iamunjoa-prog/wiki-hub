import { requireUser } from '../server/auth.js'
import { readGithubToken } from '../server/env.js'
import { createEditPR, EditError, parseEditDocInput } from '../server/github.js'

/**
 * 위키 문서의 "✎ 수정 제안" — GitHub API로 브랜치를 만들고 기존 파일을 고쳐 PR을 연다.
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로 중계가 쓰인다.
 */

const error = (status: number, message: string) => Response.json({ error: message }, { status })

export async function POST(request: Request): Promise<Response> {
  const token = readGithubToken()
  if (!token)
    return error(
      503,
      'GITHUB_TOKEN이 설정되지 않았습니다. 환경변수를 넣은 뒤 반드시 재배포해야 적용됩니다 — 이미 돌고 있는 배포에는 반영되지 않습니다',
    )

  const origin = request.headers.get('origin')
  if (origin && new URL(origin).host !== new URL(request.url).host) return error(403, '허용되지 않은 요청입니다')

  // 로그인한 담당자 모두 제안할 수 있다 — 승인은 PR 머지가 맡는다
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response

  try {
    const parsed = parseEditDocInput(await request.json())
    // 요청자는 화면이 보낸 이름이 아니라 로그인한 계정의 이름으로 남긴다
    const input = auth.account ? { ...parsed, requestedBy: auth.account.name } : parsed
    return Response.json(await createEditPR(input, { token }))
  } catch (err) {
    if (err instanceof SyntaxError) return error(400, '요청 형식이 올바르지 않습니다')
    if (err instanceof EditError) return error(err.status, err.message)
    console.error('[api/proposeEdit]', err)
    return error(502, (err as Error).message)
  }
}
