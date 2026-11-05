import type { ProposalPr, WikiDoc } from '../types'

export interface EditProposalResult {
  prUrl: string
  prNumber: number
  /** PR 이 올리는 새 버전 — 머지 후 다음 배포부터 위키에 이 번호로 보인다 */
  version: number
}

/**
 * 문서 "✎ 수정 제안" — 서버가 GitHub 에 브랜치를 만들고 기존 파일을 고쳐 PR 을 연다.
 * 프론트매터(version·updatedBy·updatedAt)는 서버가 main 의 파일에서 다시 쓰므로 본문만 보낸다.
 * 실패하면 서버 메시지 원문(409 "문서를 다시 열어 수정해 주세요" 포함)을 그대로 던진다.
 */
export async function requestDocEdit(
  doc: Pick<WikiDoc, 'path' | 'code' | 'title' | 'version'>,
  body: string,
  reason: string,
  requestedBy: string,
  via: 'propose' | 'chat' = 'propose',
): Promise<EditProposalResult> {
  const res = await fetch('/api/proposeEdit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      docPath: doc.path,
      code: doc.code,
      title: doc.title,
      body,
      reason,
      requestedBy,
      baseVersion: doc.version,
      via,
    }),
  })
  const data = (await res.json().catch(() => ({}))) as Partial<EditProposalResult> & { error?: string }
  if (!res.ok || !data.prUrl) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status })
  return { prUrl: data.prUrl, prNumber: data.prNumber!, version: data.version! }
}

/** 허브가 올린 문서 PR 목록 — 진실의 원천은 GitHub 이다 */
export async function fetchProposals(): Promise<ProposalPr[]> {
  const res = await fetch('/api/proposals')
  const data = (await res.json().catch(() => ({}))) as { proposals?: ProposalPr[]; error?: string }
  if (!res.ok || !Array.isArray(data.proposals)) throw new Error(data.error || `HTTP ${res.status}`)
  return data.proposals
}
