export type Role = 'member' | 'admin'

export interface Session {
  userId: string
  name: string
  team: string
  role: Role
  /** 허브 계정 아이디. 로그인 없는 데모 모드에서는 없다 */
  loginId?: string
}

export type CategoryId = 'programming' | 'promotion' | 'system' | 'guide'

export interface Category {
  id: CategoryId
  label: string
  /** 문서가 0건이어도 막지 않고 열어 둔다 — 첫 문서를 모으는 중인 카테고리(베타) */
  open?: boolean
}

/** 카테고리 아래 2단 메뉴 — 서브메뉴가 없는 카테고리(시스템·이용 안내)는 등록하지 않는다 */
export interface Subcategory {
  id: string
  label: string
}

export interface WikiDoc {
  id: string
  path: string
  title: string
  category: CategoryId
  /** 카테고리 아래 서브메뉴. 서브메뉴가 없는 카테고리 소속이면 null */
  subcategory: string | null
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

/**
 * 문서 제안 — 진실의 원천은 GitHub PR 이다 (`/api/proposals`).
 * 서버가 PR 본문을 읽어 채우며, 읽지 못한 값은 빈 문자열·null 로 남는다 (추측해 채우지 않는다).
 */
export interface ProposalPr {
  prNumber: number
  prUrl: string
  kind: 'new' | 'edit'
  docCode: string | null
  docTitle: string
  reason: string
  requestedBy: string
  status: ProposalStatus
  requestedAt: string
  /** 진입 이름(`챗봇 리포트` 등) — PR 본문 `- 진입:` 줄. 그 줄이 없는 옛 PR 이면 null */
  via?: string | null
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
  /**
   * `product` 는 어드민으로 넘기기 직전 확인,
   * `product-qa` 는 질문만 받을 때의 확인 — 고르면 그 기준 문서로만 답한다 (어드민은 열지 않는다).
   * `ppm-detail` 은 PPM 안의 세부 상품(B tv+ / 지상파·종편·CP 월정액) 확인이다.
   */
  kind: 'confirm' | 'product' | 'product-qa' | 'ppm-detail' | 'next'
  question: string
  /** 답을 받은 뒤 붙인 확인이면 그 원래 질문 — 고르면 고른 기준을 앞에 붙여 다시 보낸다 */
  retry?: string
}

/**
 * 대화에서 모인 프로모션 뼈대. 어드민으로 넘기기 전에 **이 세 가지**를 눈으로 확인한다 —
 * 이벤트명·기간·스킴. 확인하지 못한 칸은 빈 값으로 두고 '미정'으로 보여 준다.
 */
export interface PromotionBrief {
  /** 상품 유형 라벨 (예: 'PPV(단건)') */
  product: string
  name: string
  period: string
  scheme: string
  channel: string
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

/** 답변 엔진·AI 계정을 묻는 질문의 주제 — 답 끝 행동 버튼을 고르는 데 쓴다 (assistant-engine-guide 3-1) */
export type EngineTopic = 'about' | 'which' | 'benefit' | 'connect' | 'trouble' | 'compare' | 'short' | 'tips'

/**
 * 엔진 실패 분류 — 서버 502 의 `code` 와 같은 값. `config` 는 code 없이 온 503·500(키 미설정·배포 구성 누락)을
 * 화면에서 붙인 것이다. `maintenance`(운영 점검 503)·`rate`(호출 횟수 초과 429)는 서버 입구(server/guard.ts)가 준다.
 * 안내 문구는 이 코드로 고르고 원문 사유는 화면에 두지 않는다.
 */
export type EngineFailureCode =
  | 'overloaded'
  | 'quota'
  | 'network'
  | 'timeout'
  | 'auth'
  | 'model'
  | 'invalid'
  | 'unknown'
  | 'config'
  | 'maintenance'
  | 'rate'
  /** 장 단위 AI 수정에서 엔진이 장 밖까지 바꿔 와 그 장을 골라낼 수 없었다(/api/edit 422) */
  | 'outside'

export interface EngineFailure {
  engine: Engine
  code: EngineFailureCode
}

export interface EngineStatus {
  installed: boolean
  loggedIn: boolean
}

/** 공개 규칙 검사에 걸린 곳 — server/publicCheck.ts Hit 와 같은 모양. text 는 사용자가 쓴 글자 중 걸린 부분만 */
export interface PublicHit {
  kind: 'amount' | 'name' | 'doubleStar' | 'company' | 'url' | 'email' | 'phone' | 'todo' | 'figure'
  where: 'title' | 'body' | 'reason'
  line: number | null
  text: string
}

export interface PublicCheckResult {
  blocks: PublicHit[]
  warnings: PublicHit[]
  /** 비공개 이름 목록으로 이름 검사를 했는지 — 목록이 연결되지 않았으면 false */
  namesChecked: boolean
}

export type ReportType = 'compare' | 'audit' | 'insight' | 'brief'

/** 리포트 — server/knowledge.ts ReportReply 와 같은 모양 */
export interface ChatReport {
  title: string
  summary: string
  markdown: string
  reportType: ReportType
  claims: { text: string; basis: 'wiki' | 'external' | 'inference'; refs: string[] }[]
  sourcePaths: string[]
  externalSources: { title: string; url: string; accessedAt: string }[]
  searchQueries: string[]
  gaps: string[]
  webSearch: boolean
  webSearchOff: 'engine' | 'terms' | 'type' | null
  masked: { amount: number; name: number }
  warnings: PublicHit[]
}

/**
 * 리포트 카드의 위키 반영 단계 (docs/sections/requests-report.md 8-1).
 * checking 공개 검사 중 · handed 새 문서 화면으로 넘김 · blocked 차단 항목 · halted 이름 목록 없음 · failed 검사 실패 · submitted 제출됨
 */
export type ReportReflect =
  | { stage: 'checking' }
  | { stage: 'handed' }
  | { stage: 'blocked'; check: PublicCheckResult }
  | { stage: 'halted' }
  | { stage: 'failed' }
  | { stage: 'submitted'; code: string; prNumber: number }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  /** 칩으로 다시 보낸 질문이면 그 칩 이름 — 사용자 말풍선 위에 작게 보인다 */
  via?: string
  /** 이 답을 만든 질문 — 「리포트로 자세히 받기」·「짧게 답 받기」가 같은 질문을 다시 보낸다 */
  query?: string
  /** 리포트 답 — 있으면 말풍선의 text 는 3줄 요약이고 아래에 리포트 카드를 붙인다 */
  report?: ChatReport
  /** 리포트를 만든 엔진 이름과 시각 — .md 저장 머리·반영본 "이 문서는" 문단에 쓴다 */
  reportMeta?: { engine: string; createdAt: string }
  reportReflect?: ReportReflect
  /** offer: 짧은 답 아래 「리포트로 자세히 받기」 칩 · local-only: 칩 없이 notice 한 줄 */
  reportHint?: 'offer' | 'local-only'
  /** 서버가 붙인 안내 한 줄 (로컬 허브 CLI 에서만 리포트가 된다 등) */
  notice?: string
  /** 리포트를 만들지 못했다 — 「짧게 답 받기」 칩만 붙인다 */
  reportFailed?: boolean
  sources?: SourceRef[]
  campaign?: CampaignDraft
  /** 지금까지 정리된 프로모션 뼈대 — 이벤트명·기간·스킴 */
  brief?: PromotionBrief
  /** 이 답변에 붙는 진행 의도 확인 — 사용자가 답하면 사라진다 */
  intent?: IntentPrompt
  /** 확인에 이미 답했으면 그 답 (버튼 대신 선택한 값을 보여준다) */
  intentAnswer?: string
  answeredBy?: string
  /** 이 답 전에 실패한 엔진들 — 없던 시절 메시지는 answeredBy 만 있으므로 비어 있어도 그린다 */
  fallback?: EngineFailure[]
  /** 답변 엔진 안내 답이면 그 주제 — 버튼은 저장하지 않고 그릴 때 지금 상태로 고른다 */
  engineTopic?: EngineTopic
  /** 「내 계정으로 다시 묻기」를 이미 눌렀다 — 같은 답에 칩을 다시 붙이지 않는다 */
  askedAgain?: boolean
}

/** 시스템 메뉴의 구분 — 편성 관련 / 마케팅 관련 */
export type SystemGroupId = 'programming' | 'marketing'

/** 시스템에 접속할 수 있는 망 — 둘 중 하나에서만 열린다 */
export type SystemAccess = '로컬 전용' | '클라우드 전용'

/** 시스템 메뉴 카드 — 즐겨찾기하면 대시보드 '자주 사용하는 시스템'에 올라간다 */
export interface SystemEntry {
  id: string
  name: string
  desc: string
  access: SystemAccess
  group: SystemGroupId
  /** 주소를 아직 못 받은 시스템은 비워 둔다 — 카드가 링크 대신 'URL 미등록'으로 뜬다 */
  url?: string
}

/**
 * 담당자가 직접 올린 시스템 등록 요청. 승인되면 공용 목록(`systems`)에 합쳐져 모두에게 보인다.
 *
 * 사내 시스템 주소는 저장소에 두지 않기로 해서, 주소는 코드가 아니라 이 요청으로만 들어온다.
 * `targetSystemId` 가 있으면 새 카드가 아니라 그 시스템의 주소를 채우는 요청이다.
 */
export interface SystemRequest {
  id: string
  /** 주소만 채우는 요청이면 그 시스템 id */
  targetSystemId?: string
  name: string
  desc: string
  url: string
  access: SystemAccess
  group: SystemGroupId
  status: ProposalStatus
  rejectReason?: string
  requestedBy: string
  requestedAt: string
}

/**
 * 내 PC 허브의 새 버전 확인 결과 (GET /api/hubVersion). 배포본에는 이 경로가 없다.
 * reason — no-version: 자동 업데이트 전에 받은 허브, git-checkout: 개발용 폴더, offline: 확인 못 함
 */
export interface HubVersionInfo {
  current: string | null
  latest: string | null
  updateAvailable: boolean
  checkedAt: string
  reason?: 'no-version' | 'git-checkout' | 'offline'
}
