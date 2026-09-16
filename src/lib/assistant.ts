import { docs } from '../data/docs'
import type {
  CampaignDraft,
  ChatMessage,
  Engine,
  IntentPrompt,
  ProductScope,
  SourceRef,
  WikiDoc,
} from '../types'
import { extractSentences, searchDocs } from './retrieval'

/** PPC 상품 유형 — 근거 문서를 고르는 1차 기준 */
const PRODUCTS: { keywords: string[]; label: string; scope: 'PPM' | 'PPV'; policyCode: string }[] = [
  { keywords: ['월정액', 'ppm', '구독'], label: 'PPM(월정액)', scope: 'PPM', policyCode: 'PPC-P-02' },
  { keywords: ['단건', 'ppv', 'vod', '개별구매'], label: 'PPV(단건)', scope: 'PPV', policyCode: 'PPC-P-03' },
]

/** 발송 채널 — 캠페인 발송 Capa 기준이 채널별로 다르다 */
const CHANNELS: { keywords: string[]; label: string }[] = [
  { keywords: ['배너', '타겟배너'], label: '타겟배너' },
  { keywords: ['tv팝업', 'tv 팝업', '팝업'], label: 'TV팝업' },
  { keywords: ['스마트알림', '알림', '푸시'], label: '스마트알림' },
  { keywords: ['토스트'], label: '토스트팝업' },
]

/** 프로모션 진행 의도로 볼 명사 — 이 중 하나가 있어야 확인을 띄운다 */
const CAMPAIGN_NOUNS = ['프로모션', '캠페인', '쿠폰', '이벤트', '배너']
/** 앞으로 무언가를 하겠다는 서술 — 사실 질문("품의 결재선은?")과 가르는 기준 */
const PLAN_VERBS = ['기획', '진행', '하고 싶', '하고싶', '하려', '할까', '돌리', '띄우', '만들', '준비', '집행']

let seq = 0
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${seq++}`

/** 어시스턴트 대화 한 턴 — 조건은 여러 턴에 걸쳐 모인다 */
export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

/**
 * 진행 의도로 볼지 판단한다. 명사만으로는 부족하고 **이번 발화에** 계획 서술이 있어야 한다 —
 * "판촉 쿠폰 품의는 누구 결재가 필요해?" 같은 사실 질문에 확인이 끼어들지 않게 한다.
 */
export function detectCampaignIntent(query: string): boolean {
  return CAMPAIGN_NOUNS.some((k) => query.includes(k)) && PLAN_VERBS.some((k) => query.includes(k))
}

export const INTENT_CONFIRM_QUESTION = '혹시 지금 진행하려는 프로모션이 있으신가요? 있으시면 프로모션 어드민 화면으로 바로 열어드리겠습니다.'
export const INTENT_PRODUCT_QUESTION = '월정액(PPM)인가요, 단건(PPV)인가요? 고르시면 그 기준으로 어드민 화면을 엽니다.'

function detectProduct(query: string) {
  const q = query.toLowerCase()
  return PRODUCTS.find((p) => p.keywords.some((k) => q.includes(k))) ?? null
}

function detectChannel(query: string): string | null {
  const q = query.toLowerCase()
  return CHANNELS.find((c) => c.keywords.some((k) => q.includes(k)))?.label ?? null
}

/** "50만", "30만명", "800000명" 같은 표현에서 타겟 모수를 읽는다. 단위(만·천)나 명·건이 있어야 모수로 본다. */
function detectTargetCount(query: string): string | null {
  const m = query.match(/(\d[\d,.]*)\s*(만|천)?\s*(명|건)/) ?? query.match(/(\d[\d,.]*)\s*(만|천)/)
  if (!m) return null
  return `${m[1]}${m[2] ?? ''}${m[3] ?? ''}`
}

/** "3,000원 할인", "50% 할인", "가입쿠폰" 처럼 혜택이 언급됐는지 본다. */
function detectBenefit(query: string): string | null {
  const m = query.match(/(\d[\d,.]*\s*(?:원|%|퍼센트)\s*(?:할인|쿠폰)?)/)
  if (m) return m[1].replace(/\s+/g, ' ').trim()
  const kind = ['가입쿠폰', '해지방어', '약정', '무료체험', '첫달무료'].find((k) => query.includes(k))
  return kind ?? null
}

/** "10월 1일 ~ 10월 14일", "2026-10-01~2026-10-14" 처럼 명시된 기간만 읽는다. */
function detectPeriod(query: string): { start: string; end: string } | null {
  const iso = query.match(/(\d{4}-\d{2}-\d{2})\s*[~\-–]\s*(\d{4}-\d{2}-\d{2})/)
  if (iso) return { start: iso[1], end: iso[2] }

  const year = new Date().getFullYear()
  const pad = (n: string) => n.padStart(2, '0')
  const kr = query.match(/(\d{1,2})월\s*(\d{1,2})일?\s*[~\-–부터]+\s*(?:(\d{1,2})월\s*)?(\d{1,2})일/)
  if (kr) {
    const [, m1, d1, m2, d2] = kr
    return { start: `${year}-${pad(m1)}-${pad(d1)}`, end: `${year}-${pad(m2 ?? m1)}-${pad(d2)}` }
  }
  return null
}

export interface CampaignSlots {
  product: (typeof PRODUCTS)[number] | null
  benefit: string | null
  period: { start: string; end: string } | null
  channel: string | null
  targetCount: string | null
}

/** 사용자 발화만 모아 조건을 읽는다 — 어시스턴트가 되물은 문장("타겟배너로 할까요?")을 답으로 세지 않기 위함이다. */
export function readSlots(turns: ChatTurn[]): CampaignSlots {
  const said = turns
    .filter((t) => t.role === 'user')
    .map((t) => t.text)
    .join('\n')
  return {
    product: detectProduct(said),
    benefit: detectBenefit(said),
    period: detectPeriod(said),
    channel: detectChannel(said),
    targetCount: detectTargetCount(said),
  }
}

/**
 * 어드민 화면으로 넘길 조건을 만든다. 대화에서 확인한 것만 채우고 **나머지는 빈 값으로 둔다** —
 * 기간·채널을 임의로 넣어 보내면 어드민에서 지우는 일이 더 번거롭다.
 */
export function buildCampaignDraft(turns: ChatTurn[], scope?: ProductScope): CampaignDraft {
  const slots = readSlots(turns)
  const product = PRODUCTS.find((p) => p.scope === scope) ?? slots.product
  const channel = slots.channel ?? ''

  const policyRefs = ['PPC-P-01', product?.policyCode, channel && 'PPC-P-04'].filter(
    (c): c is string => Boolean(c) && docs.some((d) => d.code === c),
  )

  return {
    target: [product?.label, channel].filter(Boolean).join(' 대상 · '),
    periodStart: slots.period?.start ?? '',
    periodEnd: slots.period?.end ?? '',
    channel,
    targetCount: slots.targetCount ?? '',
    policyRefs,
    note: [
      slots.benefit && `혜택 ${slots.benefit}`,
      '발송 Capa(배너 일 300만 / 쿠폰 시간당 12만 / TV팝업 노드당 90만)와 일정 중복은 캠페인 스케줄에서 확인 필요',
    ]
      .filter(Boolean)
      .join(' · '),
  }
}

export interface AssistantReply {
  text: string
  sources: SourceRef[]
  /** 진행 의도 확인 — 조건 카드를 먼저 띄우는 대신 진행할 의사인지부터 묻는다 */
  intent?: IntentPrompt
  /** 답을 만든 쪽 — 화면 하단 라벨로 보여준다 */
  answeredBy?: string
}

/** 이번 답변에 진행 확인을 붙일지. 이미 묻거나 답을 들은 대화에는 다시 붙이지 않는다. */
export function intentPromptFor(query: string, alreadyAsked: boolean): IntentPrompt | undefined {
  if (alreadyAsked || !detectCampaignIntent(query)) return undefined
  return { kind: 'confirm', question: INTENT_CONFIRM_QUESTION }
}

export const ENGINE_LABEL: Record<Engine, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' }

/** 자동 선택 순서 — CLI가 있으면 CLI, 없으면 Gemini API */
export const ENGINE_PRIORITY: Engine[] = ['claude', 'codex', 'gemini']

type EngineStatus = import('../types').EngineStatus
type CliEngine = import('../types').CliEngine

/**
 * 서버가 제공하는 엔진별 상태. 로컬 허브는 claude·codex·gemini, 배포 허브는 gemini만 돌려준다.
 * 경로 자체가 없으면 null — 규칙 기반으로만 답한다.
 */
export async function fetchEngines(): Promise<Partial<Record<Engine, EngineStatus>> | null> {
  try {
    const res = await fetch('/api/engines')
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return null
    return (await res.json()) as Partial<Record<Engine, EngineStatus>>
  } catch {
    return null
  }
}

/** 로컬 PC에 CLI 로그인용 터미널 창을 띄워 달라고 요청한다. 창을 못 띄우면 직접 실행할 명령을 돌려준다. */
export async function requestLogin(engine: CliEngine): Promise<{ opened: boolean; command: string } | null> {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ engine }),
    })
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

export function answer(query: string, history: ChatTurn[] = [], intentAsked = false): AssistantReply {
  const turns: ChatTurn[] = [...history, { role: 'user', text: query }]
  const conversation = turns.map((t) => t.text).join('\n')
  const intent = intentPromptFor(query, intentAsked)

  // 진행 의도만 던진 발화에는 정책을 쏟아내지 않는다 — 무엇을 만들지 모르니 어떤 정책이 걸리는지도 아직 알 수 없다.
  if (intent) {
    const slots = readSlots(turns)
    const lead = slots.product
      ? `${slots.product.label} 프로모션이군요.`
      : '프로모션 진행은 상품 유형에 따라 적용 정책이 갈립니다.'
    return { text: lead, sources: [], intent }
  }

  const hits = searchDocs(conversation).slice(0, 3)

  if (hits.length === 0) {
    return {
      text:
        '담당 범위(프로모션 정책·업무, ACS·CBS·Swing 시스템 매뉴얼, 등록된 편성표) 안에서 근거 문서를 찾지 못했습니다.\n' +
        '상품 유형(PPM·PPV)이나 문서 코드(예: PPC-P-02)를 함께 넣어 다시 물어봐 주세요.',
      sources: [],
    }
  }

  const lines: string[] = []
  for (const hit of hits.slice(0, 2)) {
    const sentences = extractSentences(hit.doc, conversation, 2)
    if (sentences.length === 0) continue
    lines.push(`**${hit.doc.title}** (${hit.doc.code})`)
    for (const s of sentences) lines.push(`· ${s}`)
  }

  const sources: SourceRef[] = hits.map((h) => ({
    docId: h.doc.id,
    label: `출처 · ${h.doc.title}`,
  }))

  return { text: lines.join('\n'), sources }
}

async function askEngine(
  query: string,
  engine: Engine,
  history: ChatTurn[],
  intentAsked: boolean,
): Promise<AssistantReply> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, engine, history }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as { text: string; sourcePaths: string[] }

  const sources: SourceRef[] = data.sourcePaths
    .map((p) => docs.find((d) => d.path === p.replace(/\\/g, '/').replace(/^\.?\//, '')))
    .filter((d): d is (typeof docs)[number] => Boolean(d))
    .map((d) => ({ docId: d.id, label: `출처 · ${d.title}` }))

  // 조건 카드 대신 진행 의사부터 확인한다 — 엔진이 무슨 답을 했든 확인 여부는 대화 상태로 정한다.
  return { text: data.text, sources, intent: intentPromptFor(query, intentAsked), answeredBy: ENGINE_LABEL[engine] }
}

/**
 * 쓸 수 있는 엔진을 순서대로 시도한다 — 선택한 CLI가 실패하면 다음 엔진(예: Gemini)으로 넘어간다.
 * 모두 없거나 실패하면 규칙 기반 answer()로 대체해 누구나 쓸 수 있게 한다.
 */
export async function askAssistant(
  query: string,
  engines: Engine[],
  history: ChatTurn[] = [],
  intentAsked = false,
): Promise<AssistantReply> {
  const failed: string[] = []
  for (const engine of engines) {
    try {
      const reply = await askEngine(query, engine, history, intentAsked)
      return failed.length ? { ...reply, answeredBy: `${reply.answeredBy} (${failed.join('·')} 응답 실패)` } : reply
    } catch (err) {
      console.info(`[assistant] ${ENGINE_LABEL[engine]} 응답 실패:`, (err as Error).message)
      failed.push(ENGINE_LABEL[engine])
    }
  }
  return {
    ...answer(query, history, intentAsked),
    answeredBy: failed.length ? `규칙 기반 (${failed.join('·')} 응답 실패)` : '규칙 기반',
  }
}

export interface AiEditResult {
  body: string
  summary: string
  /** 수정한 엔진 — 앞선 엔진이 실패했으면 함께 적는다 */
  by: string
}

/**
 * 수정 제안 화면의 "AI로 수정". 쓸 수 있는 엔진을 순서대로 시도해 고친 본문 전체를 받는다.
 * 규칙 기반 대체는 없다 — 모두 실패하면 마지막 오류를 throw 한다.
 */
export async function requestAiEdit(
  doc: Pick<WikiDoc, 'title' | 'code' | 'path'>,
  body: string,
  instruction: string,
  engines: Engine[],
): Promise<AiEditResult> {
  if (engines.length === 0) throw new Error('쓸 수 있는 AI 엔진이 없습니다')
  const failed: string[] = []
  let lastError = ''
  for (const engine of engines) {
    try {
      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine, title: doc.title, code: doc.code, path: doc.path, body, instruction }),
      })
      const data = (await res.json().catch(() => ({}))) as { body?: string; summary?: string; error?: string }
      if (!res.ok || typeof data.body !== 'string') throw new Error(data.error || `HTTP ${res.status}`)
      const label = ENGINE_LABEL[engine]
      return {
        body: data.body,
        summary: data.summary ?? '',
        by: failed.length ? `${label} (${failed.join('·')} 실패)` : label,
      }
    } catch (err) {
      lastError = (err as Error).message
      console.info(`[ai-edit] ${ENGINE_LABEL[engine]} 실패:`, lastError)
      failed.push(ENGINE_LABEL[engine])
    }
  }
  throw new Error(`AI 수정에 실패했습니다 — ${lastError}`)
}

export function makeMessage(role: ChatMessage['role'], text: string, extra?: Partial<ChatMessage>): ChatMessage {
  return { id: newId('msg'), role, text, ...extra }
}

export const SUGGESTED_QUESTIONS = [
  '월정액 할인 쿠폰 프로모션 배너로 진행 가능해?',
  '판촉용 쿠폰 품의는 누구 결재가 필요해?',
  'CBS에서 승인요청 버튼이 안 눌려',
  '전환동의 팝업은 어느 UI 버전부터 돼?',
]
