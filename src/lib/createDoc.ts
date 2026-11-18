import type { CategoryId, ProductScope, PublicHit, WikiDoc } from '../types'
import type { DocVia } from './publicCheck'

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

/** 서버 검사에 막힌 제출(400 public-leak) — 아무것도 올라가지 않았다. 화면이 blocks 로 빨강 상자를 다시 그린다 */
export class PublicLeakError extends Error {
  constructor(readonly blocks: PublicHit[]) {
    super('공개 저장소에 올릴 수 없는 표현이 있습니다')
    this.name = 'PublicLeakError'
  }
}

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
  if (res.status === 400 && data.code === 'public-leak' && Array.isArray(data.blocks)) throw new PublicLeakError(data.blocks)
  if (!res.ok || !data.prUrl) throw new Error(data.error || `HTTP ${res.status}`)
  return { prUrl: data.prUrl, prNumber: data.prNumber ?? 0, code: data.code!, path: data.path! }
}
