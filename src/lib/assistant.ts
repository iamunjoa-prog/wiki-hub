import { docs } from '../data/docs'
import type { CampaignDraft, ChatMessage, Engine, SourceRef } from '../types'
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

const CAMPAIGN_HINTS = ['캠페인', '프로모션', '집행', '발송', '쿠폰 발급']
const INTENT_HINTS = ['가능', '진행', '하고', '해도', '할까', '돌리', '집행', '띄우', '준비', '만들']

let seq = 0
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${seq++}`

export function detectCampaignIntent(query: string): boolean {
  const hasCampaign = CAMPAIGN_HINTS.some((k) => query.includes(k))
  const hasIntent = INTENT_HINTS.some((k) => query.includes(k))
  return hasCampaign && hasIntent
}

function detectProduct(query: string) {
  const q = query.toLowerCase()
  return PRODUCTS.find((p) => p.keywords.some((k) => q.includes(k))) ?? null
}

function detectChannel(query: string): string | null {
  const q = query.toLowerCase()
  return CHANNELS.find((c) => c.keywords.some((k) => q.includes(k)))?.label ?? null
}

/** "50만", "3만명" 같은 표현에서 타겟 모수를 읽는다. */
function detectTargetCount(query: string): string | null {
  const m = query.match(/([\d,.]+)\s*(만|천)?\s*(명|건)?/)
  if (!m || !m[1] || !m[2]) return null
  return `${m[1]}${m[2]}`
}

/** 운영 프로세스 Step 1의 기본 리드타임 — 품의·쿠폰 생성·공지에 필요한 최소 준비 기간. */
function defaultPeriod(): { start: string; end: string } {
  const start = new Date()
  start.setDate(start.getDate() + 14)
  const end = new Date(start)
  end.setDate(end.getDate() + 13)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

export function buildCampaignDraft(query: string): CampaignDraft {
  const product = detectProduct(query) ?? PRODUCTS[0]
  const channel = detectChannel(query) ?? '타겟배너'
  const period = defaultPeriod()

  // 운영 프로세스(PPC-P-01)와 상품별 정책은 항상 근거로 붙인다.
  const policyRefs = ['PPC-P-01', product.policyCode]
  if (channel) policyRefs.push('PPC-P-04')

  return {
    target: `${product.label} 대상 · ${channel}`,
    periodStart: period.start,
    periodEnd: period.end,
    channel,
    targetCount: detectTargetCount(query) ?? '',
    policyRefs: policyRefs.filter((c) => docs.some((d) => d.code === c)),
    note: '발송 Capa(배너 일 300만 / 쿠폰 시간당 12만 / TV팝업 노드당 90만)와 일정 중복은 캠페인 스케줄에서 확인 필요',
  }
}

export interface AssistantReply {
  text: string
  sources: SourceRef[]
  campaign?: CampaignDraft
  /** 답을 만든 쪽 — 화면 하단 라벨로 보여준다 */
  answeredBy?: string
}

export const ENGINE_LABEL: Record<Engine, string> = { claude: 'Claude', codex: 'Codex' }

/** 로컬 dev 서버에 설치된 CLI 목록. 배포본처럼 경로가 없으면 null — 선택 버튼을 숨긴다. */
export async function fetchEngines(): Promise<Record<Engine, boolean> | null> {
  try {
    const res = await fetch('/api/engines')
    if (!res.ok || !res.headers.get('content-type')?.includes('application/json')) return null
    return (await res.json()) as Record<Engine, boolean>
  } catch {
    return null
  }
}

export function answer(query: string): AssistantReply {
  const hits = searchDocs(query).slice(0, 3)

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
    const sentences = extractSentences(hit.doc, query, 2)
    if (sentences.length === 0) continue
    lines.push(`**${hit.doc.title}** (${hit.doc.code})`)
    for (const s of sentences) lines.push(`· ${s}`)
  }

  const sources: SourceRef[] = hits.map((h) => ({
    docId: h.doc.id,
    label: `출처 · ${h.doc.title}`,
  }))

  const campaign = detectCampaignIntent(query) ? buildCampaignDraft(query) : undefined

  let text = lines.join('\n')
  if (campaign) {
    text += `\n\n정책 기준으로 캠페인 조건을 아래와 같이 정리했습니다. 확인 후 진행해 주세요.`
  }

  return { text, sources, campaign }
}

/**
 * 로컬 dev 서버의 /api/ask(Claude Code·Codex CLI 중계)로 답을 받는다.
 * 경로가 없거나(배포본·CLI 미설치) 실패하면 규칙 기반 answer()로 대체해 누구나 쓸 수 있게 한다.
 */
export async function askAssistant(query: string, engine: Engine | null): Promise<AssistantReply> {
  if (!engine) return { ...answer(query), answeredBy: '규칙 기반' }
  try {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, engine }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { text: string; sourcePaths: string[] }

    const sources: SourceRef[] = data.sourcePaths
      .map((p) => docs.find((d) => d.path === p.replace(/\\/g, '/').replace(/^\.?\//, '')))
      .filter((d): d is (typeof docs)[number] => Boolean(d))
      .map((d) => ({ docId: d.id, label: `출처 · ${d.title}` }))

    const campaign = detectCampaignIntent(query) ? buildCampaignDraft(query) : undefined
    return { text: data.text, sources, campaign, answeredBy: ENGINE_LABEL[engine] }
  } catch (err) {
    console.info(`[assistant] ${ENGINE_LABEL[engine]} 응답 실패 — 규칙 기반 답변 사용:`, (err as Error).message)
    return { ...answer(query), answeredBy: `규칙 기반 (${ENGINE_LABEL[engine]} 응답 실패)` }
  }
}

export function makeMessage(role: ChatMessage['role'], text: string, extra?: Partial<ChatMessage>): ChatMessage {
  return { id: newId('msg'), role, text, ...extra }
}

export const SUGGESTED_QUESTIONS = [
  '월정액 할인 쿠폰 캠페인 배너로 진행 가능해?',
  '판촉용 쿠폰 품의는 누구 결재가 필요해?',
  'CBS에서 승인요청 버튼이 안 눌려',
  '전환동의 팝업은 어느 UI 버전부터 돼?',
]
