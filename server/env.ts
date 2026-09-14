/** Gemini API 키를 찾을 환경변수 이름들 — 표준 이름을 먼저 보고, Vercel에 이미 저장된 이름(Gemini_API)도 받는다 */
const GEMINI_KEY_NAMES = ['GEMINI_API_KEY', 'Gemini_API']

export function readGeminiKey(env: Record<string, string | undefined> = process.env): string | undefined {
  for (const name of GEMINI_KEY_NAMES) {
    const value = env[name]?.trim()
    if (value) return value
  }
  return undefined
}
