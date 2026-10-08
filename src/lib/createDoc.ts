import type { CategoryId, ProductScope, WikiDoc } from '../types'

export interface NewDocInput {
  category: CategoryId
  subcategory: string | null
  title: string
  scope: ProductScope | '공통'
  body: string
}

export interface NewDocResult {
  prUrl: string
  code: string
  path: string
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
  const data = (await res.json().catch(() => ({}))) as Partial<NewDocResult> & { error?: string }
  if (!res.ok || !data.prUrl) throw new Error(data.error || `HTTP ${res.status}`)
  return { prUrl: data.prUrl, code: data.code!, path: data.path! }
}
