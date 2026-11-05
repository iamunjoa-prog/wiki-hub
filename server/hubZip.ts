/**
 * "로컬 허브 내려받기" — private 저장소의 zipball을 서버 토큰으로 받아 그대로 중계한다.
 * 배포(api/download-hub.ts)와 로컬(server/cliBridge.ts)이 함께 쓴다. 토큰은 서버 밖으로 나가지 않는다.
 */

export const HUB_ZIP_FILENAME = 'wiki-hub.zip'

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/

const fail = (status: number, message: string) => Response.json({ error: message }, { status })

function describeGithubFailure(status: number): string {
  const head = `GitHub에서 허브를 받지 못했습니다 (HTTP ${status})`
  if (status === 401) return `${head} — 토큰이 만료됐거나 잘못되었습니다. GITHUB_TOKEN을 확인해 주세요`
  if (status === 403) return `${head} — 토큰 권한이 부족하거나 GitHub 호출 한도를 넘었습니다. 잠시 뒤 다시 시도하거나 토큰 권한(Contents: Read)을 확인해 주세요`
  if (status === 404) return `${head} — 저장소를 찾을 수 없거나 토큰이 이 저장소에 접근할 수 없습니다. GITHUB_REPO와 토큰의 저장소 범위를 확인해 주세요`
  return `${head} — 잠시 뒤 다시 시도해 주세요`
}

/** 기본 브랜치의 zipball을 받아 첨부 파일 응답으로 돌려준다. 본문은 메모리에 모으지 않고 스트림 그대로 넘긴다 */
export async function proxyHubZip(token: string | undefined, repo: string): Promise<Response> {
  if (!token)
    return fail(
      503,
      '서버에 GitHub 토큰이 설정되지 않아 허브를 내려받을 수 없습니다. 관리자에게 환경변수 GITHUB_TOKEN(또는 GH_TOKEN) 설정을 요청해 주세요',
    )
  if (!REPO_PATTERN.test(repo)) return fail(500, `GITHUB_REPO 형식이 올바르지 않습니다 (owner/repo): ${repo}`)

  let upstream: Response
  try {
    // ref를 생략하면 GitHub가 기본 브랜치를 쓴다 (리다이렉트는 fetch가 따라간다)
    upstream = await fetch(`https://api.github.com/repos/${repo}/zipball`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'wiki-hub-download',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
  } catch (err) {
    return fail(502, `GitHub에 연결하지 못했습니다 — ${(err as Error).message}`)
  }
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => {})
    return fail(502, describeGithubFailure(upstream.status))
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/zip',
    // 파일명은 ASCII 고정 — 한글 파일명은 헤더 인코딩 문제를 만든다
    'Content-Disposition': `attachment; filename="${HUB_ZIP_FILENAME}"`,
    'Cache-Control': 'no-store',
  }
  const length = upstream.headers.get('content-length')
  if (length) headers['Content-Length'] = length
  return new Response(upstream.body, { headers })
}
