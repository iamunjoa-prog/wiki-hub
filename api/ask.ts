import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { guardApi, RATE_ASK } from '../server/guard.js'
import { readGeminiFallbackModel, readGeminiKey, readGeminiModel } from '../server/env.js'
import { recordChatTurn, type ChatTurnOutcome } from '../server/chatLog.js'
import { askGemini, geminiErrorBody } from '../server/gemini.js'
import {
  buildDocsBlock,
  detectReportIntent,
  MAX_ASK_BYTES,
  parseAskInput,
  qaResponse,
  reportUnavailable,
  type AskInput,
  type ReportIntent,
} from '../server/knowledge.js'

/**
 * 배포 허브(Vercel)의 챗봇 답변 — CLI가 없으므로 Gemini API로 답한다.
 * 로컬 허브에서는 이 파일 대신 server/cliBridge.ts 의 같은 경로 중계가 쓰인다.
 */

const ROOT = process.cwd()

const KNOWLEDGE_DIR = join(ROOT, '지식')
const PROMPT_FILE = join(ROOT, 'server', 'assistant-prompt.md')

const error = (status: number, message: string) => Response.json({ error: message }, { status })

/** 점검용 — 배포 번들에 위키 문서·프롬프트가 들어갔는지와 키 설정 여부만 알려준다 (키 값은 노출하지 않음) */
export function GET(): Response {
  let docsBytes = 0
  try {
    docsBytes = buildDocsBlock(KNOWLEDGE_DIR).length
  } catch {
    docsBytes = 0
  }
  return Response.json({ docsBytes, promptFound: existsSync(PROMPT_FILE), geminiKey: Boolean(readGeminiKey()) })
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now()
  // 다른 사이트의 페이지가 이 함수를 불러 API 키를 쓰지 못하게 — 출처·형식·크기·로그인·호출 횟수를 입구에서 본다
  const guard = await guardApi(request, { paid: true, maxBytes: MAX_ASK_BYTES, rate: RATE_ASK })
  if (!guard.ok) return guard.response

  /**
   * 대화 기록 — 응답을 만든 뒤 저장을 최대 1초 기다리고 돌려준다(D6, Vercel 은 응답 뒤 함수를 멈출 수 있다).
   * 저장 실패는 응답에 드러나지 않는다. 계정 기능이 꺼진 데모 배포면 누가 물었는지 몰라 저장하지 않는다
   */
  const logged = async (response: Response, input: AskInput, intent: ReportIntent['mode'], outcome: ChatTurnOutcome) => {
    await recordChatTurn({
      where: 'deploy',
      loginId: guard.account?.loginId ?? null,
      input,
      intent,
      engine: 'gemini',
      model: null,
      startedAt,
      outcome,
    })
    return response
  }

  const apiKey = readGeminiKey()
  if (!apiKey) {
    const response = error(503, 'GEMINI_API_KEY가 설정되지 않았습니다')
    const input = tryParseAskInput(guard.body)
    if (!input) return response
    const intent = detectReportIntent(input.query, input.history, input.modeOverride).mode
    return logged(response, input, intent, { status: 'fail', errorCode: 'config', mode: intent === 'report' ? 'report' : 'qa' })
  }

  let input: AskInput
  try {
    input = parseAskInput(guard.body)
  } catch (err) {
    return error(400, (err as Error).message || '요청 형식이 올바르지 않습니다')
  }

  // 리포트는 로컬 허브 CLI 에서만 만든다 — 로컬 중계와 같은 판정으로, 리포트성 질문이면 Gemini 를 부르지 않고 안내한다
  const intent = detectReportIntent(input.query, input.history, input.modeOverride)
  if (intent.mode === 'report') {
    console.info('[api/ask] 리포트성 질문 — Gemini 를 부르지 않고 로컬 허브 안내로 답함')
    const body = reportUnavailable()
    return logged(Response.json(body), input, intent.mode, { status: 'ok', response: body })
  }

  // 문서·프롬프트가 배포 번들에 빠지면 Gemini 호출이 파일 없음으로 죽는다. 그때 "응답 실패"가
  // 아니라 무엇이 빠졌는지 알려 준다 → vercel.json 의 includeFiles 설정 문제다.
  const missing = !existsSync(PROMPT_FILE)
    ? '배포에 server/assistant-prompt.md 가 없습니다 — vercel.json 의 includeFiles를 확인해 주세요'
    : !existsSync(KNOWLEDGE_DIR)
      ? '배포에 지식 문서 폴더가 없습니다 — vercel.json 의 includeFiles를 확인해 주세요'
      : null
  if (missing) return logged(error(500, missing), input, intent.mode, { status: 'fail', errorCode: 'config', mode: 'qa' })

  try {
    const reply = await askGemini(input, {
      apiKey,
      model: readGeminiModel(),
      fallbackModel: readGeminiFallbackModel(),
      knowledgeDir: KNOWLEDGE_DIR,
      promptFile: PROMPT_FILE,
    })
    // 판단 요청(중간 지대)이면 짧은 답에 로컬 허브 안내 한 줄(notice)을 붙인다
    const body = qaResponse(reply, intent, false)
    return logged(Response.json(body), input, intent.mode, { status: 'ok', response: body })
  } catch (err) {
    console.error('[api/ask] gemini', err)
    // 원문 API 오류는 위 로그와 server/gemini.ts 로그에만 — 화면에는 분류된 문장과 code 를 준다
    const body = geminiErrorBody(err)
    return logged(Response.json(body, { status: 502 }), input, intent.mode, {
      status: 'fail',
      errorCode: body.code ?? 'unknown',
      mode: 'qa',
    })
  }
}

/** 키 없음(503)도 기록하려고 본문을 한 번 읽어 본다 — 형식이 틀리면 기록하지 않고 응답은 지금처럼 503 이다 */
function tryParseAskInput(body: unknown): AskInput | null {
  try {
    return parseAskInput(body)
  } catch {
    return null
  }
}
