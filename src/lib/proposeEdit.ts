import type { ProposalPr, PublicHit, WikiDoc } from '../types'
import { throwIfPublicLeak } from './publicCheck'

export interface EditProposalResult {
  prUrl: string
  prNumber: number
  /** PR 이 올리는 새 버전 — 머지 후 다음 배포부터 위키에 이 번호로 보인다 */
  version: number
}

/**
 * 409 — 화면이 본 버전 뒤에 다른 제안이 먼저 머지됐다(대개 배포 전). 서버가 실어 준 최신 버전·본문을 그대로 든다.
 * 옛 서버라 본문이 없으면 mainBody 가 null — 화면은 다시 얹지 않고 다음 배포 뒤 다시 열라고 안내한다(requests-doc-edit.md 4-3)
 */
export class StaleDocError extends Error {
  readonly status = 409
  constructor(
    message: string,
    readonly mainVersion: number | null,
    readonly mainBody: string | null,
  ) {
    super(message)
    this.name = 'StaleDocError'
  }
}

export interface DocVersion {
  version: number
  body: string
}

/**
 * 편집 진입 때 main 의 최신 버전·본문(/api/docVersion) — 화면 묶음이 재배포 전이라 낡았어도 제출 409 를 미리 막는다(doc-editing 2-6).
 * 어떤 이유로든 못 읽으면 null — 화면은 묻지 않고 묶음 본문으로 고친다(제출 때 409 흐름이 뒤를 받친다)
 */
export async function fetchDocVersion(path: string): Promise<DocVersion | null> {
  try {
    const res = await fetch(`/api/docVersion?path=${encodeURIComponent(path)}`, { headers: { Accept: 'application/json' } })
    if (!res.ok) return null
    const data = (await res.json()) as { version?: unknown; body?: unknown }
    if (typeof data.version !== 'number' || typeof data.body !== 'string') return null
    return { version: data.version, body: data.body.replace(/\r\n?/g, '\n') }
  } catch {
    return null
  }
}

/**
 * 문서 "✎ 수정 제안" — 서버가 GitHub 에 브랜치를 만들고 기존 파일을 고쳐 PR 을 연다.
 * 프론트매터(version·updatedBy·updatedAt)는 서버가 main 의 파일에서 다시 쓰므로 본문만 보낸다.
 * 공개 규칙에 막히면(400 public-leak) PublicLeakError, 409 는 StaleDocError, 그 밖의 실패는 서버 메시지 원문에 status 를 붙여 던진다.
 * doc.version 은 이 본문을 고칠 때 기준으로 삼은 버전이다 — 409 뒤 최신본 위에 다시 얹었으면 그 버전을 넘긴다
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
  const data = (await res.json().catch(() => ({}))) as Partial<EditProposalResult> & {
    error?: string
    code?: string
    blocks?: PublicHit[]
    mainVersion?: unknown
    mainBody?: unknown
  }
  throwIfPublicLeak(res.status, data)
  if (res.status === 409)
    throw new StaleDocError(
      data.error || 'HTTP 409',
      typeof data.mainVersion === 'number' ? data.mainVersion : null,
      typeof data.mainBody === 'string' ? data.mainBody : null,
    )
  if (!res.ok || !data.prUrl) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status })
  return { prUrl: data.prUrl, prNumber: data.prNumber!, version: data.version! }
}

/**
 * 제출 실패 한 줄 — 서버 원문(HTTP 상태·GitHub 오류·환경변수 이름)은 실무자에게 보이지 않게 상태 코드로 문장을 고른다
 * (requests-chat-draft.md 5-8, 끝말은 requests-doc-edit.md 5-2 대로 「수정은 그대로 있습니다.」). 관리자에게만 끝에 HTTP 상태
 */
export function editSubmitFailureText(err: unknown, admin: boolean): string {
  const status = (err as { status?: number }).status
  const message = (err as Error).message ?? ''
  const tail = ' 수정은 그대로 있습니다.'
  let text: string
  if (status === 400)
    text = /변경 사항이 없습니다/.test(message) ? '바뀐 곳이 없어 제출하지 않았습니다.' : `제출하지 못했습니다 — ${message.replace(/[.\s]+$/, '')}.${tail}`
  else if (status === 401) text = `로그인이 끝났습니다. 다시 로그인한 뒤 [다시 제출]을 눌러 주세요.${tail}`
  else if (status === 404) text = `이 문서를 저장소에서 찾지 못했습니다. 옮겨졌거나 지워졌을 수 있습니다. 관리자에게 알려 주세요.${tail}`
  else if (status === 413) text = `내용이 너무 깁니다. 고친 장을 나눠 다시 제출해 주세요.${tail}`
  else if (status === 429) text = `오늘 올릴 수 있는 제안 수(하루 30건)를 넘었습니다. 내일 다시 제출해 주세요.${tail}`
  else if (status === 503) text = `지금은 제안을 올릴 수 없습니다(허브 설정 문제). 관리자에게 알려 주세요.${tail}`
  else text = `GitHub에 제안을 올리지 못했습니다. 잠시 뒤 [다시 제출]을 눌러 주세요. 계속되면 관리자에게 알려 주세요.${tail}`
  return admin && status ? `${text} · HTTP ${status}` : text
}

/** 허브가 올린 문서 PR 목록 — 진실의 원천은 GitHub 이다 */
export async function fetchProposals(): Promise<ProposalPr[]> {
  const res = await fetch('/api/proposals')
  const data = (await res.json().catch(() => ({}))) as { proposals?: ProposalPr[]; error?: string }
  if (!res.ok || !Array.isArray(data.proposals)) throw new Error(data.error || `HTTP ${res.status}`)
  return data.proposals
}
