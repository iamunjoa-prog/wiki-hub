/** Gemini API 키를 찾을 환경변수 이름들 — 표준 이름을 먼저 보고, Vercel에 이미 저장된 이름(Gemini_API)도 받는다 */
const GEMINI_KEY_NAMES = ['GEMINI_API_KEY', 'Gemini_API']

export function readGeminiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  for (const name of GEMINI_KEY_NAMES) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}

/** "새 문서" 기능이 브랜치·PR을 만들 때 쓰는 GitHub 토큰 — repo contents·pull-requests 쓰기 권한 필요 */
const GITHUB_TOKEN_NAMES = ['GITHUB_TOKEN', 'GH_TOKEN']

export function readGithubToken(env: Record<string, string | undefined> = process.env): string | undefined {
  for (const name of GITHUB_TOKEN_NAMES) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}

/** 새 문서 PR을 올릴 저장소 — 비워 두면 이 허브 저장소를 그대로 쓴다 */
export function readGithubRepo(env: Record<string, string | undefined> = process.env): string {
  return env.GITHUB_REPO?.trim() || 'iamunjoa-prog/wiki-hub'
}
