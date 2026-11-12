import { readGithubRepo, readGithubToken } from '../server/env.js'
import { guardApi, RATE_DOWNLOAD } from '../server/guard.js'
import { parseHubAccount, proxyHubZip } from '../server/hubZip.js'

/**
 * "로컬 허브 내려받기" — 저장소는 공개라 GitHub 링크로도 받을 수 있지만, 서버가 토큰으로 zipball을 받아 다시 묶어 중계한다.
 * 토큰을 쓰는 이유: 토큰 없는 GitHub API 호출은 IP당 시간당 60회라 사무실 하나가 같은 IP로 받으면 금방 막힌다.
 * 중계하는 이유: 풀면 실행기만 보이게 다시 묶고(server/hubZip.ts) 고른 계정 설정 파일을 넣어야 한다.
 * 로컬 허브에서는 server/cliBridge.ts 가 같은 경로를 처리한다.
 */

export async function GET(request: Request): Promise<Response> {
  // 다른 사이트의 페이지가 이 함수를 불러 토큰을 쓰지 못하게 같은 출처만 받고, 소스와 지식 문서가 든 ZIP이므로
  // 계정 기능이 켜진 배포면 로그인한 담당자만 받는다. 묶는 일이 무거워 분당 횟수를 둔다
  const guard = await guardApi(request, { paid: true, rate: RATE_DOWNLOAD })
  if (!guard.ok) return guard.response

  // 안내 창에서 고른 계정(?account=claude|codex|both)을 ZIP 설정 파일로 넣는다 — 없거나 모르는 값이면 넣지 않는다
  const account = new URL(request.url, 'http://localhost').searchParams.get('account')
  return proxyHubZip(readGithubToken(), readGithubRepo(), parseHubAccount(account))
}
