export type Role = 'member' | 'admin'

export interface Session {
  userId: string
  name: string
  team: string
  role: Role
}

export type CategoryId = 'programming' | 'promotion' | 'system' | 'guide'

export interface Category {
  id: CategoryId
  label: string
}

export interface WikiDoc {
  id: string
  path: string
  title: string
  category: CategoryId
  /** 문서 코드 — 챗봇 근거 정책 참조에 사용 (예: MKT-P-03) */
  code: string
  body: string
  version: number
  updatedBy: string
  updatedAt: string
  ownerId: string
}

export interface DocCommit {
  version: number
  author: string
  at: string
  message: string
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected'

export interface Proposal {
  id: string
  docId: string
  docTitle: string
  baseVersion: number
  newBody: string
  reason: string
  status: ProposalStatus
  rejectReason?: string
  requestedBy: string
  requestedAt: string
}

export type SheetType = 'sheet' | 'screen'

export interface Sheet {
  id: string
  name: string
  type: SheetType
  url: string
  gnb: string
  ownerId: string
  ownerName: string
  periodStart: string
  periodEnd: string
  description: string
  lastCheckedAt: string
  /** 미리보기 임베드 차단 여부 (데모용 고정 플래그) */
  embedBlocked?: boolean
}

export interface Promotion {
  id: string
  sheetId: string
  sheetName: string
  targetCategory: CategoryId | null
  status: ProposalStatus
  rejectReason?: string
  requestedBy: string
  requestedAt: string
}

export interface CampaignDraft {
  target: string
  periodStart: string
  periodEnd: string
  /** 발송 채널 — 타겟배너 / TV팝업 / 스마트알림 / 토스트팝업 */
  channel: string
  /** 전체 타겟수 — 캠페인 발송 Capa 확인의 기준값 */
  targetCount: string
  policyRefs: string[]
  note: string
}

export interface SourceRef {
  docId: string
  label: string
  anchor?: string
}

/** 어시스턴트 답변에 쓰는 로컬 CLI */
export type Engine = 'claude' | 'codex'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  sources?: SourceRef[]
  campaign?: CampaignDraft
  answeredBy?: string
}
