import type { CampaignDraft } from '../types'

/** 외부 프로모션 자동화(어드민) 화면 */
export const CAMPAIGN_URL = 'https://btvcuration.github.io/campaign/'

/**
 * 어드민 화면에 조건을 실어 보낸다. 대화에서 파악하지 못한 항목은 **빈 값으로 둔다** —
 * 값을 지어내면 어드민에서 잘못된 값을 지우는 일이 더 번거롭다.
 */
export function buildCampaignUrl(draft: CampaignDraft): string {
  const params = new URLSearchParams({ source: 'wiki-hub' })
  const put = (key: string, value: string) => {
    if (value.trim()) params.set(key, value.trim())
  }
  put('target', draft.target)
  put('periodStart', draft.periodStart)
  put('periodEnd', draft.periodEnd)
  put('channel', draft.channel)
  put('targetCount', draft.targetCount)
  put('policyRefs', draft.policyRefs.join(','))
  put('note', draft.note)
  return `${CAMPAIGN_URL}?${params.toString()}`
}
