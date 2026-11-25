import { categories, docs } from '../data/docs'
import type {
  CampaignDraft,
  ChatMessage,
  ChatReport,
  Engine,
  EngineFailure,
  EngineFailureCode,
  IntentPrompt,
  ProductScope,
  PromotionBrief,
  SourceRef,
  WikiDoc,
} from '../types'
import {
  extractSentences,
  findSection,
  parseSections,
  searchDocs,
  sequenceLines,
  tokenize,
  type DocSection,
  type SearchInput,
} from './retrieval'
import { mayBeReport, REPORT_TIMEOUT_MS } from './report'

/** PPC 상품 유형 — 근거 문서를 고르는 1차 기준 */
const PRODUCTS: { keywords: string[]; label: string; scope: 'PPM' | 'PPV'; policyCode: string }[] = [
  // B tv+는 PPM 안의 세부 상품이다 — 'b tv' 만으로는 플랫폼 이름이라 '+'·'플러스'가 붙은 말만 센다
  {
    keywords: ['월정액', 'ppm', '구독', 'b tv+', 'btv+', 'b tv 플러스', 'btv플러스', '비티비플러스', '비티비 플러스'],
    label: 'PPM(월정액)',
    scope: 'PPM',
    policyCode: 'PPC-P-02',
  },
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
  '효율', '어디가 좋', '어디가 나',
  // "타겟 어떻게 잡는 게 좋아?"도 고를 방법을 묻는 말이다 — '어떻게 하/해'만으로는 '잡는'·'쓰는'을 놓친다
  '는 게 좋', '는 게 나',
]

/** "좋은 구좌는 어디야?"처럼 고를 곳을 묻는 말. '어디야' 하나만으로는 메뉴 위치 질문과 구분이 안 돼 평가어와 함께 볼 때만 센다 */
const WHERE_TO_PICK = /(좋은|나은|잘\s?되는|잘\s?나오는).{0,20}어디/

/** 판단 요청의 주제어 — 진행 의도 명사에 더해, 구좌·마케팅 효율을 묻는 말도 인사이트가 답이다 */
const ADVICE_TOPICS = [...CAMPAIGN_NOUNS, '구좌', '마케팅']

/**
 * 판단 요청으로 볼지. 프로모션 이야기일 때만 본다 — "CBS 승인요청 방법"은
 * 문서에 절차가 그대로 있는 사실 질문이라 판단 요청으로 다루면 안 된다.
 */
function wantsAdvice(query: string): boolean {
  if (!ADVICE_CUES.some((k) => query.includes(k)) && !WHERE_TO_PICK.test(query)) return false
  return ADVICE_TOPICS.some((k) => query.includes(k)) || PRODUCTS.some((p) => p.keywords.some((k) => query.toLowerCase().includes(k)))
}

/**
 * 허브 화면 이름. 이 말과 아래 동작어가 함께 나오면 허브 사용법 질문이다.
 * '승인'·'문서'처럼 업무에서도 흔히 쓰는 말은 넣지 않는다 — "판촉 품의 승인 방법"이 허브 안내로 빠진다.
 */
const HUB_SCREENS = ['위키', '편성', '스케줄', '시스템 바로가기', '바로가기', '내 요청', '승인 관리', '계정', '즐겨찾기', '허브']
const HUB_ACTIONS = ['수정', '추가', '반영', '등록', '방법', '고치', '바꾸', '신청']
/** 업무어가 나오면 허브 화면이 아니라 프로모션 업무를 묻는 것이다 */
const WORK_TERMS = ['품의', '결재', '쿠폰', '배너', '소재', '팝업', '이미지', '문구', '카피', '프로모션', '캠페인']
/** 질문에 이름이 직접 나오는 시스템과 그 매뉴얼 문서 코드 */
const SYSTEM_DOCS: Record<string, string> = { acs: 'PPC-ACS', cbs: 'PPC-CBS', swing: 'PPC-SWG' }

/** 허브 화면을 어떻게 쓰는지 묻는 발화. 맞으면 이용 안내 문서를 먼저 본다 */
function wantsHubHowTo(query: string): boolean {
  const q = query.toLowerCase()
  // 시스템 이름이 나오면 그 시스템 매뉴얼을 묻는 것이다 — "CBS 승인 등록 방법"을 허브 안내로 끌고 가지 않는다
  if (Object.keys(SYSTEM_DOCS).some((k) => q.includes(k))) return false
  if (WORK_TERMS.some((k) => q.includes(k))) return false
  return HUB_SCREENS.some((k) => q.includes(k)) && HUB_ACTIONS.some((k) => q.includes(k))
}

/**
 * 프로모션 업무 대상(배너·소재·쿠폰 등)을 고치는 방법을 묻는 발화. 허브 화면 이름이 없으면 위키 문서 수정이 아니라
 * 업무 질문이다 — 이용 안내 문서를 뒤로 미룬다. "쿠폰 문서 등록"처럼 문서를 직접 말하면 앞의 문서 안내 분기가 먼저 받는다.
 */
function wantsBusinessEdit(query: string): boolean {
  const q = query.toLowerCase()
  if (HUB_SCREENS.some((k) => q.includes(k))) return false
  return WORK_TERMS.some((k) => q.includes(k)) && HUB_ACTIONS.some((k) => q.includes(k))
}

/** 사용자가 시스템 이름이나 문서 코드로 직접 가리킨 문서. 점수가 처져도 근거에서 빼지 않는다 */
function namedInQuery(doc: WikiDoc, query: string): boolean {
  const q = query.toLowerCase()
  const code = doc.code.toLowerCase()
  return q.includes(code) || Object.entries(SYSTEM_DOCS).some(([name, c]) => c.toLowerCase() === code && q.includes(name))
}

/**
 * 일이 **어떤 순서로** 진행되는지 묻는 발화. 이런 질문에 문장을 점수순으로 2개 뽑으면
 * 절차가 아니라 조각이 나온다 — 소제목을 찾아 문서 순서대로 답해야 한다.
 */
const SEQUENCE_CUES = ['프로세스', '절차', '단계', '순서', '흐름', 'step']

/**
 * 2순위 문서를 근거로 함께 붙이는 최소 점수 비율(1순위 대비). 예시 질문에서 곁가지 문서는 0.6 밑,
 * 함께 봐야 하는 문서(결재 라인 + 운영 절차, CBS 매뉴얼 + FAQ)는 0.6 위에 놓였다.
 */
const SECOND_SOURCE_RATIO = 0.6

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
  // 카피·이벤트명·구좌를 만들어 달라는 말은 진행 확인보다 결과물이 먼저다 — 칩 없이 바로 답한다
  if (detectDeliverable(query)) return false
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

/** 결과물 요청 뒤 상품을 모를 때 — 답을 이미 받았으니 고르면 같은 요청을 그 기준으로 다시 보낸다 */
export const INTENT_PRODUCT_RETRY_QUESTION = '월정액(PPM)인가요, 단건(PPV)인가요? 고르시면 그 상품 기준으로 다시 맞춰 드립니다.'
/** PPM만 말했을 때 — 근거 줄이 B tv+ 와 그 외 월정액으로 갈린다 */
export const PPM_DETAIL_QUESTION = 'PPM 중 B tv+ 상품인가요, 지상파·종편·CP 월정액인가요? 고르시면 그 상품 기준으로 맞춰 답합니다.'

export type DeliverableKind = 'copy' | 'name' | 'placement'

const DELIVERABLE_OBJECTS: [DeliverableKind, string[]][] = [
  ['name', ['이벤트명', '프로모션명', '행사명', '이벤트 이름', '프로모션 이름']],
  ['copy', ['카피', '문구', '헤드라인']],
  ['placement', ['구좌']],
]
/** 만들어 달라는 말 — '추천'은 맨몸도 센다("이벤트명 3개만 추천") */
const MAKE_CUES = /추천|써\s*줘|써\s*줄래|써\s*주세요|뽑아|만들어|지어|짜\s*줘|제안해|골라\s*줘|잡아\s*줘|\d+\s*(?:개|안|가지)/
/** 기준을 묻는 말 — 결과물이 아니라 사실 질문이다 */
const ASKS_RULE = /원칙|규칙|가이드|기준|규격|글자\s*수|몇\s*자|자수|뭐야|무엇|이란|의미/
/** 시스템 공지·품의 문구는 마케팅 카피가 아니다 */
const NOT_MARKETING = /acs|cbs|swing|공지|품의|메일/i

/**
 * 카피·이벤트명·노출 구좌를 **만들어 달라는** 요청. 맞으면 진행 확인·방향 결정으로 보지 않고 결과물부터 답한다.
 * 판별 단어는 `assistant-prompt.md` 의 결과물 요청 기준과 맞춘다 — 한쪽을 바꾸면 다른 쪽도 맞춘다.
 */
export function detectDeliverable(query: string): DeliverableKind | null {
  if (detectKnowledgeEdit(query)) return null
  // 칩이 다시 보내는 "B tv+ 기준으로 …" 의 '기준'은 상품을 고른 말이지 기준을 묻는 말이 아니다
  const q = query.replace(/기준으로/g, ' ')
  if (ASKS_RULE.test(q) || NOT_MARKETING.test(q)) return null
  if (!MAKE_CUES.test(q)) return null
  return DELIVERABLE_OBJECTS.find(([, words]) => words.some((w) => q.includes(w)))?.[0] ?? null
}

/** PPM 안의 세부 상품. 위키에 근거가 있는 구분은 이 둘뿐이다(`promotion/products.md`) */
export type PpmDetail = 'btvplus' | 'ppm-other'
export const PPM_DETAILS: { value: PpmDetail; label: string; keywords: string[] }[] = [
  { value: 'btvplus', label: 'B tv+', keywords: ['b tv+', 'btv+', 'b tv 플러스', 'btv플러스', '비티비플러스', '비티비 플러스'] },
  { value: 'ppm-other', label: '지상파·종편·CP 월정액', keywords: ['지상파', '종편', 'cp 월정액', 'cp별 월정액'] },
]

/** 한 발화에 언급된 세부 상품 전부 — 둘 다 나오면 어느 쪽으로도 정하지 않는다(상품 비교와 같은 이유) */
function mentionedPpmDetails(text: string): (typeof PPM_DETAILS)[number][] {
  const q = text.toLowerCase()
  return PPM_DETAILS.filter((d) => d.keywords.some((k) => q.includes(k)))
}

export function detectPpmDetail(text: string): PpmDetail | null {
  const hit = mentionedPpmDetails(text)
  return hit.length === 1 ? hit[0].value : null
}

export const ppmDetailLabel = (detail: PpmDetail) => PPM_DETAILS.find((d) => d.value === detail)?.label ?? ''

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
  // "진행하려는데 구좌 추천해줘"의 '진행하려'는 결정이 아니라 결과물 요청의 앞말이다
  return !isQuestion(query) && !detectKnowledgeEdit(query) && !detectDeliverable(query) && DECIDE_CUES.some((k) => query.includes(k))
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
  /** PPM 안의 세부 상품. 상품이 PPM이 아니면 null */
  ppmDetail: PpmDetail | null
}

/** turns[0..upto] 의 사용자 발화 중 가장 최근에 상품을 말한 발화가 정한 상품 */
function latestProduct(turns: ChatTurn[], upto: number): CampaignSlots['product'] {
  for (let i = upto; i >= 0; i--) {
    if (turns[i].role !== 'user') continue
    if (mentionedProducts(turns[i].text).length === 0) continue
    return detectProduct(turns[i].text)
  }
  return null
}

/**
 * 세부 상품도 **가장 최근에 세부 상품을 말한 사용자 발화**가 정한다. '지상파'·'종편'은 상품을 정하지 않는다 —
 * "지상파 드라마 단건 할인"은 PPV다. 그 발화까지 상품이 PPM일 때만 세부 상품으로 읽는다.
 */
function readPpmDetail(turns: ChatTurn[], product: CampaignSlots['product']): PpmDetail | null {
  if (product?.scope !== 'PPM') return null
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role !== 'user') continue
    if (mentionedPpmDetails(turns[i].text).length === 0) continue
    const detail = detectPpmDetail(turns[i].text)
    return detail && latestProduct(turns, i)?.scope === 'PPM' ? detail : null
  }
  return null
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
  const product = latestProduct(turns, turns.length - 1)
  return {
    product,
    benefit: detectBenefit(said),
    period: detectPeriod(said),
    channel: detectChannel(said),
    targetCount: detectTargetCount(said),
    ppmDetail: readPpmDetail(turns, product),
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
  // 세부 상품은 대화로 확인한 것만 덧붙인다 — 어드민으로 넘기는 값(buildCampaignDraft)에는 싣지 않는다
  const detail = product?.scope === 'PPM' && slots.product?.scope === 'PPM' ? slots.ppmDetail : null
  return {
    product: product ? (detail ? `${product.label} · ${ppmDetailLabel(detail)}` : product.label) : '',
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
  /** 답을 만든 쪽 — 화면 하단 라벨로 보여준다. 짧은 출처만 두고 실패 사유는 fallback 으로 */
  answeredBy?: string
  /** 이 답 전에 실패한 엔진과 분류 코드 — 안내 문구·관리자 표시를 여기서 고른다 */
  fallback?: EngineFailure[]
  /** 리포트 답 — text 는 3줄 요약 */
  report?: ChatReport
  reportHint?: 'offer' | 'local-only'
  notice?: string
  /** 리포트를 만들지 못했다(시간 초과·엔진 오류) — 다음 엔진으로 넘기지 않고 「짧게 답 받기」 칩을 붙인다 */
  reportFailed?: boolean
  /** 사용자가 「그만하고 짧게 답 받기」로 끊었다 — 화면은 이 답을 그리지 않고 짧은 답을 다시 요청한다 */
  cancelled?: boolean
}

/** 이번 답변에 진행 확인을 붙일지. 이미 묻거나 답을 들은 대화에는 다시 붙이지 않는다. */
export function intentPromptFor(query: string, alreadyAsked: boolean): IntentPrompt | undefined {
  // 이미 방향을 고른 발화에는 진행 의사를 되묻지 않는다 — 다음 단계 안내가 그 자리를 대신한다.
  if (alreadyAsked || detectDecision(query) || !detectCampaignIntent(query)) return undefined
  return { kind: 'confirm', question: INTENT_CONFIRM_QUESTION }
}

export const ENGINE_LABEL: Record<Engine, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini' }

/** 엔진이 없거나 모두 실패해 규칙 기반으로 답했을 때의 출처 — 규칙 기반도 위키 문서를 검색해 만든 답이다 */
export const RULE_BASED_LABEL = '규칙 기반 (문서 기준)'

/** 실패 코드별 원인 구절과 할 일 — 대화창 안내와 AI 수정 오류가 같은 분류를 쓴다 */
type FailureAction = 'retry' | 'persist' | 'admin'
const FAILURE_CAUSE: Record<EngineFailureCode, [cause: string, action: FailureAction]> = {
  overloaded: ['AI 엔진이 잠시 붐벼', 'retry'],
  timeout: ['AI 엔진 응답이 늦어', 'retry'],
  network: ['AI 엔진 연결이 끊겨', 'retry'],
  quota: ['AI 엔진 사용 한도에 걸려', 'persist'],
  auth: ['AI 엔진 연결 설정에 문제가 있어', 'admin'],
  model: ['AI 엔진 연결 설정에 문제가 있어', 'admin'],
  config: ['AI 엔진 연결 설정에 문제가 있어', 'admin'],
  invalid: ['AI 엔진 응답을 받지 못해', 'persist'],
  unknown: ['AI 엔진 응답을 받지 못해', 'persist'],
  maintenance: ['허브 점검 중이라', 'retry'],
  rate: ['요청이 잠깐 많아', 'retry'],
  outside: ['AI가 이 장 밖까지 바꿔 와', 'persist'],
}
const ADMIN_ACTION: Record<Exclude<FailureAction, 'retry'>, string> = {
  persist: '계속되면 관리자에게 알려 주세요.',
  admin: '관리자에게 알려 주세요.',
}

/** 규칙 기반으로 떨어진 답 위에 붙는 한 줄 — 여러 엔진이 실패했으면 마지막(답 직전) 실패로 고른다 */
export function fallbackNotice(fallback: EngineFailure[]): string {
  const [cause, action] = FAILURE_CAUSE[fallback[fallback.length - 1].code]
  return `${cause} 문서 기준 규칙 기반으로 답했습니다. ${action === 'retry' ? '잠시 후 다시 물어보세요.' : ADMIN_ACTION[action]}`
}

/** AI 수정 실패 문구 — 수정은 규칙 기반 대체가 없어 "하지 못했습니다"로 끝난다 */
function editFailureText(code: EngineFailureCode): string {
  // 장 밖 거절은 엔진 고장이 아니라 부탁 범위 문제 — 관리자 대신 부탁을 좁히게 한다
  if (code === 'outside') return 'AI가 이 장 밖까지 바꿔 와서 받지 않았어요. 부탁을 이 장 안의 일로 좁혀 다시 해 주세요'
  const [cause, action] = FAILURE_CAUSE[code]
  return `${cause} 수정하지 못했습니다. ${action === 'retry' ? '잠시 후 다시 시도해 주세요.' : ADMIN_ACTION[action]}`
}

/** 관리자 출처 줄 끝에 붙는 엔진·코드 — 키·모델·할당량 중 어디부터 볼지 정하는 데만 쓴다 */
export const fallbackCodes = (fallback: EngineFailure[]) =>
  fallback.map((f) => `${ENGINE_LABEL[f.engine]} ${f.code}`).join(' · ')

const FAILURE_CODES = new Set<string>(Object.keys(FAILURE_CAUSE))

/** 분류 코드를 실은 엔진 실패 — message 는 원문 사유라 console 에만 남긴다 */
class EngineFailureError extends Error {
  readonly code: EngineFailureCode
  constructor(code: EngineFailureCode, message: string) {
    super(message)
    this.code = code
  }
}

/** 실패 응답을 분류한다. 서버가 code 를 주면 그대로, 없으면 HTTP 상태로 가른다 */
function failureFromResponse(status: number, body: { error?: string; code?: string } | null): EngineFailureError {
  const message = body?.error ? `${body.error} (HTTP ${status})` : `HTTP ${status}`
  if (body?.code && FAILURE_CODES.has(body.code)) return new EngineFailureError(body.code as EngineFailureCode, message)
  // code 없는 503·500 은 키 미설정·배포 구성 누락이다 — 사람이 손대야 풀리므로 설정 문구로 묶는다
  if (status === 503 || status === 500) return new EngineFailureError('config', message)
  if (status === 401 || status === 403) return new EngineFailureError('auth', message)
  if (status === 504) return new EngineFailureError('timeout', message)
  if (status === 429) return new EngineFailureError('rate', message)
  return new EngineFailureError('unknown', message)
}

/** 던져진 오류를 코드로 — fetch 자체가 실패하면(TypeError) 연결 끊김이다 */
const failureCode = (err: unknown): EngineFailureCode =>
  err instanceof EngineFailureError ? err.code : err instanceof TypeError ? 'network' : 'unknown'

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

/** 챗봇 검색 입력 — 상품이 PPM이면 세부 상품까지 실어 줄을 한 번 더 거른다 */
interface ChatSearch extends SearchInput {
  ppmDetail?: PpmDetail | null
}

/** B tv+ 전용 배너 문서 — B tv+ 를 고르지 않은 PPM 답에는 근거로 쓰지 않는다 */
const BTVPLUS_ONLY_DOC = 'MKI-B-12'

/** 이 문서를 근거로 써도 되는지 — PPM인데 B tv+ 를 고르지 않았으면 B tv+ 전용 문서는 뺀다 */
function docUsable(doc: WikiDoc, search: ChatSearch): boolean {
  return !(search.scope === 'PPM' && search.ppmDetail !== 'btvplus' && doc.code === BTVPLUS_ONLY_DOC)
}

/**
 * PPM 세부 상품에 맞지 않는 줄. B tv+ 면 지상파·종편 줄을, 그 외 월정액이면 B tv+ 전용 줄을 뺀다.
 * 세부를 모르면 둘 다 빼 PPM 공통 줄만 남긴다 — "B tv+ 및 월정액별"처럼 둘 다 해당하는 줄은 남는다.
 */
function offDetail(lower: string, search: ChatSearch): boolean {
  if (search.scope !== 'PPM') return false
  const terrestrial = lower.includes('지상파') || lower.includes('종편')
  const btvplusOnly = lower.includes('b tv+') && !lower.includes('ppm') && !lower.includes('월정액별')
  if (search.ppmDetail === 'btvplus') return terrestrial
  if (search.ppmDetail === 'ppm-other') return btvplusOnly
  return terrestrial || btvplusOnly
}

function keepUsable(lines: string[], search: ChatSearch, limit: number): string[] {
  const other = search.scope === 'PPV' ? SCOPE_ONLY_TERMS.PPM : search.scope === 'PPM' ? SCOPE_ONLY_TERMS.PPV : []
  return lines
    .filter((line) => !GAP_MARKERS.some((m) => line.includes(m)))
    .filter((line) => !offDetail(line.toLowerCase(), search))
    .filter((line) => {
      const lower = line.toLowerCase()
      if (!other.length) return true
      const mine = (SCOPE_ONLY_TERMS[search.scope as ProductScope] ?? []).some((t) => lower.includes(t))
      return mine || !other.some((t) => lower.includes(t))
    })
    .slice(0, limit)
}

function usableSentences(doc: WikiDoc, search: ChatSearch, limit: number): string[] {
  return keepUsable(extractSentences(doc, search, limit + 3), search, limit)
}

/**
 * 절차 질문에 쓸 소제목 조각. 질문이 소제목에 걸린 문서가 있으면 그 조각을 **순서대로** 돌려준다.
 * 예: "마케팅 프로세스 설명해줄래?" → `프로모션 운영 프로세스 (Step 1~6)` 조각.
 */
function usableSequence(doc: WikiDoc, search: ChatSearch): { section: DocSection; lines: string[] } | null {
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
  const fixLine = '· 기존 문서는 그 문서 화면의 **✎ 고치기**(또는 장 제목 옆 **✎ 이 장 고치기**)에서 고칩니다.'
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

/** 결과물 요청에 규칙 기반이 하는 말 — 지어내지 못한다고 먼저 밝히고, 위키 기준만 짚는다 */
const DELIVERABLE_LEAD: Record<DeliverableKind, string> = {
  copy: '지금은 규칙 기반으로 답하고 있어 카피 후보를 직접 만들 수 없습니다. 대신 위키의 카피 기준을 짚어 드립니다.',
  name: '지금은 규칙 기반으로 답하고 있어 이벤트명 후보를 직접 만들 수 없습니다. 대신 위키의 카피 기준을 짚어 드립니다.',
  placement: '지금은 규칙 기반으로 답하고 있어 구좌를 골라 드리지는 못하고, 위키 조합표에서 맞는 줄을 보여 드립니다.',
}
const DELIVERABLE_TAIL: Record<DeliverableKind, string> = {
  copy: 'AI 답변 엔진이 연결되면 같은 질문으로 방향이 다른 카피 3안을 받을 수 있습니다.',
  name: 'AI 답변 엔진이 연결되면 같은 질문으로 이벤트명 후보 3개를 받을 수 있습니다.',
  placement: 'AI 답변 엔진이 연결되면 같은 질문으로 구좌 2~3개와 고른 이유를 받을 수 있습니다.',
}

/** 플레이북 조합표에서 구좌를 고르는 칸 — 이 두 칸이 "어디에 띄우나"의 답이다 */
const PLACEMENT_ROWS = ['편성 영역', '필수 배너']

/**
 * 플레이북(MKI-05)에서 해당 상품 절의 조합 하나. 상품 절 아래 번호 붙은 소제목 중 질문과 가장 맞는 것을,
 * 없으면 그 상품의 첫 조합을 쓴다.
 */
function playbookCombo(doc: WikiDoc, search: ChatSearch): { heading: string; lines: string[] } | null {
  const sections = parseSections(doc.body)
  const start = sections.findIndex((s) => s.heading.startsWith(`${search.scope} `))
  if (start < 0) return null
  const combos: DocSection[] = []
  for (const s of sections.slice(start + 1)) {
    if (!/^\d+\./.test(s.heading)) break
    combos.push(s)
  }
  if (combos.length === 0) return null
  const terms = tokenize(search.query)
  const fit = (c: DocSection) => terms.filter((t) => c.heading.toLowerCase().includes(t)).length
  const combo = combos.reduce((best, c) => (fit(c) > fit(best) ? c : best))
  const rows = combo.lines.filter((l) => PLACEMENT_ROWS.some((r) => l.startsWith(r)))
  const lines = keepUsable(rows, search, 2)
  return lines.length ? { heading: combo.heading, lines } : null
}

/** 소개·관련 문서·갱신 절 — 기준이 아니라 문서를 설명하는 말이라 결과물 기준으로 옮기지 않는다 */
const META_HEADINGS = ['', '이 문서는', '관련 문서', '다음에 볼 문서', '갱신 기준']

/**
 * 카피 가이드에서 기준 줄을 고른다. 머리말·소개·관련 문서 절과 적용대상 줄은 빼고, 질문 단어가 많이 걸린 줄을 앞에 둔다.
 * 걸리는 줄이 없으면 문서 순서대로 — 가이드는 앞 절일수록 공통 원칙이다.
 */
function guideLines(doc: WikiDoc, search: ChatSearch, limit: number): string[] {
  const terms = tokenize(search.query)
  const lines = parseSections(doc.body)
    .filter((s) => !META_HEADINGS.includes(s.heading))
    .flatMap((s) => s.lines)
    .filter((l) => l.length > 5 && !l.startsWith('적용대상'))
  const score = (l: string) => terms.filter((t) => l.toLowerCase().includes(t)).length
  const ranked = lines.map((l, i) => ({ l, i, s: score(l) })).sort((a, b) => b.s - a.s || a.i - b.i)
  return keepUsable(
    ranked.map((x) => x.l),
    search,
    limit,
  )
}

function deliverableReply(kind: DeliverableKind, query: string, history: ChatTurn[], slots: CampaignSlots): AssistantReply {
  const scope = slots.product?.scope ?? null
  const search: ChatSearch = {
    query,
    context: [userText(history), slots.ppmDetail === 'btvplus' ? 'B tv+' : ''].filter(Boolean).join('\n'),
    scope,
    ppmDetail: slots.ppmDetail,
    preferSubcategory: kind === 'placement' ? ['insight', 'banner-spec'] : ['copy-guide'],
  }
  const byCode = (code: string) => docs.find((d) => d.code === code)
  const lines = [DELIVERABLE_LEAD[kind]]
  const used: WikiDoc[] = []

  if (kind === 'placement') {
    const playbook = scope ? byCode('MKI-05') : undefined
    const combo = playbook ? playbookCombo(playbook, search) : null
    if (playbook && combo) {
      used.push(playbook)
      lines.push(`**${playbook.title}** (${playbook.code}) — ${combo.heading}`)
      for (const l of combo.lines) lines.push(`· ${l}`)
    } else {
      const overview = byCode('MKI-B-00')
      const sentences = overview ? usableSentences(overview, search, 2) : []
      if (overview && sentences.length) {
        used.push(overview)
        lines.push(`**${overview.title}** (${overview.code})`)
        for (const l of sentences) lines.push(`· ${l}`)
      }
    }
  } else {
    // 영화 PPV 카피 가이드는 영화 PPV 에만 — 월정액은 전용 가이드가 없어 공통 원칙으로 답한다
    const moviePpv = scope === 'PPV' || (!scope && /영화|ppv/i.test(query))
    const guide = byCode(moviePpv ? 'MKI-C-02' : 'MKI-C-01')
    const check = scope === 'PPM' ? byCode('MKI-C-04') : undefined
    // 월정액이면 기준 하나를 정가 전환 고지로 쓴다 — 다크패턴 규제 검수가 월정액에만 붙는다
    const notice = check
      ? keepUsable(findSection(check, '규제 검수')?.lines.filter((l) => l.includes('정가 전환')) ?? [], search, 1)
      : []
    const sentences = guide ? guideLines(guide, search, notice.length ? 1 : 2) : []
    if (guide && sentences.length) {
      used.push(guide)
      lines.push(`**${guide.title}** (${guide.code})`)
      for (const l of sentences) lines.push(`· ${l}`)
      if (check && notice.length) {
        used.push(check)
        lines.push(`· ${notice[0]}`)
      }
    }
  }

  lines.push(DELIVERABLE_TAIL[kind])
  return { text: lines.join('\n'), sources: used.map((d) => ({ docId: d.id, label: `출처 · ${d.title}` })) }
}

export function answer(query: string, history: ChatTurn[] = [], intentAsked = false): AssistantReply {
  const turns: ChatTurn[] = [...history, { role: 'user', text: query }]

  // 문서를 쓰거나 고치겠다는 발화에 검색 문장을 쏟으면 관계없는 정책이 답처럼 보인다 — 제출 화면만 짧게 안내한다.
  const edit = detectKnowledgeEdit(query)
  if (edit) return knowledgeEditReply(query, edit)

  // 카피·이벤트명·구좌를 만들어 달라는 말에는 진행 확인·정리 카드 대신 결과물의 기준부터 답한다
  const deliverable = detectDeliverable(query)
  if (deliverable) return deliverableReply(deliverable, query, history, readSlots(turns))

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
  const search: ChatSearch = {
    query,
    // B tv+ 를 골랐으면 B tv+ 조합·타겟 그룹 문서가 먼저 오게 맥락에 덧붙인다
    context: [userText(history), slots.ppmDetail === 'btvplus' ? 'B tv+' : ''].filter(Boolean).join('\n'),
    scope: slots.product?.scope ?? null,
    ppmDetail: slots.ppmDetail,
    // 판단을 물으면 정책 문서보다 마케팅 인사이트·카피 가이드(타겟팅·플레이북·카피 등)가 답에 가깝다
    preferSubcategory: advice ? ['insight', 'copy-guide'] : null,
    preferCategory: wantsHubHowTo(query) ? ['guide'] : null,
    avoidCategory: wantsBusinessEdit(query) ? ['guide'] : null,
  }
  let found = searchDocs(search).filter((h) => docUsable(h.doc, search))
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
    // 2순위는 1순위에 견줄 만큼 맞을 때만 붙인다 — 점수가 한참 처지는 문서의 문장은 답을 흐린다
    for (const hit of hits.slice(0, 2)) {
      if (used.length > 0 && hit.score < used[0].score * SECOND_SOURCE_RATIO && !namedInQuery(hit.doc, query)) continue
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

/**
 * 엔진 응답을 기다리는 한도 — 넘기면 다음 엔진, 마지막엔 규칙 기반으로 넘어간다.
 * 그동안 대화창에는 "답을 정리하는 중…" 안내가 떠 있으므로, 서버 함수 한도(300초)까지 붙잡지 않고 엔진별로 끊는다.
 * Gemini는 위키 전체를 systemInstruction 으로 넣어 평소에도 20~40초가 걸려 30초 한도로는 자주 끊겼다.
 * CLI는 서버 중계 한도(claude 120초 · codex 180초)보다 길게 잡아 서버가 돌려주는 실패 사유를 받는다.
 */
export const ENGINE_TIMEOUT_MS: Record<Engine, number> = { claude: 150_000, codex: 210_000, gemini: 90_000 }

/** 대화창 대기 안내에 쓰는 평소 소요 시간 — 수정 제안 화면의 AI_WAIT_HINT 와 같은 실측 기준이다 */
export const ENGINE_WAIT_HINT: Record<Engine, string> = { claude: '30초~1분', codex: '1~2분', gemini: '20~40초' }

/** 리포트로 갈 수 있는 요청이면 CLI 는 리포트 한도로 기다린다 — 짧은 Q&A 한도(150초)에 리포트가 끊기지 않게 */
export function engineTimeoutMs(engine: Engine, query: string, modeOverride?: 'qa' | 'report'): number {
  return engine !== 'gemini' && mayBeReport(query, modeOverride) ? REPORT_TIMEOUT_MS[engine] : ENGINE_TIMEOUT_MS[engine]
}

/** 리포트 요청이 실패했다 — 다른 엔진으로 넘기면 Gemini 안내나 규칙 기반 짧은 답이 리포트 자리에 와서, 칩으로 고르게 멈춘다 */
class ReportFailureError extends Error {
  constructor(
    readonly code: EngineFailureCode,
    readonly timeoutMs: number | null,
    message: string,
  ) {
    super(message)
  }
}

/** 사용자가 「그만하고 짧게 답 받기」로 끊었다 */
class CancelledError extends Error {}

export interface AskOptions {
  /** 칩으로 고른 모드 — 그 질문 한 번에만 서버 판정보다 우선한다 */
  modeOverride?: 'qa' | 'report'
  /** 화면이 요청을 끊는 신호 — 끊으면 서버가 CLI 를 정리한다 */
  signal?: AbortSignal
  /** 대화 기록 묶음 — 같은 대화(chatId)·같은 질문(turnId). 엔진을 넘겨 다시 시도해도 같은 turnId 를 쓴다 */
  chatId?: string
  turnId?: string
  /** 칩으로 다시 물은 경로(참고값) — 직접 친 질문이면 없다 */
  via?: string
}

async function askEngine(
  query: string,
  engine: Engine,
  history: ChatTurn[],
  intentAsked: boolean,
  opts: AskOptions,
): Promise<AssistantReply> {
  const ctrl = new AbortController()
  const limit = engineTimeoutMs(engine, query, opts.modeOverride)
  const timer = setTimeout(() => ctrl.abort(), limit)
  const cancel = () => ctrl.abort()
  opts.signal?.addEventListener('abort', cancel)
  try {
    return await requestEngine(query, engine, history, intentAsked, ctrl.signal, opts)
  } catch (err) {
    if (opts.signal?.aborted) throw new CancelledError('사용자가 요청을 끊었습니다')
    if (ctrl.signal.aborted) {
      // 리포트 한도로 기다린 요청이면 리포트가 늦은 것이다 — 짧은 답 받기 칩으로 고르게 한다
      if (limit !== ENGINE_TIMEOUT_MS[engine]) throw new ReportFailureError('timeout', limit - 30_000, `${limit / 1000}초 안에 리포트가 오지 않아 중단했습니다`)
      // 그냥 "aborted"로는 왜 규칙 기반으로 떨어졌는지 알 수 없다 — 시간 초과로 분류해 넘긴다
      throw new EngineFailureError('timeout', `${limit / 1000}초 안에 응답이 없어 중단했습니다`)
    }
    throw err
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', cancel)
  }
}

/**
 * 서버가 쓰는 만큼만 보낸다 — 최근 12턴, 뒤에서부터 합쳐 8,000자(server/knowledge.ts parseAskInput 과 같은 규칙).
 * 긴 대화의 전체 이력을 보내면 요청 크기 상한(64KB)에 걸린다. 리포트 턴은 text 가 3줄 요약이라 요약만 넘어간다
 */
function recentHistory(history: ChatTurn[]): ChatTurn[] {
  const kept: ChatTurn[] = []
  let chars = 0
  for (const turn of history.slice(-12).reverse()) {
    const text = turn.text.trim()
    if (!text) continue
    chars += text.length
    if (chars > 8000) break
    kept.unshift(turn)
  }
  return kept
}

interface AskResponseBody {
  mode?: 'qa' | 'report' | 'report-unavailable'
  text: string
  sourcePaths: string[]
  reportHint?: 'offer' | 'local-only'
  notice?: string
  report?: ChatReport
}

async function requestEngine(
  query: string,
  engine: Engine,
  history: ChatTurn[],
  intentAsked: boolean,
  signal: AbortSignal,
  opts: AskOptions,
): Promise<AssistantReply> {
  const { modeOverride, chatId, turnId } = opts
  // 서버 규칙(40자)을 넘으면 서버가 버린다 — 앞부분만 보낸다
  const via = opts.via?.slice(0, 40)
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      engine,
      history: recentHistory(history),
      ...(modeOverride ? { modeOverride } : {}),
      ...(chatId ? { chatId } : {}),
      ...(turnId ? { turnId } : {}),
      ...(via ? { via } : {}),
    }),
    signal,
  })
  if (!res.ok) {
    // 서버는 실패를 { error, code } 로 돌려준다. 화면은 code 로 안내를 고르고 error 는 console 에만 둔다
    const body = (await res.json().catch(() => null)) as { error?: string; code?: string; mode?: string; timeoutMs?: number } | null
    const failure = failureFromResponse(res.status, body)
    if (body?.mode === 'report') throw new ReportFailureError(failure.code, body.timeoutMs ?? null, failure.message)
    throw failure
  }
  const data = (await res.json()) as AskResponseBody

  const sources: SourceRef[] = data.sourcePaths
    .map((p) => docs.find((d) => d.path === p.replace(/\\/g, '/').replace(/^\.?\//, '')))
    .filter((d): d is (typeof docs)[number] => Boolean(d))
    .map((d) => ({ docId: d.id, label: `출처 · ${d.title}` }))

  if (data.mode === 'report' && data.report) {
    // 리포트는 근거 문서를 카드 안에 따로 보여 준다 — 진행 확인 칩은 붙이지 않는다
    return { text: data.text, sources: [], report: data.report, answeredBy: ENGINE_LABEL[engine] }
  }
  return {
    text: data.text,
    sources,
    // 조건 카드 대신 진행 의사부터 확인한다 — 엔진이 무슨 답을 했든 확인 여부는 대화 상태로 정한다.
    intent: data.mode === 'report-unavailable' ? undefined : intentPromptFor(query, intentAsked),
    answeredBy: ENGINE_LABEL[engine],
    reportHint: data.reportHint,
    notice: data.notice,
  }
}

/** 리포트를 못 만들었을 때의 한 줄 — 짧은 답은 칩으로 고른다 */
function reportFailureText(err: ReportFailureError): string {
  if (err.code === 'timeout') {
    const minutes = err.timeoutMs ? Math.round(err.timeoutMs / 60_000) : null
    return `리포트가 ${minutes ? `${minutes}분 안에` : '제한 시간 안에'} 끝나지 않았습니다. 짧은 답이 필요하면 [짧게 답 받기]를 눌러 주세요.`
  }
  const [cause, action] = FAILURE_CAUSE[err.code]
  return `${cause} 리포트를 만들지 못했습니다. ${action === 'retry' ? '잠시 후 다시 물어보시거나, ' : `${ADMIN_ACTION[action]} `}짧은 답이 필요하면 [짧게 답 받기]를 눌러 주세요.`
}

/** 대화에서 이미 붙인 확인 — 결과물·판단 답 아래 상품·세부 상품 확인은 대화당 한 번이다 */
export interface RefineAsked {
  product: boolean
  detail: boolean
}

/**
 * 결과물·판단 요청 답 아래에 붙이는 확인. 답은 공통 기준으로 먼저 하고, 상품이나 PPM 세부 상품을 고르면
 * 같은 요청을 그 기준으로 다시 보낸다. 사실·절차 질문에는 붙이지 않는다 — PPM 정책은 세부 상품과 관계없이 같다.
 */
function withRefine(reply: AssistantReply, query: string, turns: ChatTurn[], asked: RefineAsked): AssistantReply {
  if (reply.intent || reply.report || reply.reportFailed || reply.cancelled) return reply
  const deliverable = Boolean(detectDeliverable(query))
  const slots = readSlots(turns)
  if (deliverable && !slots.product && !asked.product)
    return { ...reply, intent: { kind: 'product-qa', question: INTENT_PRODUCT_RETRY_QUESTION, retry: query } }
  if ((deliverable || wantsAdvice(query)) && slots.product?.scope === 'PPM' && !slots.ppmDetail && !asked.detail)
    return { ...reply, intent: { kind: 'ppm-detail', question: PPM_DETAIL_QUESTION, retry: query } }
  return reply
}

/**
 * 쓸 수 있는 엔진을 순서대로 시도한다 — 선택한 CLI가 실패하면 다음 엔진(예: Gemini)으로 넘어간다.
 * 모두 없거나 실패하면 규칙 기반 answer()로 대체해 누구나 쓸 수 있게 한다.
 * 리포트 요청이 실패하면 넘기지 않고 멈춘다 — 사용자가 짧은 답을 받을지 고른다
 */
export async function askAssistant(
  query: string,
  engines: Engine[],
  history: ChatTurn[] = [],
  intentAsked = false,
  nextAsked = false,
  refineAsked: RefineAsked = { product: false, detail: false },
  opts: AskOptions = {},
): Promise<AssistantReply> {
  const turns: ChatTurn[] = [...history, { role: 'user', text: query }]
  /**
   * 방향을 정한 턴에는 엔진이 무슨 말을 했든 **뼈대 카드와 다음 단계**를 붙인다 —
   * 카피·구좌 추천을 먼저 받을지, 바로 프로모션 자동화로 넘길지는 사용자가 고른다.
   */
  const withNextStep = (reply: AssistantReply): AssistantReply => {
    if (reply.intent || reply.report || reply.reportFailed || reply.cancelled) return reply
    const next = nextStepPromptFor(query, nextAsked)
    if (!next) return reply
    return { ...reply, intent: next, brief: reply.brief ?? readBrief(turns) }
  }
  const settle = (reply: AssistantReply) => withRefine(withNextStep(reply), query, turns, refineAsked)

  const failed: EngineFailure[] = []
  for (const engine of engines) {
    try {
      const reply = await askEngine(query, engine, history, intentAsked, opts)
      if (!failed.length) return settle(reply)
      // 답은 정상이다 — 앞선 실패는 엔진 이름만 남기고 사유는 console 에 둔다
      const names = failed.map((f) => ENGINE_LABEL[f.engine]).join('·')
      return settle({ ...reply, answeredBy: `${reply.answeredBy} (${names} 응답 실패)`, fallback: failed })
    } catch (err) {
      if (err instanceof CancelledError) return { text: '', sources: [], cancelled: true }
      if (err instanceof ReportFailureError) {
        console.info(`[assistant] ${ENGINE_LABEL[engine]} 리포트 실패 (${err.code}):`, err.message)
        return { text: reportFailureText(err), sources: [], reportFailed: true, answeredBy: ENGINE_LABEL[engine] }
      }
      const code = failureCode(err)
      console.info(`[assistant] ${ENGINE_LABEL[engine]} 응답 실패 (${code}):`, (err as Error).message)
      failed.push({ engine, code })
    }
  }
  return settle({
    ...answer(query, history, intentAsked),
    answeredBy: RULE_BASED_LABEL,
    fallback: failed.length ? failed : undefined,
  })
}


export interface AiEditResult {
  body: string
  summary: string
  /** 수정한 엔진 — 앞선 엔진이 실패했으면 함께 적는다 */
  by: string
  /** 장 단위 — 엔진이 다른 장까지 써 와서 서버가 그 장만 잘라 냈다 */
  trimmed?: boolean
}

/** 장 단위 AI 수정 입력(/api/edit 의 section) — 장 원문과 문서 장 제목 순서만 보내 빠르게 */
export interface AiEditSection {
  /** 그 장 원문 — `## ` 제목 줄부터 다음 장 앞까지. 머리말은 첫 `## ` 앞 */
  body: string
  /** 장 제목(머리말은 '') */
  title: string
  anchor: string
  outline: string[]
}

/**
 * 문서 편집 모드의 장 도구줄 "AI에게 부탁". 쓸 수 있는 엔진을 순서대로 시도해 고친 본문(장 하나를 보내면 그 장)을 받는다.
 * 규칙 기반 대체는 없다 — 모두 실패하면 마지막 오류를 throw 한다.
 */
export async function requestAiEdit(
  doc: Pick<WikiDoc, 'title' | 'code' | 'path'>,
  body: string,
  instruction: string,
  engines: Engine[],
  /** 있으면 body 는 문서 전체, 돌려받는 body 는 이 장만 */
  section?: AiEditSection,
): Promise<AiEditResult> {
  if (engines.length === 0) throw new Error('쓸 수 있는 AI 엔진이 없습니다')
  const failed: string[] = []
  let lastCode: EngineFailureCode = 'unknown'
  for (const engine of engines) {
    try {
      const res = await fetch('/api/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engine, title: doc.title, code: doc.code, path: doc.path, body, instruction, ...(section ? { section } : {}) }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        body?: string
        summary?: string
        error?: string
        code?: string
        section?: { trimmed?: boolean }
      }
      if (!res.ok) throw failureFromResponse(res.status, data)
      if (typeof data.body !== 'string') throw new EngineFailureError('invalid', data.error || '본문 없는 응답')
      const label = ENGINE_LABEL[engine]
      return {
        body: data.body,
        summary: data.summary ?? '',
        by: failed.length ? `${label} (${failed.join('·')} 실패)` : label,
        trimmed: data.section?.trimmed === true,
      }
    } catch (err) {
      lastCode = failureCode(err)
      console.info(`[ai-edit] ${ENGINE_LABEL[engine]} 실패 (${lastCode}):`, (err as Error).message)
      failed.push(ENGINE_LABEL[engine])
    }
  }
  // 원문 사유는 위 console 에만 — 화면에는 분류된 한 줄만 보인다
  throw new Error(editFailureText(lastCode))
}

export function makeMessage(role: ChatMessage['role'], text: string, extra?: Partial<ChatMessage>): ChatMessage {
  return { id: newId('msg'), role, text, ...extra }
}

/** '프로모션 기획 시작하기' 버튼이 보내는 첫 발화 — 진행 의도 확인 흐름을 그대로 탄다. */
export const PLAN_STARTER = '프로모션을 기획하려고 해'

export const SUGGESTED_QUESTIONS = [
  'B tv 마케팅 프로세스 알려줘',
  '마케팅 효율이 좋은 B tv 구좌는 어디야?',
  '위키 문서는 어떻게 수정해?',
  '신규 편성·스케줄은 어떻게 반영해?',
  '시스템 바로가기는 어떻게 수정하거나 추가해?',
  '모바일 B tv 마케팅 프로세스 알려줘',
  '모바일 B tv 외부연동 규격 알려줘',
]
