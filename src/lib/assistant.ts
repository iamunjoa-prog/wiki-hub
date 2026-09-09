import { docs } from '../data/docs'
import type { CampaignDraft, ChatMessage, SourceRef, WikiDoc } from '../types'
import { extractSentences, searchDocs } from './retrieval'

const GENRES = ['예능', '드라마', '영화', '키즈', '스포츠']
const CAMPAIGN_HINTS = ['캠페인', '프로모션', '집행', '광고', '마케팅 진행']
const INTENT_HINTS = ['가능', '진행', '하고', '해도', '할까', '돌리', '집행', '띄우', '준비']

let seq = 0
export const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${seq++}`

export function detectCampaignIntent(query: string): boolean {
  const hasCampaign = CAMPAIGN_HINTS.some((k) => query.includes(k))
  const hasIntent = INTENT_HINTS.some((k) => query.includes(k))
  return hasCampaign && hasIntent
}

function detectGenre(query: string): string | null {
  return GENRES.find((g) => query.includes(g)) ?? null
}

/** MKT-P-03 예산 표에서 장르별 표준 예산을 읽는다. */
function budgetFromPolicy(genre: string, policyDoc: WikiDoc | undefined): string {
  if (!policyDoc) return ''
  const row = policyDoc.body
    .split('\n')
    .find((l) => l.startsWith('|') && l.includes(genre) && l.includes('만 원'))
  if (!row) return ''
  const cells = row.split('|').map((c) => c.trim())
  return cells[2] ?? ''
}

/** 장르 인사이트 문서에서 권장 캠페인 구간(MM/DD 시작 – MM/DD 종료)을 읽는다. */
function periodFromInsight(genre: string): { start: string; end: string } | null {
  const insight = docs.find((d) => d.category === 'insight' && d.title.includes(genre))
  if (!insight) return null
  const m = insight.body.match(/(\d{2})\/(\d{2})\s*시작\s*[–\-~]\s*(\d{2})\/(\d{2})\s*종료/)
  if (!m) return null
  const year = new Date().getFullYear()
  return { start: `${year}-${m[1]}-${m[2]}`, end: `${year}-${m[3]}-${m[4]}` }
}

/** MKT-P-03 "노출 누적 3주 원칙"에 따른 기본 기간. */
function defaultPeriod(): { start: string; end: string } {
  const start = new Date()
  start.setDate(start.getDate() + 7)
  const end = new Date(start)
  end.setDate(end.getDate() + 20)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
}

export function buildCampaignDraft(query: string): CampaignDraft {
  const genre = detectGenre(query) ?? '예능'
  const policyDoc = docs.find((d) => d.code === 'MKT-P-03')
  const period = periodFromInsight(genre) ?? defaultPeriod()
  const budget = budgetFromPolicy(genre, policyDoc) || '3,000만 원'

  const policyRefs = [policyDoc?.code, docs.find((d) => d.category === 'insight' && d.title.includes(genre))?.code]
    .filter((c): c is string => Boolean(c))

  return {
    target: `신규 세그먼트 × ${genre}`,
    periodStart: period.start,
    periodEnd: period.end,
    budget,
    policyRefs,
    note: '',
  }
}

export interface AssistantReply {
  text: string
  sources: SourceRef[]
  campaign?: CampaignDraft
}

export function answer(query: string): AssistantReply {
  const hits = searchDocs(query).slice(0, 3)

  if (hits.length === 0) {
    return {
      text:
        '담당 범위(편성·마케팅 정책, 장르별 인사이트, 등록된 GNB 편성표) 안에서 근거 문서를 찾지 못했습니다.\n' +
        '장르명이나 정책 코드(예: 예능, MKT-P-03)를 함께 넣어 다시 물어봐 주세요.',
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

export function makeMessage(role: ChatMessage['role'], text: string, extra?: Partial<ChatMessage>): ChatMessage {
  return { id: newId('msg'), role, text, ...extra }
}

export const SUGGESTED_QUESTIONS = [
  '9월 예능 신규 시청자 캠페인 가능해?',
  '신규 유입 캠페인 기간은 최소 얼마야?',
  '예능 표준 예산이 얼마지?',
  '주말 편성 슬롯 구성 알려줘',
]
