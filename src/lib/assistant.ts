import { docs } from '../data/docs'
import type {
  CampaignDraft,
  ChatMessage,
  Engine,
  IntentPrompt,
  ProductScope,
  PromotionBrief,
  SourceRef,
  WikiDoc,
} from '../types'
import { extractSentences, searchDocs, type SearchInput } from './retrieval'

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

/**
 * 판단·제안을 요청하는 발화. 사실 조회("결재선은?")와 답변 모양이 달라야 한다 —
 * 문장을 나열하는 대신 무엇이 걸리는지부터 짚고, 문서에 없는 영역은 없다고 밝힌다.
 */
const ADVICE_CUES = [
  '방안', '방법', '전략', '효과적', '추천해', '제안해', '좋을까', '괜찮을까',
  '어떻게 하', '어떻게 해', '어떻게 진행', '어떤 게 좋', '어떤걸 좋', '뭐가 좋', '잘하려', '잘 하려',
]

/**
 * 판단 요청으로 볼지. 프로모션 이야기일 때만 본다 — "CBS 승인요청 방법"은
 * 문서에 절차가 그대로 있는 사실 질문이라 판단 요청으로 다루면 안 된다.
 */
function wantsAdvice(query: string): boolean {
  if (!ADVICE_CUES.some((k) => query.includes(k))) return false
  return CAMPAIGN_NOUNS.some((k) => query.includes(k)) || PRODUCTS.some((p) => p.keywords.some((k) => query.toLowerCase().includes(k)))
}

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

/**
 * 혜택 스킴 — `insight/schemes.md`의 PPV 표기를 그대로 쓴다.
 * 쿠폰과 경품을 함께 말했으면 결합으로 본다.
 */
const SCHEMES: { keywords: string[]; label: string }[] = [
  { keywords: ['선발급', '할인쿠폰', '할인 쿠폰', '쿠폰'], label: '할인쿠폰 선발급' },
  { keywords: ['경품', '응모', '추첨', '굿즈', 'b캐시'], label: '구매자 경품' },
]

function detectScheme(text: string): string | null {
  const q = text.toLowerCase()
  const hit = SCHEMES.filter((s) => s.keywords.some((k) => q.includes(k)))
  if (hit.length === 0) return null
  return hit.length > 1 ? '쿠폰 + 경품' : hit[0].label
}

/** 따옴표로 묶었거나 "이벤트명은 ~" 형태로 말한 것만 이벤트명으로 본다. 작품명을 멋대로 만들지 않는다. */
function detectEventName(text: string): string | null {
  const quoted = text.match(/[「『《'"\u201c\u2018]([^」』》'"\u201d\u2019\n]{2,40})[」』》'"\u201d\u2019]/)
  if (quoted) return quoted[1].trim()
  const named = text.match(/(?:이벤트명|프로모션명|행사명)\s*(?:은|는|:)?\s*([^\n,.]{2,40})/)
  return named ? named[1].trim() : null
}

/**
 * 방향을 정했다는 발화. "~로 진행할게", "~로 해야겠다" 처럼 **고른 결과**를 말한 턴에서는
 * 문서를 다시 쏟아내지 않고 정리로 넘어간다.
 */
const DECIDE_CUES = [
  '진행해야겠', '진행할게', '진행하자', '진행하려', '해야겠', '하기로', '할래', '할게', '갈게', '가자',
  '이걸로', '그걸로', '정했', '결정',
]

export function detectDecision(query: string): boolean {
  return DECIDE_CUES.some((k) => query.includes(k))
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
 * 대화에서 모인 프로모션 뼈대를 만든다. 확인한 것만 채우고 **나머지는 빈 값으로 둔다** —
 * 화면에서 '미정'으로 보여 주고, 담당자가 말해 준 값만 채워 나간다.
 */
export function readBrief(turns: ChatTurn[], scope?: ProductScope): PromotionBrief {
  const said = userText(turns)
  const slots = readSlots(turns)
  const product = PRODUCTS.find((p) => p.scope === scope) ?? slots.product
  /**
   * 스킴은 **마지막 발화를 먼저** 본다. 앞에서 쿠폰·경품을 나란히 검토했더라도
   * "선발급으로 할게"라고 고른 순간의 답이 확정값이다.
   */
  const last = [...turns].reverse().find((t) => t.role === 'user')?.text ?? ''
  return {
    product: product?.label ?? '',
    name: detectEventName(said) ?? '',
    period: slots.period ? `${slots.period.start} ~ ${slots.period.end}` : '',
    scheme: detectScheme(last) ?? detectScheme(said) ?? slots.benefit ?? '',
    channel: slots.channel ?? '',
  }
}

/** 뼈대에 아직 비어 있는 칸 — 다음에 무엇을 물을지 정하는 기준 */
export function missingBriefFields(brief: PromotionBrief): string[] {
  return [
    !brief.name && '이벤트명',
    !brief.period && '이벤트 기간',
    !brief.scheme && '이벤트 스킴',
  ].filter((v): v is string => Boolean(v))
}

export const NEXT_STEP_QUESTION =
  '이대로 프로모션 자동화 페이지로 넘겨 드릴까요? 그 전에 카피나 노출 구좌 추천이 필요하면 먼저 골라 주세요.'

/**
 * 방향을 정한 턴에 붙이는 다음 단계 안내. 뼈대를 카드로 보여 주고, 카피·구좌 추천과
 * 프로모션 자동화 연결 중에서 고르게 한다.
 */
export function nextStepPromptFor(query: string, alreadyAsked: boolean): IntentPrompt | undefined {
  if (alreadyAsked || !detectDecision(query)) return undefined
  return { kind: 'next', question: NEXT_STEP_QUESTION }
}

/**
 * 어드민 화면으로 넘길 조건을 만든다. 대화에서 확인한 것만 채우고 **나머지는 빈 값으로 둔다** —
 * 기간·채널을 임의로 넣어 보내면 어드민에서 지우는 일이 더 번거롭다.
 */
export function buildCampaignDraft(turns: ChatTurn[], scope?: ProductScope): CampaignDraft {
  const slots = readSlots(turns)
  const product = PRODUCTS.find((p) => p.scope === scope) ?? slots.product
  const channel = slots.channel ?? ''

  const policyRefs = ['PPC-P-01', product?.policyCode, channel && 'PPC-R-06'].filter(
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
  /** 방향을 정한 턴에 함께 보여 주는 프로모션 뼈대 */
  brief?: PromotionBrief
  /** 답을 만든 쪽 — 화면 하단 라벨로 보여준다 */
  answeredBy?: string
}

/** 이번 답변에 진행 확인을 붙일지. 이미 묻거나 답을 들은 대화에는 다시 붙이지 않는다. */
export function intentPromptFor(query: string, alreadyAsked: boolean): IntentPrompt | undefined {
  // 이미 방향을 고른 발화에는 진행 의사를 되묻지 않는다 — 다음 단계 안내가 그 자리를 대신한다.
  if (alreadyAsked || detectDecision(query) || !detectCampaignIntent(query)) return undefined
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

/** 사용자 발화만 이어 붙인다 — 어시스턴트가 되물은 문장이 다음 검색어로 새지 않게 한다. */
function userText(turns: ChatTurn[]): string {
  return turns
    .filter((t) => t.role === 'user')
    .map((t) => t.text)
    .join('\n')
}

/** 다른 상품 유형 전용 표현 — PPV 답변에 PPM 정책 문장이 섞이는 것을 막는다 */
const SCOPE_ONLY_TERMS: Record<ProductScope, string[]> = {
  PPM: ['전환동의', '자동 해지', '약정', '월정액', '첫달 무료', 'ppm'],
  PPV: ['단건', 'ppv'],
}

/**
 * 인용해도 되는 문장만 남긴다. 상품 유형을 밝혔으면 **반대 상품 전용 문장**을 빼고,
 * `(보완 필요)` 처럼 위키가 비어 있다고 표시해 둔 줄은 근거로 쓰지 않는다.
 */
function usableSentences(doc: WikiDoc, search: SearchInput, limit: number): string[] {
  const other = search.scope === 'PPV' ? SCOPE_ONLY_TERMS.PPM : search.scope === 'PPM' ? SCOPE_ONLY_TERMS.PPV : []
  return extractSentences(doc, search, limit + 3)
    .filter((line) => !line.includes('(보완 필요)'))
    .filter((line) => {
      const lower = line.toLowerCase()
      if (!other.length) return true
      const mine = (SCOPE_ONLY_TERMS[search.scope as ProductScope] ?? []).some((t) => lower.includes(t))
      return mine || !other.some((t) => lower.includes(t))
    })
    .slice(0, limit)
}

export function answer(query: string, history: ChatTurn[] = [], intentAsked = false): AssistantReply {
  const turns: ChatTurn[] = [...history, { role: 'user', text: query }]
  const intent = intentPromptFor(query, intentAsked)

  // 진행 의도만 던진 발화에는 정책을 쏟아내지 않는다 — 무엇을 만들지 모르니 어떤 정책이 걸리는지도 아직 알 수 없다.
  if (intent) {
    const slots = readSlots(turns)
    const lead = slots.product
      ? `${slots.product.label} 프로모션이군요.`
      : '프로모션 진행은 상품 유형에 따라 적용 정책이 갈립니다.'
    return { text: lead, sources: [], intent }
  }

  // 방향을 정한 턴에는 문서를 다시 쏟아내지 않는다 — 사용자는 읽을 것이 아니라 다음 단계를 기다린다.
  if (detectDecision(query)) {
    const brief = readBrief(turns)
    const missing = missingBriefFields(brief)
    return {
      text: missing.length
        ? `정리했습니다. ${missing.join(' · ')}만 알려 주시면 그대로 넘길 수 있습니다.`
        : '정리했습니다. 이대로 넘기면 됩니다.',
      sources: [],
      brief,
    }
  }

  const slots = readSlots(turns)
  /**
   * 이번 발화를 가장 무겁게 보고, 앞선 **사용자** 발화만 보조 맥락으로 쓴다.
   * 대화 전체를 한 덩어리로 검색하면 어시스턴트가 되물은 "월정액(PPM)인가요?" 때문에
   * PPV 질문에 PPM 정책이 근거로 올라온다.
   */
  const advice = wantsAdvice(query)
  const search: SearchInput = {
    query,
    context: userText(history),
    scope: slots.product?.scope ?? null,
    // 판단을 물으면 정책 문서보다 마케팅 인사이트·카피 가이드(타겟팅·플레이북·카피 등)가 답에 가깝다
    preferSubcategory: advice ? ['insight', 'copy-guide'] : null,
  }
  const hits = searchDocs(search).slice(0, 3)

  if (hits.length === 0) {
    return {
      text:
        '담당 범위(프로모션 정책·노출·인사이트, ACS·CBS·Swing 시스템 매뉴얼, 등록된 편성표) 안에서 근거 문서를 찾지 못했습니다.\n' +
        '상품 유형(PPM·PPV)이나 문서 코드(예: PPC-P-02)를 함께 넣어 다시 물어봐 주세요.',
      sources: [],
    }
  }

  // 결론부터 한 줄 — 무엇을 기준으로 답했는지 먼저 밝힌다.
  const lines: string[] = []
  if (slots.product) {
    lines.push(
      advice
        ? `${slots.product.label} 기준으로, 위키에 적힌 제약부터 짚어 드립니다.`
        : `${slots.product.label} 기준입니다.`,
    )
  }

  // 실제로 문장을 뽑아낸 문서만 근거로 남긴다 — 본문에 인용하지 않은 문서를 출처로 붙이지 않는다.
  const used: typeof hits = []
  for (const hit of hits.slice(0, 2)) {
    const sentences = usableSentences(hit.doc, search, 2)
    if (sentences.length === 0) continue
    used.push(hit)
    lines.push(`**${hit.doc.title}** (${hit.doc.code})`)
    for (const s of sentences) lines.push(`· ${s}`)
  }

  if (used.length === 0) {
    return {
      text:
        '관련 문서는 찾았지만 질문에 바로 맞는 문장을 뽑지 못했습니다.\n' +
        `문서 코드(${hits.map((h) => h.doc.code).join(' · ')})로 다시 물어보시거나 문서를 직접 열어 확인해 주세요.`,
      sources: hits.map((h) => ({ docId: h.doc.id, label: `출처 · ${h.doc.title}` })),
    }
  }

  // 판단 질문에는 인용한 근거 외에 더 볼 문서를 한 줄로 짚어 준다.
  if (advice) {
    const more = hits
      .slice(0, 3)
      .filter((h) => ['insight', 'copy-guide'].includes(h.doc.subcategory ?? '') && !used.includes(h))
      .map((h) => `${h.doc.title}(${h.doc.code})`)
    lines.push(
      more.length
        ? `구좌 구성과 카피 방향은 ${more.join(' · ')}에 더 정리되어 있습니다.`
        : '구좌 구성·카피 방향·과거 실적은 프로모션 > 마케팅 인사이트 · 카피 가이드 메뉴에서 더 볼 수 있습니다.',
    )
  }

  const sources: SourceRef[] = used.map((h) => ({
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
  nextAsked = false,
): Promise<AssistantReply> {
  const turns: ChatTurn[] = [...history, { role: 'user', text: query }]
  /**
   * 방향을 정한 턴에는 엔진이 무슨 말을 했든 **뼈대 카드와 다음 단계**를 붙인다 —
   * 카피·구좌 추천을 먼저 받을지, 바로 프로모션 자동화로 넘길지는 사용자가 고른다.
   */
  const withNextStep = (reply: AssistantReply): AssistantReply => {
    if (reply.intent) return reply
    const next = nextStepPromptFor(query, nextAsked)
    if (!next) return reply
    return { ...reply, intent: next, brief: reply.brief ?? readBrief(turns) }
  }

  const failed: string[] = []
  for (const engine of engines) {
    try {
      const reply = await askEngine(query, engine, history, intentAsked)
      return withNextStep(
        failed.length ? { ...reply, answeredBy: `${reply.answeredBy} (${failed.join('·')} 응답 실패)` } : reply,
      )
    } catch (err) {
      console.info(`[assistant] ${ENGINE_LABEL[engine]} 응답 실패:`, (err as Error).message)
      failed.push(ENGINE_LABEL[engine])
    }
  }
  return withNextStep({
    ...answer(query, history, intentAsked),
    answeredBy: failed.length ? `규칙 기반 (${failed.join('·')} 응답 실패)` : '규칙 기반',
  })
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

/** '프로모션 기획 시작하기' 버튼이 보내는 첫 발화 — 진행 의도 확인 흐름을 그대로 탄다. */
export const PLAN_STARTER = '프로모션을 기획하려고 해'

export const SUGGESTED_QUESTIONS = [
  '월정액 할인 쿠폰 프로모션 배너로 진행 가능해?',
  '판촉용 쿠폰 품의는 누구 결재가 필요해?',
  'CBS에서 승인요청 버튼이 안 눌려',
  '전환동의 팝업은 어느 UI 버전부터 돼?',
]
