import { guardApi, RATE_PR } from '../server/guard.js'
import { readGithubToken } from '../server/env.js'
import { createDocPR, EditError, editErrorBody, parseCreateDocInput, PublicLeakError } from '../server/github.js'
import { MAX_PR_BYTES } from '../server/knowledge.js'
import { hitCounts } from '../server/publicCheck.js'

/**
 * 위키 문서 목록의 "+ 새 문서" — GitHub API로 브랜치를 만들고 PR을 연다.
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로 중계가 쓰인다.
 */

const error = (status: number, message: string) => Response.json({ error: message }, { status })

export async function POST(request: Request): Promise<Response> {
  // 다른 사이트의 페이지가 이 함수를 불러 GitHub 토큰을 쓰지 못하게 — 출처·형식·크기·로그인·호출 횟수를 입구에서 본다.
  // 계정 기능이 켜진 배포면 로그인한 담당자만 쓴다
  const guard = await guardApi(request, { paid: true, maxBytes: MAX_PR_BYTES, rate: RATE_PR })
  if (!guard.ok) return guard.response

  const token = readGithubToken()
  if (!token)
    return error(
      503,
      'GITHUB_TOKEN이 설정되지 않았습니다. 환경변수를 넣은 뒤 반드시 재배포해야 적용됩니다 — 이미 돌고 있는 배포에는 반영되지 않습니다',
    )

  try {
    const parsed = parseCreateDocInput(guard.body)
    // 작성자는 화면이 보낸 이름이 아니라 로그인한 계정의 이름으로 남긴다
    const input = guard.account ? { ...parsed, requestedBy: guard.account.name } : parsed
    // 배포본은 공유 드라이브의 이름 목록을 읽을 수 없어 금액·별표 2개만 검사한다(requests-report.md 13절 R-B)
    const result = await createDocPR(input, { token })
    return Response.json(result)
  } catch (err) {
    if (err instanceof PublicLeakError) {
      // 걸린 표기는 로그에 남기지 않는다 — 종류별 건수만
      console.info(`[api/createDoc] 차단 · publicCheck block ${hitCounts(err.blocks)}`)
      return Response.json({ error: err.message, code: err.code, blocks: err.blocks }, { status: 400 })
    }
    // 입력 문제는 400 — 화면이 GitHub 실패와 갈라 "고쳐서 다시 제출"로 안내한다
    if (err instanceof EditError) return Response.json(editErrorBody(err), { status: err.status })
    console.error('[api/createDoc]', err)
    return error(502, (err as Error).message)
  }
}
