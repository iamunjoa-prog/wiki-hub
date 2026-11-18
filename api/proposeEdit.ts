import { guardApi, RATE_PR } from '../server/guard.js'
import { readGithubToken } from '../server/env.js'
import { createEditPR, EditError, editErrorBody, parseEditDocInput } from '../server/github.js'
import { MAX_PR_BYTES } from '../server/knowledge.js'

/**
 * 위키 문서의 "✎ 수정 제안" — GitHub API로 브랜치를 만들고 기존 파일을 고쳐 PR을 연다.
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로 중계가 쓰인다.
 */

const error = (status: number, message: string) => Response.json({ error: message }, { status })

export async function POST(request: Request): Promise<Response> {
  // 다른 사이트의 페이지가 이 함수를 불러 GitHub 토큰을 쓰지 못하게 — 출처·형식·크기·로그인·호출 횟수를 입구에서 본다.
  // 로그인한 담당자 모두 제안할 수 있다 — 승인은 PR 머지가 맡는다
  const guard = await guardApi(request, { paid: true, maxBytes: MAX_PR_BYTES, rate: RATE_PR })
  if (!guard.ok) return guard.response

  const token = readGithubToken()
  if (!token)
    return error(
      503,
      'GITHUB_TOKEN이 설정되지 않았습니다. 환경변수를 넣은 뒤 반드시 재배포해야 적용됩니다 — 이미 돌고 있는 배포에는 반영되지 않습니다',
    )

  try {
    const parsed = parseEditDocInput(guard.body)
    // 요청자는 화면이 보낸 이름이 아니라 로그인한 계정의 이름으로 남긴다
    const input = guard.account ? { ...parsed, requestedBy: guard.account.name } : parsed
    return Response.json(await createEditPR(input, { token }))
  } catch (err) {
    // 409 는 최신 버전·본문(mainVersion·mainBody)을 함께 싣는다
    if (err instanceof EditError) return Response.json(editErrorBody(err), { status: err.status })
    console.error('[api/proposeEdit]', err)
    return error(502, (err as Error).message)
  }
}
