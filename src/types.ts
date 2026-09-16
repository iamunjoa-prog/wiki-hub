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
  /** 적용 상품 — 프론트매터 `scope`. 챗봇이 반대 상품 문서를 근거로 집지 않게 하는 데 쓴다 */
  scope?: ProductScope | '공통'
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

/** 편성/스케줄 › 홈 하위 플랫폼 */
export type SheetPlatform = 'btv' | 'mobile'

export interface Sheet {
  id: string
  name: string
  type: SheetType
  url: string
  gnb: string
  /** 홈 GNB 편성표만 — B tv / 모바일 B tv 구분 */
  platform?: SheetPlatform
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

/** PPC 상품 유형 — 어드민으로 넘기기 전에 이것만 확인한다 */
export type ProductScope = 'PPM' | 'PPV'

/**
 * 프로모션 진행 의도 확인 — 조건 카드를 먼저 들이밀지 않고, 진행할 의사인지부터 묻는다.
 * `confirm` 에 '네'가 오면 `product` 로 넘어가고, 상품 유형까지 고르면 어드민 화면으로 보낸다.
 */
export interface IntentPrompt {
  kind: 'confirm' | 'product'
  question: string
}

export interface SourceRef {
  docId: string
  label: string
  anchor?: string
}

/** 어시스턴트 답변에 쓰는 로컬 CLI */
export type Engine = 'claude' | 'codex' | 'gemini'

/** 로그인·설치가 필요한 로컬 CLI 엔진 (Gemini는 서버의 API 키로 동작) */
export type CliEngine = Exclude<Engine, 'gemini'>

export interface EngineStatus {
  installed: boolean
  loggedIn: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  sources?: SourceRef[]
  campaign?: CampaignDraft
  /** 이 답변에 붙는 진행 의도 확인 — 사용자가 답하면 사라진다 */
  intent?: IntentPrompt
  /** 확인에 이미 답했으면 그 답 (버튼 대신 선택한 값을 보여준다) */
  intentAnswer?: string
  answeredBy?: string
}
