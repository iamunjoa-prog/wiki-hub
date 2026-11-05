import { readFileSync } from 'node:fs'
import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import {
  type AskInput,
  buildDocsBlock,
  buildEditRequest,
  checkEditReply,
  EDIT_SCHEMA,
  REPLY_SCHEMA,
  type CliReply,
  type EditInput,
  type EditReply,
} from './knowledge.js'

/** GEMINI_MODEL 환경변수로 바꿀 수 있다 */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash'

/**
 * Gemini 호출을 감싸 **어느 모델로 무엇이 실패했는지** 남긴다.
 * 404는 모델명(`GEMINI_MODEL` 환경변수 포함), 401·403은 키, 429는 할당량 문제다 —
 * 모델명을 안 적어 두면 화면에서 이 셋을 구분할 수 없다.
 */
async function callGemini<T>(model: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    const message = (err as Error).message || String(err)
    throw new Error(`모델 ${model} 호출 실패 — ${message}`)
  }
}

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
export async function askGemini(input: AskInput, opts: GeminiOptions): Promise<CliReply> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey })
  const systemInstruction = [
    readFileSync(opts.promptFile, 'utf8'),
    '위키 문서 전체가 아래 <documents>에 들어 있다. 이 문서만 읽고 답하라.',
    `<documents>\n${buildDocsBlock(opts.knowledgeDir)}\n</documents>`,
  ].join('\n\n')

  const model = opts.model || GEMINI_DEFAULT_MODEL
  const started = Date.now()
  const response = await callGemini(model, () =>
    ai.models.generateContent({
      model,
      // 기획 상담은 여러 턴에 걸쳐 조건을 모으므로 이력을 그대로 넘긴다
      contents: [
        ...input.history.map((t) => ({ role: t.role === 'user' ? 'user' : 'model', parts: [{ text: t.text }] })),
        { role: 'user', parts: [{ text: input.query }] },
      ],
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseJsonSchema: REPLY_SCHEMA,
        // 위키 전체를 systemInstruction 으로 넣는 호출이라 기본 thinking(medium)으로는
        // 함수 제한 시간을 넘겨 504가 났다. 이 일은 문서에 적힌 것을 찾아 옮기는 작업이고
        // 추론 깊이가 답을 좌우하지 않으므로 지연을 줄이는 쪽을 택한다.
        // (3.8 Flash 는 MINIMAL 을 받지 않는다 — LOW 가 가장 낮은 값이다.)
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
      },
    }),
  )

  // 지연의 원인이 입력(prefill)·추론(thinking)·출력 중 어디인지 알 수 있게 토큰 수를 남긴다 — 로깅만 하고 동작은 바꾸지 않는다.
  const u = response.usageMetadata
  console.log(
    `[gemini] ${model} ${((Date.now() - started) / 1000).toFixed(1)}s · prompt=${u?.promptTokenCount ?? '?'} ` +
      `thoughts=${u?.thoughtsTokenCount ?? '?'} output=${u?.candidatesTokenCount ?? '?'} cached=${u?.cachedContentTokenCount ?? 0}`,
  )

  if (!response.text) throw new Error('Gemini가 빈 응답을 반환했습니다')
  const out = JSON.parse(response.text) as Partial<CliReply>
  if (typeof out.text !== 'string') throw new Error('Gemini 응답 형식이 올바르지 않습니다')
  return { text: out.text, sourcePaths: Array.isArray(out.sourcePaths) ? out.sourcePaths : [] }
}

/** 수정 제안 화면의 "AI로 수정" — 문서 본문과 요청만 넣고 고친 본문 전체를 { body, summary } 로 받는다 */
export async function editGemini(
  input: EditInput,
  opts: Pick<GeminiOptions, 'apiKey' | 'model' | 'promptFile'>,
): Promise<EditReply> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey })
  const response = await ai.models.generateContent({
    model: opts.model || GEMINI_DEFAULT_MODEL,
    contents: buildEditRequest(input),
    config: {
      systemInstruction: readFileSync(opts.promptFile, 'utf8'),
      responseMimeType: 'application/json',
      responseJsonSchema: EDIT_SCHEMA,
    },
  })
  if (!response.text) throw new Error('Gemini가 빈 응답을 반환했습니다')
  return checkEditReply(JSON.parse(response.text))
}
