import { readFileSync } from 'node:fs'
import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import {
  type AskInput,
  buildDocsBlock,
  buildEditRequest,
  checkAskReply,
  checkEditReply,
  EDIT_SCHEMA,
  REPLY_SCHEMA,
  todayLine,
  type CliReply,
  type EditInput,
  type EditReply,
} from './knowledge.js'
import { buildScheduleDigest } from './scheduleDigest.js'

/** GEMINI_MODEL 환경변수로 바꿀 수 있다 */
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-flash'

/**
 * 기본 모델이 재시도 후에도 혼잡·할당량으로 실패할 때 한 번 더 시도하는 모델 — GEMINI_FALLBACK_MODEL 로 바꾸고 `none` 으로 끈다.
 * 3.8 세대 flash-lite 는 SDK 모델 목록에 없어, 목록에 있는 가장 최신 flash-lite 를 쓴다(용량 풀이 달라 혼잡이 겹칠 가능성이 낮다).
 */
export const GEMINI_DEFAULT_FALLBACK_MODEL = 'gemini-3.1-flash-lite'

/** 화면·로그가 같은 분류를 쓰도록 응답 JSON 의 `code` 로 내보낸다 */
export type GeminiErrorCode = 'overloaded' | 'quota' | 'network' | 'timeout' | 'auth' | 'model' | 'invalid' | 'unknown'

// 화면에는 이 짧은 문장만 나간다 — API 원문 JSON 은 console 로그에만 남긴다
const ERROR_TEXT: Record<GeminiErrorCode, string> = {
  overloaded: '모델 서버가 혼잡해 응답하지 못했습니다. 잠시 후 다시 시도해 주세요',
  quota: 'API 사용 한도를 넘었습니다. 잠시 후 다시 시도해 주세요',
  network: '모델 서버와 연결이 끊겼습니다',
  timeout: '제한 시간 안에 응답하지 않았습니다',
  auth: 'API 키가 올바르지 않거나 권한이 없습니다 (GEMINI_API_KEY 확인)',
  model: '모델을 찾을 수 없습니다 (GEMINI_MODEL·GEMINI_FALLBACK_MODEL 확인)',
  invalid: '응답 형식이 올바르지 않습니다',
  unknown: '호출에 실패했습니다',
}

export class GeminiError extends Error {
  readonly code: GeminiErrorCode
  constructor(code: GeminiErrorCode, message: string = ERROR_TEXT[code]) {
    super(message)
    this.name = 'GeminiError'
    this.code = code
  }
}

/** 응답 본문 검증 실패 — 모델은 답했으므로 재시도·예비 모델 대상이 아니다 */
const invalid = (err: unknown) =>
  new GeminiError('invalid', err instanceof SyntaxError ? ERROR_TEXT.invalid : (err as Error).message || ERROR_TEXT.invalid)

interface Classified {
  code: GeminiErrorCode
  /** 같은 모델로 다시 시도하거나 예비 모델로 넘겨 볼 만한 일시 오류인가 */
  transient: boolean
  /** 429 가 알려 준 대기 시간(ms) */
  retryAfterMs?: number
}

const NETWORK_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN', 'ENETUNREACH', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT'])

/** 429 본문의 RetryInfo.retryDelay("37s", "1.5s") 를 ms 로 */
function readRetryDelay(message: string): number | undefined {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(message)
  return m ? Math.round(Number(m[1]) * 1000) : undefined
}

/** SDK 오류를 분류한다 — ApiError 는 status 를, fetch 실패는 cause.code 를 본다 */
export function classifyGeminiError(err: unknown): Classified {
  if (err instanceof GeminiError) return { code: err.code, transient: false }
  const e = err as { status?: unknown; message?: string; name?: string; cause?: { code?: string } }
  const message = e?.message ?? String(err)
  if (typeof e?.status === 'number') {
    const status = e.status
    if (status === 503) return { code: 'overloaded', transient: true }
    if (status === 429) return { code: 'quota', transient: true, retryAfterMs: readRetryDelay(message) }
    if (status === 401 || status === 403) return { code: 'auth', transient: false }
    // 잘못된 키는 400 INVALID_ARGUMENT 로 온다
    if (status === 400 && /API_KEY_INVALID|API key not valid/i.test(message)) return { code: 'auth', transient: false }
    if (status === 404) return { code: 'model', transient: false }
    if (status === 504) return { code: 'timeout', transient: false }
    return { code: 'unknown', transient: false }
  }
  if (e?.name === 'AbortError') return { code: 'timeout', transient: false }
  if ((e?.cause?.code && NETWORK_CODES.has(e.cause.code)) || (err instanceof TypeError && /fetch failed/i.test(message)))
    return { code: 'network', transient: true }
  return { code: 'unknown', transient: false }
}

export interface RetryPolicy {
  /** 같은 모델 재시도 횟수(첫 호출 제외) */
  retries: number
  /** 첫 재시도 대기 — 이후 두 배씩 */
  baseDelayMs: number
  /** 429 retryDelay 를 따를 상한 — 넘으면 기다리지 않고 예비 모델로 */
  maxRetryAfterMs: number
  /** 첫 호출부터 마지막 시도가 끝날 때까지의 상한 — 넘으면 진행 중 호출을 끊는다 */
  budgetMs: number
  /** 남은 시간이 이보다 짧으면 새 시도를 시작하지 않는다(평소 응답 시간 기준) */
  minAttemptMs: number
}

/**
 * 챗봇 답변 — 화면의 Gemini 대기 한도(src/lib/assistant.ts ENGINE_TIMEOUT_MS.gemini = 90초)보다 짧게 끊어,
 * 화면이 먼저 포기하기 전에 서버가 분류된 실패 사유를 돌려주게 한다.
 */
export const ASK_RETRY: RetryPolicy = { retries: 2, baseDelayMs: 1000, maxRetryAfterMs: 5000, budgetMs: 85_000, minAttemptMs: 30_000 }

/** AI로 수정 — 화면 쪽 한도는 없고 배포 함수 한도(vercel.json maxDuration 300초) 안에 끝낸다. 본문 전체를 다시 쓰므로 한 번에 더 오래 걸린다 */
export const EDIT_RETRY: RetryPolicy = { retries: 2, baseDelayMs: 1000, maxRetryAfterMs: 5000, budgetMs: 240_000, minAttemptMs: 60_000 }

/** 검증용으로 바꿔 끼울 수 있게 시계·대기만 따로 둔다 */
export interface RetryClock {
  now(): number
  sleep(ms: number): Promise<void>
  random(): number
}

const realClock: RetryClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  random: Math.random,
}

/** 예비 모델 — 지정이 없으면 기본 예비 모델, `none`·기본 모델과 같으면 쓰지 않는다 */
export function resolveModels(model?: string, fallbackModel?: string): string[] {
  const primary = model || GEMINI_DEFAULT_MODEL
  const fallback = fallbackModel || GEMINI_DEFAULT_FALLBACK_MODEL
  return fallback.toLowerCase() === 'none' || fallback === primary ? [primary] : [primary, fallback]
}

/**
 * Gemini 호출을 감싸 일시 오류(503·429·연결 끊김)만 지수 백오프로 재시도하고, 그래도 안 되면 예비 모델로 한 번 더 시도한다.
 * 400·401·403·404 처럼 다시 해도 같은 오류는 바로 실패시킨다. `run` 안에서 응답 검증까지 해서 예비 모델 응답도 같은 검증을 지나게 한다.
 * SDK 자체 재시도(httpOptions.retryOptions)는 켜지 않는다 — 켜면 이 상한 계산과 겹친다.
 */
export async function callGemini<T>(
  models: string[],
  run: (model: string, signal: AbortSignal) => Promise<T>,
  policy: RetryPolicy,
  clock: RetryClock = realClock,
): Promise<T> {
  const started = clock.now()
  const deadline = started + policy.budgetMs
  const trail: string[] = []
  let last: Classified = { code: 'unknown', transient: false }
  // 검증 실패처럼 서버가 직접 만든 문장은 그대로 살린다
  let lastText = ERROR_TEXT.unknown

  for (const [m, model] of models.entries()) {
    // 예비 모델은 한 번만 — 재시도까지 하면 상한을 넘기기 쉽다
    const tries = m === 0 ? policy.retries + 1 : 1
    let count = 0
    for (let i = 0; i < tries; i++) {
      if (i > 0 || m > 0) {
        // 약 1초·2초 + 0~20% 지터, 429 가 알려 준 대기가 더 길면 그만큼 (예비 모델 첫 시도는 바로)
        const wait = i === 0 ? 0 : Math.max(policy.baseDelayMs * 2 ** (i - 1) * (1 + clock.random() * 0.2), last.retryAfterMs ?? 0)
        if (clock.now() + wait + policy.minAttemptMs > deadline) break
        if (wait) await clock.sleep(wait)
      }
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), Math.max(0, deadline - clock.now()))
      count++
      try {
        const result = await run(model, ctrl.signal)
        const before = count > 1 ? [...trail, `${model} ${last.code}${count > 2 ? ` ${count - 1}회` : ''}`] : trail
        if (before.length) console.log(`[gemini] ${model} 성공 (앞선 실패: ${before.join(' · ')})`)
        return result
      } catch (err) {
        last = ctrl.signal.aborted ? { code: 'timeout', transient: false } : classifyGeminiError(err)
        lastText = err instanceof GeminiError ? err.message : ERROR_TEXT[last.code]
        // 원문(API 오류 JSON 포함)은 서버 로그에만 남긴다
        console.warn(`[gemini] ${model} 시도 ${count} 실패 (${last.code}) — ${(err as Error)?.message ?? String(err)}`)
        if (!last.transient) break
        // 할당량이 오래 막혔다면 같은 모델로 기다리지 않고 예비 모델로 넘긴다
        if (last.retryAfterMs !== undefined && last.retryAfterMs > policy.maxRetryAfterMs) break
      } finally {
        clearTimeout(timer)
      }
    }
    if (count) trail.push(`${model} ${last.code}${count > 1 ? ` ${count}회` : ''}`)
    if (!last.transient) break
  }

  const tried = models.slice(0, trail.length).join(' → ') || models[0]
  const seconds = ((clock.now() - started) / 1000).toFixed(0)
  throw new GeminiError(last.code, `${lastText} — 모델 ${tried}, ${seconds}초`)
}

/** 화면이 받는 실패 응답 — 기존처럼 `error` 문자열을 주고, Gemini 오류면 분류 코드를 함께 준다 */
export function geminiErrorBody(err: unknown): { error: string; code?: GeminiErrorCode } {
  const message = (err as Error)?.message || String(err)
  return err instanceof GeminiError ? { error: message, code: err.code } : { error: message }
}

export interface GeminiOptions {
  apiKey: string
  model?: string
  /** 예비 모델 — 비우면 GEMINI_DEFAULT_FALLBACK_MODEL, `none` 이면 끈다 */
  fallbackModel?: string
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
    '편성표(Today B tv·모바일 빅배너) 데이터는 아래 <schedule>에 들어 있다.',
    todayLine(),
    `<schedule>\n${buildScheduleDigest()}\n</schedule>`,
  ].join('\n\n')

  return callGemini(
    resolveModels(opts.model, opts.fallbackModel),
    async (model, abortSignal) => {
      const started = Date.now()
      const response = await ai.models.generateContent({
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
          abortSignal,
        },
      })

      // 지연의 원인이 입력(prefill)·추론(thinking)·출력 중 어디인지 알 수 있게 토큰 수를 남긴다 — 로깅만 하고 동작은 바꾸지 않는다.
      const u = response.usageMetadata
      console.log(
        `[gemini] ${model} ${((Date.now() - started) / 1000).toFixed(1)}s · prompt=${u?.promptTokenCount ?? '?'} ` +
          `thoughts=${u?.thoughtsTokenCount ?? '?'} output=${u?.candidatesTokenCount ?? '?'} cached=${u?.cachedContentTokenCount ?? 0}`,
      )

      if (!response.text) throw new GeminiError('invalid', 'Gemini가 빈 응답을 반환했습니다')
      try {
        return checkAskReply(JSON.parse(response.text))
      } catch (err) {
        throw invalid(err)
      }
    },
    ASK_RETRY,
  )
}

/** 수정 제안 화면의 "AI로 수정" — 문서 본문과 요청만 넣고 고친 본문 전체를 { body, summary } 로 받는다 */
export async function editGemini(
  input: EditInput,
  opts: Pick<GeminiOptions, 'apiKey' | 'model' | 'fallbackModel' | 'promptFile'>,
): Promise<EditReply> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey })
  return callGemini(
    resolveModels(opts.model, opts.fallbackModel),
    async (model, abortSignal) => {
      const response = await ai.models.generateContent({
        model,
        contents: buildEditRequest(input),
        config: {
          systemInstruction: readFileSync(opts.promptFile, 'utf8'),
          responseMimeType: 'application/json',
          responseJsonSchema: EDIT_SCHEMA,
          abortSignal,
        },
      })
      if (!response.text) throw new GeminiError('invalid', 'Gemini가 빈 응답을 반환했습니다')
      try {
        return checkEditReply(JSON.parse(response.text))
      } catch (err) {
        throw invalid(err)
      }
    },
    EDIT_RETRY,
  )
}
