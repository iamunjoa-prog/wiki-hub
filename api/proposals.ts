import { readGithubToken } from '../server/env.js'
import { guardApi } from '../server/guard.js'
import { listProposalPrs } from '../server/github.js'

/**
 * 문서 제안 목록 — 진실의 원천은 GitHub PR 이다. 허브가 따로 저장하지 않으니
 * 관리자가 GitHub 에서 직접 머지해도 이 목록은 사실과 어긋나지 않는다.
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로 중계가 쓰인다.
 */

const error = (status: number, message: string) => Response.json({ error: message }, { status })

export async function GET(request: Request): Promise<Response> {
  // 읽기지만 GitHub 토큰을 쓴다 — 운영에서 계정 기능이 꺼지면 닫고, 다른 사이트가 부르지 못하게 한다
  const guard = await guardApi(request, { paid: true })
  if (!guard.ok) return guard.response

  const token = readGithubToken()
  if (!token) return error(503, 'GITHUB_TOKEN이 설정되지 않아 제안 목록을 읽을 수 없습니다')

  try {
    return Response.json({ proposals: await listProposalPrs({ token }) })
  } catch (err) {
    console.error('[api/proposals]', err)
    return error(502, (err as Error).message)
  }
}
