import { categories, docs } from '../data/docs'
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
import {
  extractSentences,
  findSection,
  searchDocs,
  sequenceLines,
  type DocSection,
  type SearchInput,
} from './retrieval'

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

/**
 * 일이 **어떤 순서로** 진행되는지 묻는 발화. 이런 질문에 문장을 점수순으로 2개 뽑으면
 * 절차가 아니라 조각이 나온다 — 소제목을 찾아 문서 순서대로 답해야 한다.
 */
const SEQUENCE_CUES = ['프로세스', '절차', '단계', '순서', '흐름', 'step']

function wantsSequence(query: string): boolean {
  const q = query.toLowerCase()
  return SEQUENCE_CUES.some((k) => q.includes(k))
}

/** 절차 답변에 허용하는 줄 수 — 운영 프로세스가 Step 1~6이라 요약 줄까지 7줄이 들어간다 */
const SEQUENCE_LIMIT = 8

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
  // "프로모션 어떤 순서로 진행돼?"는 절차를 묻는 사실 질문이다. '프로모션'+'진행'이 함께 있다고
  // 기획 상담으로 끌면, 문서에 그대로 적힌 절차 대신 "상품 유형에 따라 갈립니다"만 돌아간다.
  if (wantsSequence(query)) return false
  // "프로모션 문서 작성하고 싶어"는 기획이 아니라 위키 작성이다 — 어드민 확인 칩이 끼어들지 않게 먼저 거른다.
  if (detectKnowledgeEdit(query)) return false
  // "~로 진행 가능해?"는 하겠다는 말이 아니라 되는지 묻는 사실 질문이다. '진행'이 PLAN_VERBS에 걸린다고
  // 기획 상담으로 끌면 "가능해?"에 답 없이 확인 칩만 뜬다 — 분류가 어휘 우연에 기대지 않게 가능성 질문을 먼저 거른다.
  if (asksPossibility(query)) return false
  return CAMPAIGN_NOUNS.some((k) => query.includes(k)) && PLAN_VERBS.some((k) => query.includes(k))
}

export const INTENT_CONFIRM_QUESTION = '혹시 지금 진행하려는 프로모션이 있으신가요? 있으시면 프로모션 어드민 화면으로 바로 열어드리겠습니다.'
export const INTENT_PRODUCT_QUESTION = '월정액(PPM)인가요, 단건(PPV)인가요? 고르시면 그 기준으로 어드민 화면을 엽니다.'
/** 질문만 받을 때의 확인 — 답변 근거 문서가 상품 유형에 따라 갈려서 한 번은 확인하고 넘어간다 */
export const INTENT_PRODUCT_QA_QUESTION = '월정액(PPM) 기준인가요, 단건(PPV) 기준인가요? 고르시면 그 기준 문서로만 답합니다.'

/** 한 발화에 언급된 상품 유형 전부 — 배열 순서가 아니라 언급 여부만 본다 */
function mentionedProducts(text: string): (typeof PRODUCTS)[number][] {
  const q = text.toLowerCase()
  return PRODUCTS.filter((p) => p.keywords.some((k) => q.includes(k)))
}

/**
 * 한 발화가 가리키는 상품 유형. 두 상품을 함께 말했으면(비교 질문 등) **어느 쪽으로도 단정하지 않는다** —
 * scope는 반대 상품 문서를 제외하는 장치라, 잘못 걸면 정답 문서에 닿을 수 없게 된다.
 */
function detectProduct(text: string) {
  const hit = mentionedProducts(text)
  return hit.length === 1 ? hit[0] : null
}

function detectChannel(query: string): string | null {
  const q = query.toLowerCase()
  return CHANNELS.find((c) => c.keywords.some((k) => q.includes(k)))?.label ?? null
}

/**
 * "50만", "30만명", "800000명" 같은 표현에서 타겟 모수를 읽는다. 단위(만·천)나 명·건이 있어야 모수로 본다.
 * **`원`이 붙은 수는 모수가 아니다** — 모수는 발송 Capa 검토 기준이라 금액이 들어가면 검토가 무의미해진다.
 * 금액이 함께 나온 발화의 "N건"은 쿠폰 발급 건수일 수도 있어 모수로 단정하지 않는다(애매하면 비운다).
 */
function detectTargetCount(query: string): string | null {
  // "3만원", "3만 5천원", "1,000원"을 먼저 지워야 "3만 5천원"의 '3만'이 모수로 남지 않는다
  const stripped = query.replace(/(?:\d[\d,.]*\s*(?:억|만|천|백)?\s*)+원/g, ' ')
  const hasAmount = stripped !== query
  const m =
    stripped.match(hasAmount ? /(\d[\d,.]*)\s*(만|천)?\s*(명)/ : /(\d[\d,.]*)\s*(만|천)?\s*(명|건)/) ??
    (hasAmount ? null : stripped.match(/(\d[\d,.]*)\s*(만|천)/))
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
 * 혜택 스킴 — `promotion/schemes.md`의 PPV 표기를 그대로 쓴다.
 * 쿠폰과 경품을 함께 말했으면 결합으로 본다.
 */
const SCHEMES: { keywords: string[]; label: string }[] = [
  // '쿠폰'·'경품' 단독은 스킴을 고른 말이 아니라 그냥 언급이다 — 스킴을 가리키는 복합어만 둔다.
  { keywords: ['선발급', '할인쿠폰', '할인 쿠폰'], label: '할인쿠폰 선발급' },
  { keywords: ['경품 추첨', '경품추첨', '추첨 경품', '전원 경품', '전원 증정', '구매자 경품', '경품 증정', '응모', '추첨', '굿즈', 'b캐시'], label: '구매자 경품' },
]

function detectScheme(text: string): string | null {
  const q = text.toLowerCase()
  const hit = SCHEMES.filter((s) => s.keywords.some((k) => q.includes(k)))
  if (hit.length === 0) return null
  return hit.length > 1 ? '쿠폰 + 경품' : hit[0].label
}

/** 이름이 아니라 "아직 안 정했다 / 뭐로 할지 묻는다"는 뜻의 꼬리 — 이름으로 읽지 않는다 */
const NAME_UNDECIDED = /^(?:아직|미정|미확정|안\s*정|못\s*정|정해지지|정하지|정해야|정할|모르|없|나중|추후|고민|생각\s*중|tbd)|추천|지어|짓|뭐|뭘|무엇|무슨|어떤|어떻게|[?？]/i
/** 이름이 끝나는 자리 — "~로 하고", "~으로", "~까지", 날짜 시작, 서술어 */
const NAME_BOUNDARY = /\s*(?:(?:으로|로)\s*(?:하|할|해|정|갈|진행|가|잡|부르|쓰|결정|이름)|(?:이고|이며|이라고|이라|인데|입니다|이에요|이야|이다)(?:\s|$)|[~\-–]|까지|부터)|\s+(?:\d{1,2}월|\d{4}[-.]|\d{1,2}일)/

/**
 * 따옴표로 묶었거나 "이벤트명은 ~" 형태로 말한 것만 이벤트명으로 본다. 작품명을 멋대로 만들지 않는다.
 * 뒤에 이어진 절(기간·진행 서술)은 잘라 내고, 미정·부정·질문이면 비운다 —
 * 비우면 `missingBriefFields`가 아직 안 물어본 것으로 보고 다시 묻는다(덜 채우는 방향).
 */
function detectEventName(text: string): string | null {
  const quoted = text.match(/[「『《'"\u201c\u2018]([^」』》'"\u201d\u2019\n]{2,40})[」』》'"\u201d\u2019]/)
  if (quoted) return quoted[1].trim()
  const named = text.match(/(?:이벤트명|프로모션명|행사명)\s*(?:은|는|이|가|:)?\s*([^\n,.]{2,60})/)
  if (!named) return null
  let rest = named[1].trim()
  if (NAME_UNDECIDED.test(rest)) return null
  const cut = rest.search(NAME_BOUNDARY)
  if (cut >= 0) rest = rest.slice(0, cut)
  rest = rest.trim()
  if (rest.length < 2 || rest.length > 40 || NAME_UNDECIDED.test(rest)) return null
  return rest
}

/**
 * 방향을 정했다는 발화. "~로 진행할게", "~로 해야겠다" 처럼 **고른 결과**를 말한 턴에서는
 * 문서를 다시 쏟아내지 않고 정리로 넘어간다.
 */
const DECIDE_CUES = [
  '진행해야겠', '진행할게', '진행하자', '진행하려', '해야겠', '하기로', '할래', '할게', '갈게', '가자',
  '이걸로', '그걸로', '정했', '결정',
]

/**
 * 되묻거나 알려 달라는 발화인지. `할래`·`정했`·`하기로`는 평서형 결정에도, 의문형에도 똑같이 나타나는
 * 어미라 어미 목록으로는 둘을 가를 수 없다 — **문장 유형**을 본다.
 */
const QUESTION_WORDS = ['어떻게', '어떤', '어느', '얼마', '뭐', '무엇', '무슨', '언제', '누구', '누가', '어디', '몇', '왜']
const QUESTION_ENDINGS = ['할까', '될까', '갈까', '볼까', '을까', '까요', '나요', '가요', '냐']
const REQUEST_CUES = ['알려', '말해', '보여', '가르쳐', '설명']

/** 가능·허용 여부를 묻는 표현 — "가능해", "되나", "돼?", "할 수 있어" */
const POSSIBILITY_PATTERN = /가능(?:해|한가|할까|하나|합니까|한지|하니|할지)|되나|돼\s*[?？요]|되는지|되죠|될지|수\s*있(?:어|나|을|는지|니|습니까)/
function asksPossibility(query: string): boolean {
  return POSSIBILITY_PATTERN.test(query)
}

export function isQuestion(query: string): boolean {
  return (
    /[?？]/.test(query) ||
    asksPossibility(query) ||
    QUESTION_WORDS.some((k) => query.includes(k)) ||
    QUESTION_ENDINGS.some((k) => query.includes(k)) ||
    REQUEST_CUES.some((k) => query.includes(k))
  )
}

/** 결정 발화는 평서문이어야 한다. 질문이 한 문장이라도 섞였으면 결정으로 보지 않고 질문에 답한다. */
export function detectDecision(query: string): boolean {
  // "문서 고칠게"의 '할게'류는 프로모션 방향 결정이 아니다
  return !isQuestion(query) && !detectKnowledgeEdit(query) && DECIDE_CUES.some((k) => query.includes(k))
}

/**
 * 위키 문서를 새로 쓰거나 고쳐 달라는 발화. 어시스턴트는 문서를 고칠 수 없으니 검색 결과 대신 제출 화면을 안내한다.
 * 대상 명사(문서·위키·지식)와 쓰기 동사가 **함께** 있어야 한다 — "ACS 오퍼 등록 어떻게 해?" 같은 시스템 질문을 끌어오지 않게.
 */
const KNOWLEDGE_NOUNS = ['문서', '위키', '지식']
const KNOWLEDGE_NEW_CUES = ['작성', '추가', '새로 쓰', '새로 써', '남겨', '남기', '등록', '올리', '올려']
const KNOWLEDGE_FIX_CUES = ['수정', '고쳐', '고치', '고칠', '반영', '업데이트', '갱신', '바꿔', '정정']
/** 문서 내용이 바뀌었다는 정정 — 명사 없이 "이거 바뀌었어"만 말해도 수정 요청이다 */
const CORRECTION_PATTERN = /바뀌었|바뀐\s*거|변경됐|변경되었|달라졌|틀렸/
/** "작성 규칙"·"있어?"는 문서를 묻는 질문이다 — 검색이 HUB-03 등을 직접 찾게 둔다 */
const KNOWLEDGE_QUERY_PATTERN = /규칙|있(?:어|나|니|는지|을까|습니까)/

export type KnowledgeEditKind = 'new' | 'fix'

export function detectKnowledgeEdit(query: string): KnowledgeEditKind | null {
  const q = query.replace(/\s+/g, ' ')
  if (KNOWLEDGE_QUERY_PATTERN.test(q)) return null
  // "어떻게 고쳐?"는 안내가 답이지만, "언제 바뀌었어?"·"누가 수정했어?"는 이력을 묻는 사실 질문이다
  const asksFact = QUESTION_WORDS.some((k) => k !== '어떻게' && k !== '어디' && q.includes(k))
  if (asksFact) return null
  if (q.includes('새 문서') || q.includes('새문서')) return 'new'
  const hasNoun = KNOWLEDGE_NOUNS.some((k) => q.includes(k))
  if (hasNoun && KNOWLEDGE_FIX_CUES.some((k) => q.includes(k))) return 'fix'
  if (hasNoun && KNOWLEDGE_NEW_CUES.some((k) => q.includes(k))) return 'new'
  if (!/[?？]/.test(q) && CORRECTION_PATTERN.test(q)) return 'fix'
  return null
}

/** 발화에 드러난 위키 카테고리 — 새 문서 화면에서 고를 이름을 그대로 돌려준다 */
const CATEGORY_CUES: { id: (typeof categories)[number]['id']; keywords: string[] }[] = [
  { id: 'programming', keywords: ['편성'] },
  { id: 'promotion', keywords: ['프로모션', '마케팅', '쿠폰', '배너'] },
  { id: 'guide', keywords: ['이용 안내', '허브 사용', '가이드'] },
]

function mentionedCategory(query: string): string | null {
  const id = CATEGORY_CUES.find((c) => c.keywords.some((k) => query.includes(k)))?.id
  return categories.find((c) => c.id === id)?.label ?? null
}

/** 지난 일을 말하는 서술 — 연도 생략 날짜를 다음 해로 넘기지 않는 단서 */
const PAST_CUES = /했(?:던|었|는데|고|다|어)|였(?:던|었)|됐|된\s*(?:적|프로모션|이벤트)|끝났|종료됐|지난|작년|실적|결과|반응/

/**
 * "10월 1일 ~ 10월 14일", "2026-10-01~2026-10-14" 처럼 명시된 기간만 읽는다.
 *
 * 연도를 생략한 날짜는 **앞으로 할 프로모션**을 뜻하는 경우가 대부분이다(기획 상담 도구이므로).
 * 경계는 **종료일이 오늘보다 앞서면**(= 이미 끝난 기간) 다음 해로 넘긴다.
 *  - 오늘이 기간 안이거나(진행 중) 종료일이 오늘이면 올해 그대로 둔다 — 시작일이 지났다고 넘기면 진행 중인 건을 잘못 옮긴다.
 *  - "했던/지난/실적" 같은 과거 서술이 같은 문장에 있으면 넘기지 않는다 — 과거 실적을 말하는 경우다.
 *  - 연도를 명시한 발화(ISO)는 손대지 않는다. 연말~연초("12월 20일 ~ 1월 5일")는 종료일을 다음 해로 둔다.
 * 한 해 넘어가는 것까지만 추측한다(두 해 뒤로는 넘기지 않는다).
 */
function detectPeriod(query: string): { start: string; end: string } | null {
  const iso = query.match(/(\d{4}-\d{2}-\d{2})\s*[~\-–]\s*(\d{4}-\d{2}-\d{2})/)
  if (iso) return { start: iso[1], end: iso[2] }

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const pad = (n: string | number) => String(n).padStart(2, '0')
  const kr = query.match(/(\d{1,2})월\s*(\d{1,2})일?\s*[~\-–부터]+\s*(?:(\d{1,2})월\s*)?(\d{1,2})일/)
  if (!kr) return null
  const [, m1, d1, m2, d2] = kr
  let y1 = now.getFullYear()
  let y2 = y1
  if (Number(m2 ?? m1) < Number(m1)) y2 = y1 + 1 // 연말~연초
  const end0 = `${y2}-${pad(m2 ?? m1)}-${pad(d2)}`
  const sentence = query.split(/[\n.?!？]/).find((s) => s.includes(kr[0])) ?? query
  if (end0 < today && !PAST_CUES.test(sentence)) {
    y1 += 1
    y2 += 1
  }
  return { start: `${y1}-${pad(m1)}-${pad(d1)}`, end: `${y2}-${pad(m2 ?? m1)}-${pad(d2)}` }
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
  // 상품 유형만은 **가장 최근에 상품을 언급한 사용자 발화**가 정한다 — "월정액 말고 단건으로 바꿀게"처럼
  // 대화 중간에 바꾸는 일이 흔하다. 어시스턴트 턴은 여전히 제외한다(되물은 문장이 조건으로 굳지 않게).
  // 나머지 조건(혜택·기간·채널·모수)은 누적되는 게 맞아 기존대로 전체 발화에서 읽는다.
  let product: CampaignSlots['product'] = null
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role !== 'user') continue
    if (mentionedProducts(turns[i].text).length === 0) continue
    product = detectProduct(turns[i].text)
    break
  }
  return {
    product,
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
  /** 앞에서 쿠폰·경품을 나란히 검토했더라도 "선발급으로 할게"라고 고른 **마지막** 결정이 확정값이다. */
  // 스킴은 **결정 발화에서만** 확정한다. 질문 속 언급("경품 이벤트는 반응률이 어때?")이나
  // 검토 중인 말("쿠폰이랑 경품 둘 다 검토중")이 확정값으로 굳으면 어드민까지 틀린 값이 넘어간다.
  let scheme: string | null = null
  for (let i = turns.length - 1; i >= 0 && !scheme; i--) {
    if (turns[i].role === 'user' && detectDecision(turns[i].text)) scheme = detectScheme(turns[i].text)
  }
  // 혜택 금액 폴백도 질문에서는 읽지 않는다
  const stated = detectBenefit(
    turns
      .filter((t) => t.role === 'user' && !isQuestion(t.text))
      .map((t) => t.text)
      .join('\n'),
  )
  return {
    product: product?.label ?? '',
    name: detectEventName(said) ?? '',
    period: slots.period ? `${slots.period.start} ~ ${slots.period.end}` : '',
    scheme: scheme ?? stated ?? '',
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

/** 화면 라벨에 넣을 실패 사유 — 원문을 살리되 라벨이 넘치지 않게 자른다 */
const shortReason = (message: string) => {
  const one = message.replace(/\s+/g, ' ').trim()
  return one.length > 140 ? `${one.slice(0, 137)}…` : one || '사유 없음'
}

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
 * 위키가 비어 있다고 표시해 둔 줄은 근거로 쓰지 않는다 — 문서의 실제 표기는 `**아직 못 채운 것** —` 이고,
 * AI 수정(`edit-prompt.md`)이 남기는 `(보완 필요)` 도 같은 뜻이라 둘 다 막는다.
 */
const GAP_MARKERS = ['아직 못 채운 것', '(보완 필요)']

function keepUsable(lines: string[], search: SearchInput, limit: number): string[] {
  const other = search.scope === 'PPV' ? SCOPE_ONLY_TERMS.PPM : search.scope === 'PPM' ? SCOPE_ONLY_TERMS.PPV : []
  return lines
    .filter((line) => !GAP_MARKERS.some((m) => line.includes(m)))
    .filter((line) => {
      const lower = line.toLowerCase()
      if (!other.length) return true
      const mine = (SCOPE_ONLY_TERMS[search.scope as ProductScope] ?? []).some((t) => lower.includes(t))
      return mine || !other.some((t) => lower.includes(t))
    })
    .slice(0, limit)
}

function usableSentences(doc: WikiDoc, search: SearchInput, limit: number): string[] {
  return keepUsable(extractSentences(doc, search, limit + 3), search, limit)
}

/**
 * 절차 질문에 쓸 소제목 조각. 질문이 소제목에 걸린 문서가 있으면 그 조각을 **순서대로** 돌려준다.
 * 예: "마케팅 프로세스 설명해줄래?" → `프로모션 운영 프로세스 (Step 1~6)` 조각.
 */
function usableSequence(doc: WikiDoc, search: SearchInput): { section: DocSection; lines: string[] } | null {
  const section = findSection(doc, search)
  if (!section) return null
  const lines = keepUsable(sequenceLines(section, SEQUENCE_LIMIT), search, SEQUENCE_LIMIT)
  return lines.length >= 2 ? { section, lines } : null
}

/** 지식 입력·수정 안내 — `assistant-prompt.md`의 같은 이름 규칙과 문구를 맞춘다 */
function knowledgeEditReply(query: string, kind: KnowledgeEditKind): AssistantReply {
  const guide = docs.find((d) => d.code === 'HUB-03')
  const flow = docs.find((d) => d.code === 'HUB-02')
  const category = mentionedCategory(query)
  const newLine = '· 새 문서는 위키 문서 목록의 **+ 새 문서**에서 씁니다.'
  const fixLine = '· 기존 문서는 그 문서 화면의 **✎ 수정 제안**에서 고칩니다.'
  const lines = [
    '위키 문서는 대화로 바로 고칠 수 없고, 화면에서 제출합니다.',
    ...(kind === 'new' ? [newLine, fixLine] : [fixLine, newLine]),
    '· 제출하면 GitHub PR이 열리고, 관리자가 머지한 뒤 다음 배포에서 위키에 반영됩니다.',
  ]
  if (kind === 'new' && category) lines.push(`· 새 문서 화면의 카테고리 칸에서 **${category}** 메뉴를 고르시면 됩니다.`)
  // 정정만 들은 값은 문서가 고쳐지기 전까지 근거가 아니다 — 고친 척하지 않는다
  if (CORRECTION_PATTERN.test(query)) lines.push('말씀하신 변경은 문서가 고쳐지기 전까지 답변 근거로 쓰지 않습니다.')
  const refs = kind === 'fix' ? [guide, flow] : [guide]
  return {
    text: lines.join('\n'),
    sources: refs
      .filter((d): d is WikiDoc => Boolean(d))
      .map((d) => ({ docId: d.id, label: `참고 · ${d.title}` })),
  }
}

export function answer(query: string, history: ChatTurn[] = [], intentAsked = false): AssistantReply {
  const turns: ChatTurn[] = [...history, { role: 'user', text: query }]

  // 문서를 쓰거나 고치겠다는 발화에 검색 문장을 쏟으면 관계없는 정책이 답처럼 보인다 — 제출 화면만 짧게 안내한다.
  const edit = detectKnowledgeEdit(query)
  if (edit) return knowledgeEditReply(query, edit)

  const intent = intentPromptFor(query, intentAsked)

  // 진행 의도만 던진 발화에는 정책을 쏟아내지 않는다 — 무엇을 만들지 모르니 어떤 정책이 걸리는지도 아직 알 수 없다.
  if (intent) {
    const slots = readSlots(turns)
    const lead = slots.product
      ? `${slots.product.label} 프로모션이군요.`
      : '프로모션 진행은 상품 유형에 따라 적용 정책이 갈립니다.'
    return { text: lead, sources: [], intent }
  }

  /**
   * 기획 의도 발화는 확인 칩을 붙일지(`intentAsked`)와 **별개로** 정책을 쏟지 않는다.
   * 칩을 이미 한 번 물었어도 새 기획 상담이 시작된 것이면 한 줄만 답한다. 질문 형태("~하려면 뭐부터?")는 답을 해야 하니 제외.
   */
  if (detectCampaignIntent(query) && !isQuestion(query) && !detectDecision(query)) {
    const slots = readSlots(turns)
    return {
      text: slots.product
        ? `${slots.product.label} 프로모션이군요.`
        : '프로모션 진행은 상품 유형에 따라 적용 정책이 갈립니다.',
      sources: [],
    }
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
  let found = searchDocs(search)
  /**
   * 두 상품을 견주는 질문("PPM이랑 PPV 차이")은 두 정책 문서가 근거다. 검색기는 짧은 비교 질의에서 이 둘을 놓치므로
   * (한 단어만 스친 문서를 거르는 게이트), 이번 발화에 두 상품이 다 나오면 두 정책 문서를 앞에 둔다.
   */
  if (mentionedProducts(query).length === PRODUCTS.length) {
    const policy = PRODUCTS.map((p) => docs.find((d) => d.code === p.policyCode)).filter((d): d is WikiDoc => Boolean(d))
    found = [
      ...policy.map((doc) => ({ doc, score: Number.MAX_SAFE_INTEGER, excerpt: '' })),
      ...found.filter((h) => !policy.includes(h.doc)),
    ]
  }
  const hits = found.slice(0, 3)

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

  /**
   * 절차를 물었으면 **문서 하나의 해당 소제목을 순서대로** 보여 준다. 여러 문서에서
   * 두 줄씩 긁어 모으면 "프로세스를 설명해 달라"는 질문에 조각만 돌아간다.
   */
  const sequence = wantsSequence(query) ? hits.map((h) => ({ hit: h, found: usableSequence(h.doc, search) })).find((x) => x.found) : undefined

  if (sequence?.found) {
    const { hit, found } = { hit: sequence.hit, found: sequence.found }
    used.push(hit)
    lines.push(`**${hit.doc.title}** (${hit.doc.code}) — ${found.section.heading}`)
    // 절차는 '단계명 — 하는 일'까지만 쓴다. 결재 기준·체크포인트 칸까지 붙이면 한 줄이 너무 길어진다.
    for (const s of found.lines) lines.push(`· ${s.split(' — ').slice(0, 2).join(' — ')}`)
  } else {
    for (const hit of hits.slice(0, 2)) {
      const sentences = usableSentences(hit.doc, search, 2)
      if (sentences.length === 0) continue
      used.push(hit)
      lines.push(`**${hit.doc.title}** (${hit.doc.code})`)
      for (const s of sentences) lines.push(`· ${s}`)
    }
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

/** 엔진 응답을 기다리는 한도 — 넘기면 다음 엔진, 마지막엔 규칙 기반으로 넘어간다. 서버 함수 한도(300초)까지 스피너를 보이지 않는다. */
export const ENGINE_TIMEOUT_MS = 30_000

async function askEngine(
  query: string,
  engine: Engine,
  history: ChatTurn[],
  intentAsked: boolean,
): Promise<AssistantReply> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ENGINE_TIMEOUT_MS)
  try {
    return await requestEngine(query, engine, history, intentAsked, ctrl.signal)
  } catch (err) {
    // 중단 사유를 라벨에 남긴다 — 그냥 "aborted"로는 왜 규칙 기반으로 떨어졌는지 알 수 없다
    if (ctrl.signal.aborted) throw new Error(`${ENGINE_TIMEOUT_MS / 1000}초 안에 응답이 없어 중단했습니다 (시간 초과)`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function requestEngine(
  query: string,
  engine: Engine,
  history: ChatTurn[],
  intentAsked: boolean,
  signal: AbortSignal,
): Promise<AssistantReply> {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, engine, history }),
    signal,
  })
  if (!res.ok) {
    // 서버는 실패 사유를 { error } 로 돌려준다. 상태 코드만 들고 올라가면 화면에는
    // "응답 실패" 네 글자만 남아서, 키 문제인지 모델명 문제인지 끝까지 알 수 없다.
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ? `${body.error} (HTTP ${res.status})` : `HTTP ${res.status}`)
  }
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
        failed.length ? { ...reply, answeredBy: `${reply.answeredBy} (${failed.join(' · ')})` } : reply,
      )
    } catch (err) {
      console.info(`[assistant] ${ENGINE_LABEL[engine]} 응답 실패:`, (err as Error).message)
      failed.push(`${ENGINE_LABEL[engine]}: ${shortReason((err as Error).message)}`)
    }
  }
  return withNextStep({
    ...answer(query, history, intentAsked),
    answeredBy: failed.length ? `규칙 기반 (${failed.join(' · ')})` : '규칙 기반',
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
