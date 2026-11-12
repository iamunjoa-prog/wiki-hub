import { requireUser, sameOrigin } from '../server/auth.js'
import { readGithubRepo, readGithubToken } from '../server/env.js'
import { parseHubAccount, proxyHubZip } from '../server/hubZip.js'

/**
 * "로컬 허브 내려받기" — 저장소가 private이라 GitHub 링크는 실무자에게 404다.
 * 서버가 자기 토큰으로 zipball을 받아 그대로 중계한다. 로컬 허브에서는 server/cliBridge.ts 가 같은 경로를 처리한다.
 */

export async function GET(request: Request): Promise<Response> {
  // 다른 사이트의 페이지가 이 함수를 불러 토큰을 쓰지 못하게, 브라우저 요청은 같은 출처만 받는다
  if (!sameOrigin(request)) return Response.json({ error: '허용되지 않은 요청입니다' }, { status: 403 })

  // 소스와 지식 문서가 든 ZIP이므로, 계정 기능이 켜진 배포면 로그인한 담당자만 받는다
  const auth = await requireUser(request)
  if (!auth.ok) return auth.response

  // 안내 창에서 고른 계정(?account=claude|codex|both)을 ZIP 설정 파일로 넣는다 — 없거나 모르는 값이면 넣지 않는다
  const account = new URL(request.url, 'http://localhost').searchParams.get('account')
  return proxyHubZip(readGithubToken(), readGithubRepo(), parseHubAccount(account))
}
