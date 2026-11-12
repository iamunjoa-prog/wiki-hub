import { homedir } from 'node:os'
import { join } from 'node:path'

/** Gemini API 키를 찾을 환경변수 이름들 — 표준 이름을 먼저 보고, Vercel에 이미 저장된 이름(Gemini_API)도 받는다 */
const GEMINI_KEY_NAMES = ['GEMINI_API_KEY', 'Gemini_API']

export function readGeminiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  for (const name of GEMINI_KEY_NAMES) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}

/** 답변·수정에 쓸 Gemini 모델 — 비워 두면 server/gemini.ts 의 기본 모델 */
export function readGeminiModel(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.GEMINI_MODEL?.trim() || undefined
}

/** 기본 모델이 혼잡(503)·할당량(429)으로 끝내 실패할 때 한 번 더 시도할 예비 모델 — 비워 두면 기본 예비 모델, `none` 이면 끈다 */
export function readGeminiFallbackModel(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.GEMINI_FALLBACK_MODEL?.trim() || undefined
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

/** 회사 내부 Jira 주소·프로젝트 키 — 공개 저장소라 코드에 박아 두지 않고 개인별 .env.local에서 읽는다 */
export function readJiraBaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.JIRA_BASE_URL?.trim().replace(/\/+$/, '') || undefined
}

export function readJiraProjectKey(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.JIRA_PROJECT_KEY?.trim() || undefined
}

/**
 * 실행 스크립트(scripts/setup.ps1 · start-hub.command)가 휴대용 허브 실행 준비물(node)과 챗봇 연결 프로그램(tools)을 까는 사용자 폴더.
 * 관리자 권한 없이 쓸 수 있는 자리라 Windows는 LOCALAPPDATA, Mac은 홈 아래 숨김 폴더다
 */
export function readHubHomeDir(env: Record<string, string | undefined> = process.env, platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') return join(env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local'), 'wiki-hub')
  return join(homedir(), '.wiki-hub')
}
