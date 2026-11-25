import { readGithubToken } from '../server/env.js'
import { guardApi, RATE_DOC_VERSION } from '../server/guard.js'
import { docVersionReply } from '../server/github.js'

/**
 * 편집 진입 때 main 의 최신 버전·본문 — 화면 번들이 머지 뒤 재배포 전이라 낡았어도 제출 409 를 미리 막는다.
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로 중계가 쓰인다.
 */

export async function GET(request: Request): Promise<Response> {
  // 읽기지만 GitHub 토큰을 쓴다 — 운영에서 계정 기능이 꺼지면 닫고, 다른 사이트가 부르지 못하게 하고, 횟수를 센다
  const guard = await guardApi(request, { paid: true, rate: RATE_DOC_VERSION })
  if (!guard.ok) return guard.response

  const reply = await docVersionReply(new URL(request.url, 'http://localhost').searchParams.get('path'), {
    token: readGithubToken(),
    onError: (message) => console.error('[api/docVersion]', message),
  })
  return Response.json(reply.body, { status: reply.status, headers: { 'Cache-Control': 'no-store' } })
}
