import type { CategoryId, ProductScope, PublicHit, WikiDoc } from '../types'
import { PublicLeakError, throwIfPublicLeak, type DocVia } from './publicCheck'

export interface NewDocInput {
  category: CategoryId
  subcategory: string | null
  title: string
  scope: ProductScope | '공통'
  body: string
  /** 어디서 시작한 문서인지 — PR 본문 `- 진입:` 줄과 서버 검사 기준(리포트 반영이면 금액 차단)을 가른다 */
  via: DocVia
  /** 승인자가 읽는 등록 사유 — 비면 PR 본문에 절이 생기지 않는다 */
  reason: string
}

export interface NewDocResult {
  prUrl: string
  /** 서버가 2026-11-18 부터 함께 돌려준다 — 이전 서버면 0 */
  prNumber: number
  code: string
  path: string
}

// 수정 제안도 같은 차단을 받으므로 publicCheck 에 두고 여기서는 이어서 내보낸다
export { PublicLeakError }

/**
 * 위키 문서 목록 "+ 새 문서" — 서버가 GitHub에 브랜치·PR을 만든다.
 * 같은 서브메뉴 문서들의 코드를 함께 보내면 서버가 다음 번호를 이어서 매긴다.
 */
export async function requestNewDoc(input: NewDocInput, docs: WikiDoc[], requestedBy: string): Promise<NewDocResult> {
  const siblingCodes = docs
    .filter((d) => d.category === input.category && d.subcategory === input.subcategory)
    .map((d) => d.code)

  const res = await fetch('/api/createDoc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, requestedBy, siblingCodes }),
  })
  const data = (await res.json().catch(() => ({}))) as Partial<NewDocResult> & {
    error?: string
    code?: string
    blocks?: PublicHit[]
  }
  throwIfPublicLeak(res.status, data)
  if (!res.ok || !data.prUrl) throw new Error(data.error || `HTTP ${res.status}`)
  return { prUrl: data.prUrl, prNumber: data.prNumber ?? 0, code: data.code!, path: data.path! }
}
