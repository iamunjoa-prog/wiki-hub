import { readFileSync } from 'node:fs'
import { GoogleGenAI } from '@google/genai'
import { buildDocsBlock, REPLY_SCHEMA, type CliReply } from './knowledge.js'

/** GEMINI_MODEL 환경변수로 바꿀 수 있다 */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash'

export interface GeminiOptions {
  apiKey: string
  model?: string
  knowledgeDir: string
  promptFile: string
}

/**
 * CLI가 없는 사용자용 — Gemini API에 위키 문서 전체를 system instruction으로 넣고 { text, sourcePaths } JSON으로 받는다.
 * 호출은 항상 서버(로컬 vite 중계 또는 Vercel 함수)에서 해서 API 키가 브라우저에 노출되지 않게 한다.
 */
export async function askGemini(query: string, opts: GeminiOptions): Promise<CliReply> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey })
  const systemInstruction = [
    readFileSync(opts.promptFile, 'utf8'),
    '위키 문서 전체가 아래 <documents>에 들어 있다. 이 문서만 읽고 답하라.',
    `<documents>\n${buildDocsBlock(opts.knowledgeDir)}\n</documents>`,
  ].join('\n\n')

  const response = await ai.models.generateContent({
    model: opts.model || GEMINI_DEFAULT_MODEL,
    contents: query,
    config: {
      systemInstruction,
      responseMimeType: 'application/json',
      responseJsonSchema: REPLY_SCHEMA,
    },
  })

  if (!response.text) throw new Error('Gemini가 빈 응답을 반환했습니다')
  const out = JSON.parse(response.text) as Partial<CliReply>
  if (typeof out.text !== 'string') throw new Error('Gemini 응답 형식이 올바르지 않습니다')
  return { text: out.text, sourcePaths: Array.isArray(out.sourcePaths) ? out.sourcePaths : [] }
}
