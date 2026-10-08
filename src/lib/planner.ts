import type { IntentPrompt, ProductScope, PromotionBrief } from '../types'

/**
 * "여기서 기획부터" — 챗봇이 프로모션 뼈대를 한 가지씩 물어 채운다.
 * 상품 → 형태 → 기간 → 이벤트명 순서이고, 다 모이면 정리 카드를 보여 주고
 * 인사이트·정책에 맞춘 이벤트명·카피 추천을 받을지 묻는다. 세부 조건은 프로모션 자동화(어드민)에서 잇는다.
 *
 * 첫 답에 정책·인사이트 문서를 쏟아내지 않으려는 것이다 — 무엇을 만들지 정해지기 전에는 어떤 문서가 맞는지도 모른다.
 */

export type Track = 'PPM' | 'PPV' | 'BTV+'

export const TRACK_LABEL: Record<Track, string> = { PPM: 'PPM(월정액)', PPV: 'PPV(단건)', 'BTV+': 'B tv+' }

/**
 * 상품별 진행 형태 — 프로모션 > 마케팅 인사이트 › 프로모션 혜택 스킴(MKI-03) 문서의 표기를 그대로 쓴다.
 * PPV는 "PPV 혜택 방식" 표, PPM·B tv+는 "이벤트 방식별 조합" 표.
 */
export const FORMS: Record<Track, string[]> = {
  PPV: ['단순 홍보', '할인쿠폰 선발급', '할인쿠폰 다운로드', '구매자 경품', '쿠폰 + 경품', '시즌 특가(묶음 할인)'],
  PPM: ['할인 단독', '할인 + 전원 경품', '할인 + 추첨 경품'],
  'BTV+': ['할인 단독', '할인 + 전원 경품', '할인 + 추첨 경품'],
}

export type PlanStep = 'track' | 'form' | 'period' | 'name' | 'review'

export interface PlanState {
  step: PlanStep
  track?: Track
  form?: string
  period?: string
  name?: string
}

/** 이 단계는 입력창에 적은 말을 답으로 받는다 */
export const TEXT_STEPS: PlanStep[] = ['form', 'period', 'name']

const ORDER: PlanStep[] = ['track', 'form', 'period', 'name', 'review']

/** 앞 대화에서 이미 말한 값은 다시 묻지 않는다 — 채워진 단계는 건너뛴다 */
function advance(plan: PlanState): PlanState {
  let i = ORDER.indexOf(plan.step)
  const filled = (s: PlanStep) =>
    (s === 'track' && plan.track) || (s === 'form' && plan.form !== undefined) ||
    (s === 'period' && plan.period !== undefined) || (s === 'name' && plan.name !== undefined)
  while (ORDER[i] !== 'review' && filled(ORDER[i])) i++
  return { ...plan, step: ORDER[i] }
}

/** 기획을 시작한다. 대화에서 이미 읽힌 상품·형태·기간·이벤트명이 있으면 채운 채로 시작한다 */
export function startPlan(known: Partial<Omit<PlanState, 'step'>>): PlanState {
  return advance({ step: 'track', ...known })
}

/** 현재 단계의 답을 받는다. 빈 문자열은 "아직 미정·건너뛰기" */
export function applyAnswer(plan: PlanState, value: string): PlanState {
  const v = value.trim()
  switch (plan.step) {
    case 'track':
      return advance({ ...plan, track: (['PPM', 'PPV', 'BTV+'] as Track[]).find((t) => t === v) ?? plan.track })
    case 'form':
      return advance({ ...plan, form: v })
    case 'period':
      return advance({ ...plan, period: v })
    case 'name':
      return advance({ ...plan, name: v })
    case 'review':
      return plan
  }
}

/** 질문 칩에 쓰는 값 — 건너뛰기 */
export const SKIP = ''

export function planQuestion(plan: PlanState): IntentPrompt {
  const label = plan.track ? TRACK_LABEL[plan.track] : ''
  switch (plan.step) {
    case 'track':
      return {
        kind: 'plan',
        question: '어떤 상품의 프로모션인가요?',
        choices: (Object.keys(TRACK_LABEL) as Track[]).map((t) => ({ label: TRACK_LABEL[t], value: t })),
      }
    case 'form':
      return {
        kind: 'plan',
        question: `${label} 프로모션은 어떤 형태로 진행할까요? 목록에 없으면 입력창에 적어 주세요.`,
        choices: [...(plan.track ? FORMS[plan.track] : []).map((f) => ({ label: f, value: f })), { label: '아직 모르겠어요', value: SKIP }],
      }
    case 'period':
      return {
        kind: 'plan',
        question: '이벤트 기간은 언제인가요? 입력창에 적어 주세요. (예: 10월 10일 ~ 10월 19일)',
        choices: [{ label: '아직 미정', value: SKIP }],
      }
    case 'name':
      return {
        kind: 'plan',
        question: '이벤트명은 정하셨나요? 입력창에 적어 주시거나, 다음 단계에서 추천받으셔도 됩니다.',
        choices: [{ label: '추천받을게요', value: SKIP }],
      }
    case 'review':
      return {
        kind: 'plan',
        question: '인사이트·정책에 맞게 이벤트명과 카피를 추천해 드릴까요?',
        choices: [
          { label: '이벤트명·카피 추천받기', value: 'recommend' },
          { label: '프로모션 자동화로 연결', value: 'handoff' },
          { label: '조금 더 정리할게요', value: 'later' },
        ],
      }
  }
}

export function planBrief(plan: PlanState): PromotionBrief {
  return {
    product: plan.track ? TRACK_LABEL[plan.track] : '',
    name: plan.name ?? '',
    period: plan.period ?? '',
    scheme: plan.form ?? '',
    channel: '',
  }
}

/** 어드민 상품 유형 — B tv+는 따로 고르는 칸이 없어 비워 보낸다 */
export const planScope = (plan: PlanState): ProductScope | undefined =>
  plan.track === 'PPM' || plan.track === 'PPV' ? plan.track : undefined

/** "추천받기"가 대신 보내는 질문 — 정리한 조건을 모두 담아 엔진이 문서 근거로 답하게 한다 */
export function recommendRequest(plan: PlanState): string {
  const parts = [
    plan.track && TRACK_LABEL[plan.track],
    plan.form && `${plan.form} 형태`,
    plan.period && `기간 ${plan.period}`,
    plan.name ? `이벤트명 "${plan.name}"` : null,
  ].filter(Boolean)
  const what = plan.name ? '카피를' : '이벤트명과 카피를'
  return `${parts.join(', ')} 프로모션입니다. 인사이트·정책에 맞게 ${what} 추천해줘`
}
