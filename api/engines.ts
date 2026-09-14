import { readGeminiKey } from '../server/env.js'

/** 배포 허브(Vercel)에서 쓸 수 있는 답변 엔진 — CLI는 없고, API 키가 설정돼 있으면 Gemini만 쓴다 */
export function GET(): Response {
  const gemini = Boolean(readGeminiKey())
  return Response.json({ gemini: { installed: gemini, loggedIn: gemini } })
}
