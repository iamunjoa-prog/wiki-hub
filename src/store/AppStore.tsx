import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../components/AuthGate'
import { docs as seedDocs } from '../data/docs'
import { initialPromotions, sheets as seedSheets } from '../data/sheets'
import { defaultFavoriteSystems, systems as seedSystems } from '../data/systems'
import {
  askAssistant,
  buildCampaignDraft,
  detectCampaignIntent,
  detectDecision,
  ENGINE_PRIORITY,
  fetchEngines,
  INTENT_PRODUCT_QA_QUESTION,
  INTENT_PRODUCT_QUESTION,
  makeMessage,
  NEXT_STEP_QUESTION,
  newId,
  PPM_DETAIL_QUESTION,
  ppmDetailLabel,
  readBrief,
  readSlots,
  type PpmDetail,
} from '../lib/assistant'
import { buildCampaignUrl } from '../lib/campaignLink'
import { fetchProposals } from '../lib/proposeEdit'
import { requestPublicCheck } from '../lib/publicCheck'
import {
  buildReflectDraft,
  detectReportReflect,
  isShortAnswerRequest,
  mayBeReport,
  questionOf,
  readPrefill,
  REFLECT_EXISTING_TEXT,
  REFLECT_FIX_TEXT,
  REFLECT_HOW_TEXT,
  reflectStartText,
  savePrefill,
  type NewDocPrefill,
} from '../lib/report'
import {
  EMPTY_SYSTEMS_STATE,
  fetchSystemsState,
  postSystemsAction,
  reduceSystems,
  type SystemsAction,
  type SystemsState,
} from '../lib/systemsStore'
import type {
  CampaignDraft,
  CategoryId,
  ChatMessage,
  Engine,
  EngineStatus,
  ProductScope,
  Promotion,
  ProposalPr,
  PublicCheckResult,
  Role,
  Session,
  Sheet,
  SystemEntry,
  SystemRequest,
  WikiDoc,
} from '../types'

const LS_ROLE = 'wikihub.role'
const LS_FAVORITE_SYSTEMS = 'wikihub.favoriteSystems'
const LS_DOCK = 'wikihub.dockOpen'
const LS_ENGINE = 'wikihub.engine'

interface AssistantState {
  open: boolean
  messages: ChatMessage[]
  pending: boolean
  /** 기다리는 요청이 리포트로 갈 수 있는지 — 대기 문구·「그만하고 짧게 답 받기」를 고른다 */
  pendingReport: boolean
  /** 기다리기 시작한 시각(ms) — 경과 시간 표시용 */
  pendingSince: number | null
  campaignDraft: CampaignDraft | null
  /** 엔진별 상태 — 로컬 허브는 CLI+Gemini, 배포 허브는 Gemini만. 확인 전이면 undefined, 서버 경로가 없으면 null */
  engineStatus: Partial<Record<Engine, EngineStatus>> | null | undefined
  /** 답변에 쓸 수 있는(설치 + 로그인/키) 엔진. 서버 경로가 없으면 null */
  engines: Partial<Record<Engine, boolean>> | null
  /** 실제로 답변에 쓸 CLI — 선택한 CLI가 없으면 설치된 다른 CLI, 둘 다 없으면 null(규칙 기반) */
  engine: Engine | null
  /** 선택한 엔진 → 나머지 순으로 시도할 엔진 목록 */
  usableEngines: Engine[]
}

interface AppState {
  session: Session
  docs: WikiDoc[]
  sheets: Sheet[]
  /** 문서 제안(= GitHub PR). null 이면 아직 못 읽은 것 — 빈 목록과 다르다 */
  proposals: ProposalPr[] | null
  proposalsError: string | null
  proposalsLoading: boolean
  promotions: Promotion[]
  systems: SystemEntry[]
  systemRequests: SystemRequest[]
  /** 대시보드 '자주 사용하는 시스템'에 올릴 시스템 id */
  favoriteSystems: string[]
  /**
   * 시스템 목록이 어디에 쌓이는지.
   * `shared` 팀 공유 파일 · `local` 이 PC 파일(공유 안 됨) · `memory` 저장 없음(새로고침하면 사라짐)
   */
  systemsStorage: 'shared' | 'local' | 'memory'
  assistant: AssistantState
  toast: string | null

  setRole: (role: Role) => void
  showToast: (msg: string) => void

  openDock: () => void
  closeDock: () => void
  /** 독을 열고 빈칸 채워 질문하기 패널을 그 틀로 연다 — 대시보드 카드처럼 독 밖에서 여는 길 */
  openQuestionTemplate: (templateId: string) => void
  /** 독이 아직 받지 않은 패널 열기 요청. n 은 같은 틀을 다시 눌러도 독이 알아차리게 하는 순번 */
  questionTemplateRequest: { id: string; n: number } | null
  /** 독이 요청을 받아 패널을 연 뒤 지운다 — 독을 닫았다 다시 열 때 패널이 또 열리지 않게 */
  clearQuestionTemplateRequest: () => void
  ask: (query: string, opts?: AskOpts) => void
  /** 같은 질문을 리포트(report) 또는 짧은 답(qa)으로 다시 받는다 — 그 질문 한 번에만 적용된다 */
  askAgain: (messageId: string, mode: 'qa' | 'report') => void
  /** 기다리는 리포트를 끊고 같은 질문을 짧은 답으로 다시 받는다 */
  cancelReport: () => void
  /** 리포트를 위키 새 문서로 올릴 준비 — 반영본을 만들어 공개 검사를 돌리고, 통과하면 새 문서 화면을 채워 연다 */
  startReflect: (messageId: string) => void
  /** 새 문서 화면을 리포트 내용으로 다시 연다 (검사 결과가 있으면 함께 넘긴다) */
  openReflectEditor: (messageId: string) => void
  /** 반영 단계 상자를 닫는다 */
  closeReflect: (messageId: string) => void
  /** 새 문서 화면에서 제출이 성공하면 출처 리포트 카드에 결과 한 줄을 남긴다 */
  markReportSubmitted: (messageId: string, code: string, prNumber: number) => void
  /** 진행 의도 확인에 답한다 — '네'면 상품 유형만 더 묻고 어드민 화면을 연다 */
  resolveIntent: (messageId: string, choice: IntentChoice) => void
  setEngine: (engine: Engine) => void
  refreshEngines: () => Promise<void>
  setCampaignDraft: (draft: CampaignDraft | null) => void

  /** 이미 읽었으면 다시 부르지 않는다 — 화면이 진입할 때 한 번 부르는 용도 */
  ensureProposals: () => void
  /** GitHub PR 목록을 다시 읽는다 (수동 새로고침) */
  refreshProposals: () => Promise<void>

  /** 별표 토글 — 켜는 순간 대시보드에 올라간다 */
  toggleFavoriteSystem: (id: string) => void
  /** 주소가 빈 시스템에 접속 주소를 채워 달라고 요청한다 — 승인되면 모두에게 보인다 */
  requestSystemUrl: (systemId: string, url: string) => void
  submitSystemRequest: (
    input: Omit<SystemRequest, 'id' | 'status' | 'requestedBy' | 'requestedAt'>,
  ) => void
  decideSystemRequest: (
    id: string,
    decision: 'approved' | 'rejected',
    reason?: string,
  ) => Promise<void>

  addSheet: (sheet: Omit<Sheet, 'id' | 'ownerId' | 'ownerName' | 'lastCheckedAt'>) => void
  requestPromotion: (sheetId: string) => void
  decidePromotion: (
    id: string,
    decision: 'approved' | 'rejected',
    opts: { category?: CategoryId; reason?: string },
  ) => Promise<void>
}

/**
 * 확인 버튼이 돌려주는 값.
 * `yes`·`no`·상품 유형은 진행 의도 확인, 나머지는 방향을 정한 뒤의 다음 단계다.
 */
export type IntentChoice = 'yes' | 'no' | ProductScope | PpmDetail | 'copy' | 'placement' | 'handoff' | 'later'

const INTENT_ANSWER_LABEL: Record<IntentChoice, string> = {
  yes: '네, 진행할게요',
  no: '아니요, 질문만 할게요',
  PPM: '월정액(PPM)',
  PPV: '단건(PPV)',
  btvplus: 'B tv+',
  'ppm-other': '지상파·종편·CP 월정액',
  copy: '카피 추천 먼저',
  placement: '노출 구좌 추천 먼저',
  handoff: '프로모션 자동화로 연결',
  later: '조금 더 정리할게요',
}

/** 추천 버튼이 대신 보내는 질문 — 근거 문서를 타도록 평소 질문과 같은 경로로 보낸다 */
const COPY_REQUEST = '지금 정리한 프로모션 기준으로 카피 후보를 추천해줘'
const PLACEMENT_REQUEST = '지금 정리한 프로모션 기준으로 노출 구좌를 추천해줘'

interface AskOpts {
  modeOverride?: 'qa' | 'report'
  /** 칩으로 보낸 질문이면 칩 이름 — 사용자 말풍선에 작게 보인다 */
  via?: string
}

const Ctx = createContext<AppState | null>(null)

const today = () => new Date().toISOString().slice(0, 10)

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(
    () => (localStorage.getItem(LS_ROLE) as Role) || 'member',
  )
  const [docs, setDocs] = useState<WikiDoc[]>(seedDocs)
  const [sheets, setSheets] = useState<Sheet[]>(seedSheets)
  const [proposals, setProposals] = useState<ProposalPr[] | null>(null)
  const [proposalsError, setProposalsError] = useState<string | null>(null)
  const [proposalsLoading, setProposalsLoading] = useState(false)
  const [promotions, setPromotions] = useState<Promotion[]>(initialPromotions)
  /**
   * 시스템 목록은 팀 공유 파일 하나에 모인다 (로컬 허브가 읽고 쓴다).
   * 저장소가 없는 배포본에서는 `remote` 가 null 로 남고 메모리 상태로 같은 화면을 보여 준다.
   */
  const [remote, setRemote] = useState<SystemsState | null>(null)
  const [memory, setMemory] = useState<SystemsState>(EMPTY_SYSTEMS_STATE)
  const systemsState = remote ?? memory
  const [favoriteSystems, setFavoriteSystems] = useState<string[]>(() => {
    const saved = localStorage.getItem(LS_FAVORITE_SYSTEMS)
    // 저장된 값이 없을 때만 기본값을 쓴다 — 전부 해제한 상태는 그 자체로 존중한다
    if (saved === null) return defaultFavoriteSystems
    try {
      const parsed = JSON.parse(saved)
      return Array.isArray(parsed) ? (parsed as string[]) : defaultFavoriteSystems
    } catch {
      return defaultFavoriteSystems
    }
  })
  const [toast, setToast] = useState<string | null>(null)

  const [dockOpen, setDockOpen] = useState<boolean>(
    () => localStorage.getItem(LS_DOCK) === '1',
  )
  const [questionTemplateRequest, setQuestionTemplateRequest] = useState<{ id: string; n: number } | null>(null)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  // ask 콜백이 매 메시지마다 새로 만들어지지 않도록 최신 대화는 ref로 읽는다
  const messagesRef = useRef<ChatMessage[]>(messages)
  messagesRef.current = messages
  /** 진행 확인은 한 대화에 한 번만 띄운다 */
  const intentAskedRef = useRef(false)
  /** 다음 단계 안내(카피·구좌·연결)도 한 번만 띄운다. 추천을 받으러 갔다 오면 다시 열어 준다. */
  const nextAskedRef = useRef(false)
  /** 추천 버튼으로 보낸 질문 — 답이 오면 다음 단계 안내를 다시 붙여 연결까지 이어 준다 */
  const resumeNextRef = useRef(false)
  /** 결과물 답 아래 상품 확인과 PPM 세부 상품 확인 — 각각 대화당 한 번만 붙인다 */
  const productRefineAskedRef = useRef(false)
  const detailAskedRef = useRef(false)
  const [pending, setPending] = useState(false)
  const [pendingReport, setPendingReport] = useState(false)
  const [pendingSince, setPendingSince] = useState<number | null>(null)
  /** 기다리는 요청을 끊는 손잡이 — 「그만하고 짧게 답 받기」 */
  const abortRef = useRef<AbortController | null>(null)
  const [campaignDraft, setCampaignDraft] = useState<CampaignDraft | null>(null)
  const [preferredEngine, setPreferredEngine] = useState<Engine>(
    () => (localStorage.getItem(LS_ENGINE) as Engine) || 'claude',
  )
  const [engineStatus, setEngineStatus] = useState<Partial<Record<Engine, EngineStatus>> | null | undefined>(undefined)
  const refreshEngines = useCallback(() => fetchEngines().then(setEngineStatus), [])
  const engines = useMemo(
    () =>
      engineStatus
        ? (Object.fromEntries(
            Object.entries(engineStatus).map(([e, s]) => [e, Boolean(s?.installed && s.loggedIn)]),
          ) as Partial<Record<Engine, boolean>>)
        : null,
    [engineStatus],
  )

  useEffect(() => localStorage.setItem(LS_ROLE, role), [role])
  useEffect(
    () => localStorage.setItem(LS_FAVORITE_SYSTEMS, JSON.stringify(favoriteSystems)),
    [favoriteSystems],
  )

  useEffect(() => localStorage.setItem(LS_DOCK, dockOpen ? '1' : '0'), [dockOpen])
  useEffect(() => localStorage.setItem(LS_ENGINE, preferredEngine), [preferredEngine])
  useEffect(() => {
    refreshEngines()
  }, [refreshEngines])

  useEffect(() => {
    fetchSystemsState().then((state) => state && setRemote(state))
  }, [])

  // 코드에 있는 시스템 + 승인돼 올라온 시스템. 접속 주소는 코드가 아니라 저장소에서 온다.
  const systems = useMemo<SystemEntry[]>(
    () => [
      ...seedSystems.map((s) =>
        systemsState.urls[s.id] ? { ...s, url: systemsState.urls[s.id] } : s,
      ),
      ...systemsState.added,
    ],
    [systemsState],
  )
  const systemRequests = systemsState.requests

  /** 요청·승인을 저장소에 반영한다. 저장소가 없으면 같은 규칙으로 메모리에만 반영한다. */
  const applySystemsAction = useCallback(
    async (action: SystemsAction) => {
      const next = await postSystemsAction(action)
      if (next) setRemote(next)
      else setMemory((prev) => reduceSystems(prev, action))
    },
    [],
  )

  // 선택한 엔진을 먼저, 나머지는 CLI → Gemini 순으로 시도한다
  const usableEngines = useMemo<Engine[]>(
    () =>
      engines
        ? [preferredEngine, ...ENGINE_PRIORITY.filter((e) => e !== preferredEngine)].filter((e) => engines[e])
        : [],
    [engines, preferredEngine],
  )
  const engine: Engine | null = usableEngines[0] ?? null

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2600)
    return () => clearTimeout(t)
  }, [toast])

  // 로그인한 담당자가 있으면 그 계정을, 로그인 없는 데모 빌드면 데모 계정을 쓴다
  const authUser = useAuth().user
  const session: Session = useMemo(
    () => authUser ?? { userId: 'kim', name: '김OO', team: '편성기획팀', role },
    [authUser, role],
  )

  const showToast = useCallback((msg: string) => setToast(msg), [])

  const ask = useCallback((query: string, opts: AskOpts = {}) => {
    let q = query.trim()
    if (!q) return
    setDockOpen(true)
    const said = q
    const lastBot = [...messagesRef.current].reverse().find((m) => m.role === 'assistant')
    let modeOverride = opts.modeOverride

    // 리포트 직후 "위키에 반영해 줘"는 수정 제안 안내가 아니라 이 리포트의 반영 요청이다 — 엔진을 부르지 않는다 (requests-report.md 5절)
    const reflect = opts.modeOverride ? null : detectReportReflect(q, lastBot, docs)
    if (reflect && lastBot?.report) {
      const lines =
        reflect === 'how'
          ? [REFLECT_HOW_TEXT]
          : [
              reflectStartText(lastBot.report.title),
              ...(reflect === 'go-fix' ? [REFLECT_FIX_TEXT] : reflect === 'go-existing' ? [REFLECT_EXISTING_TEXT] : []),
            ]
      setMessages((prev) => [...prev, makeMessage('user', q), makeMessage('assistant', lines.join('\n'))])
      if (reflect !== 'how') startReflectRef.current?.(lastBot.id)
      return
    }
    // 리포트 뒤 "짧게 답해줘"는 주제 없이 모드만 바꾼 말이다 — 리포트의 질문을 짧은 답으로 다시 보낸다
    if (!modeOverride && lastBot?.report && isShortAnswerRequest(q)) {
      const original = questionOf(messagesRef.current, lastBot.id)
      if (original) {
        q = original
        modeOverride = 'qa'
      }
    }

    // 이번 질문 전까지의 대화를 이력으로 넘긴다 — 기획 상담은 여러 턴에 걸쳐 조건을 모은다
    const history = messagesRef.current.map((m) => ({ role: m.role, text: m.text }))
    setMessages((prev) => [...prev, makeMessage('user', said, opts.via ? { via: opts.via } : undefined)])
    setPending(true)
    const reportLikely = usableEngines[0] !== undefined && usableEngines[0] !== 'gemini' && mayBeReport(q, modeOverride)
    setPendingReport(reportLikely)
    setPendingSince(Date.now())
    const ctrl = new AbortController()
    abortRef.current = ctrl
    // 새 기획 의도가 들어오면 새 상담이다 — 지난 상담에서 이미 물었다는 이유로 확인 칩을 건너뛰지 않는다
    if (detectCampaignIntent(q) && !detectDecision(q)) intentAskedRef.current = false
    askAssistant(
      q,
      usableEngines,
      history,
      intentAskedRef.current,
      nextAskedRef.current,
      { product: productRefineAskedRef.current, detail: detailAskedRef.current },
      { modeOverride, signal: ctrl.signal },
    ).then((reply) => {
      if (abortRef.current === ctrl) abortRef.current = null
      setPending(false)
      setPendingReport(false)
      setPendingSince(null)
      // 「그만하고 짧게 답 받기」 — 끊긴 리포트 대신 같은 질문을 짧은 답으로 받는다
      if (reply.cancelled) {
        askRef.current?.(q, { modeOverride: 'qa', via: '짧게 답 받기' })
        return
      }
      // 추천을 받고 돌아왔으면 연결 버튼을 다시 붙인다 — 대화가 여기서 끊기지 않게 한다
      if (resumeNextRef.current && !reply.intent) {
        resumeNextRef.current = false
        reply = {
          ...reply,
          intent: { kind: 'next', question: NEXT_STEP_QUESTION },
          brief: readBrief(messagesRef.current.map((m) => ({ role: m.role, text: m.text }))),
        }
      }
      // 다음 단계 안내에는 연결 버튼이 들어 있다 — 뒤늦게 진행 의사를 또 묻지 않는다
      if (reply.intent?.kind === 'next') {
        nextAskedRef.current = true
        intentAskedRef.current = true
      } else if (reply.intent?.kind === 'product-qa' && reply.intent.retry) productRefineAskedRef.current = true
      // 세부 상품 확인은 진행 확인과 별개다 — 붙였다고 진행 확인을 건너뛰게 하지 않는다
      else if (reply.intent?.kind === 'ppm-detail') detailAskedRef.current = true
      else if (reply.intent) intentAskedRef.current = true
      setMessages((prev) => [
        ...prev,
        makeMessage('assistant', reply.text, {
          query: q,
          sources: reply.sources,
          intent: reply.intent,
          brief: reply.brief,
          answeredBy: reply.answeredBy,
          fallback: reply.fallback,
          report: reply.report,
          reportMeta: reply.report ? { engine: reply.answeredBy ?? '', createdAt: new Date().toISOString() } : undefined,
          reportHint: reply.reportHint,
          notice: reply.notice,
          reportFailed: reply.reportFailed,
        }),
      ])
    })
  }, [usableEngines, docs])

  /** resolveIntent 가 ask 를 다시 호출해야 해서 최신 ask 를 ref 로 들고 있는다 */
  const askRef = useRef<((query: string, opts?: AskOpts) => void) | null>(null)
  askRef.current = ask

  const askAgain = useCallback((messageId: string, mode: 'qa' | 'report') => {
    const q = questionOf(messagesRef.current, messageId)
    if (q) askRef.current?.(q, { modeOverride: mode, via: mode === 'report' ? '리포트로 자세히 받기' : '짧게 답 받기' })
  }, [])

  const cancelReport = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  }, [])

  const navigate = useNavigate()
  /** 새 문서 화면을 채워 연다 — 주소창에는 본문을 싣지 않고 화면 이동 state 와 sessionStorage 로만 넘긴다 */
  const openPrefill = useCallback(
    (prefill: NewDocPrefill, check?: PublicCheckResult) => {
      savePrefill(prefill)
      navigate('/wiki/new', { state: { prefill, check } })
    },
    [navigate],
  )

  const startReflect = useCallback(
    async (messageId: string) => {
      const msg = messagesRef.current.find((m) => m.id === messageId)
      if (!msg?.report || msg.reportReflect?.stage === 'checking') return
      patchMessage(messageId, { reportReflect: { stage: 'checking' } })
      const draft = buildReflectDraft(msg, docs)
      try {
        const check = await requestPublicCheck({ title: draft.title, body: draft.body, reason: draft.reason, via: 'report', target: 'new' })
        // 이름 검사 없이 공개 저장소로 넘기지 않는다 (7-3)
        if (!check.namesChecked) patchMessage(messageId, { reportReflect: { stage: 'halted' } })
        else if (check.blocks.length) patchMessage(messageId, { reportReflect: { stage: 'blocked', check } })
        else {
          patchMessage(messageId, { reportReflect: { stage: 'handed' } })
          openPrefill(draft, check)
        }
      } catch (err) {
        console.info('[report] 공개 검사 실패:', (err as Error).message)
        patchMessage(messageId, { reportReflect: { stage: 'failed' } })
      }
    },
    [docs, openPrefill, patchMessage],
  )
  const startReflectRef = useRef<((messageId: string) => void) | null>(null)
  startReflectRef.current = startReflect

  const openReflectEditor = useCallback(
    (messageId: string) => {
      const msg = messagesRef.current.find((m) => m.id === messageId)
      if (!msg?.report) return
      // 새 문서 화면에서 고치던 내용이 있으면 그대로 다시 연다
      const saved = readPrefill()
      const prefill = saved?.fromMessageId === messageId ? saved : buildReflectDraft(msg, docs)
      const reflect = msg.reportReflect
      if (reflect?.stage === 'blocked') patchMessage(messageId, { reportReflect: { stage: 'handed' } })
      openPrefill(prefill, reflect?.stage === 'blocked' && prefill !== saved ? reflect.check : undefined)
    },
    [docs, openPrefill, patchMessage],
  )

  const closeReflect = useCallback((messageId: string) => patchMessage(messageId, { reportReflect: undefined }), [patchMessage])

  const markReportSubmitted = useCallback(
    (messageId: string, code: string, prNumber: number) =>
      patchMessage(messageId, { reportReflect: { stage: 'submitted', code, prNumber } }),
    [patchMessage],
  )

  /** 어드민(프로모션 자동화) 화면을 새 탭으로 연다. 대화에서 파악한 조건만 실어 보낸다. */
  const openCampaignAdmin = useCallback((scope?: ProductScope) => {
    const turns = messagesRef.current.map((m) => ({ role: m.role, text: m.text }))
    const draft = buildCampaignDraft(turns, scope)
    const brief = readBrief(turns, scope)
    setCampaignDraft(draft)
    window.open(buildCampaignUrl(draft), '_blank', 'noopener,noreferrer')
    const filled = [draft.target, draft.periodStart && `${draft.periodStart} ~ ${draft.periodEnd}`, draft.targetCount]
      .filter(Boolean)
      .join(' · ')
    setMessages((prev) => [
      ...prev,
      makeMessage(
        'assistant',
        filled
          ? `프로모션 어드민 화면을 새 탭으로 열었습니다. 대화에서 확인한 조건(${filled})만 채워 보냈고, 나머지는 화면에서 입력하시면 됩니다.`
          : '프로모션 어드민 화면을 새 탭으로 열었습니다. 조건은 화면에서 입력하시면 됩니다.',
        { brief },
      ),
    ])
  }, [])

  const resolveIntent = useCallback(
    (messageId: string, choice: IntentChoice) => {
      const answered = INTENT_ANSWER_LABEL[choice]
      // 칩을 접기 전에 어떤 확인이었는지 읽어 둔다 — 상품 유형 선택의 다음 동작이 갈린다
      const answeredIntent = messagesRef.current.find((m) => m.id === messageId)?.intent
      const answeredKind = answeredIntent?.kind
      // 답을 받은 뒤 붙은 확인이면 원래 질문을 고른 기준으로 다시 보낸다
      const retry = answeredIntent?.retry
      // 버튼을 누른 메시지의 확인은 접고, 고른 값만 남긴다
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, intent: undefined, intentAnswer: answered } : m)),
      )
      intentAskedRef.current = true

      if (choice === 'no') {
        // 질문만 받더라도 근거 문서가 PPM·PPV로 갈린다 — 아직 모르면 한 번은 확인하고 넘어간다
        const slots = readSlots(messagesRef.current.map((m) => ({ role: m.role, text: m.text })))
        const known = slots.product
        // PPM이면 근거 줄이 B tv+ 와 그 외 월정액으로 또 갈린다 — 세부를 모르면 한 번 더 묻는다
        const askDetail = known?.scope === 'PPM' && !slots.ppmDetail && !detailAskedRef.current
        if (askDetail) detailAskedRef.current = true
        setMessages((prev) => [
          ...prev,
          askDetail
            ? makeMessage('assistant', `알겠습니다. ${known.label} 기준으로 답하겠습니다.`, {
                intent: { kind: 'ppm-detail', question: PPM_DETAIL_QUESTION },
              })
            : known
              ? makeMessage(
                  'assistant',
                  `알겠습니다. ${known.label}${slots.ppmDetail ? ` 중 ${ppmDetailLabel(slots.ppmDetail)}` : ''} 기준으로 답하겠습니다. 정책이나 시스템 관련해 궁금한 것을 물어봐 주세요.`,
                )
              : makeMessage('assistant', '알겠습니다. 다만 답변 근거가 상품 유형에 따라 갈립니다.', {
                  intent: { kind: 'product-qa', question: INTENT_PRODUCT_QA_QUESTION },
                }),
        ])
        return
      }
      if (choice === 'yes') {
        // 대화에서 이미 상품 유형을 말했으면 더 묻지 않고 바로 보낸다
        const known = readSlots(messagesRef.current.map((m) => ({ role: m.role, text: m.text }))).product
        if (known) {
          openCampaignAdmin(known.scope)
          return
        }
        // 질문은 확인 칩이 들고 있다 — 본문에 또 쓰면 같은 문장이 두 번 보인다
        setMessages((prev) => [
          ...prev,
          makeMessage('assistant', '', { intent: { kind: 'product', question: INTENT_PRODUCT_QUESTION } }),
        ])
        return
      }
      // 방향을 정한 뒤의 다음 단계 — 추천을 먼저 받거나, 프로모션 자동화로 넘긴다
      if (choice === 'copy' || choice === 'placement') {
        // 추천을 받고 나면 다시 물어봐야 하므로 안내를 열어 둔다
        nextAskedRef.current = false
        resumeNextRef.current = true
        askRef.current?.(choice === 'copy' ? COPY_REQUEST : PLACEMENT_REQUEST)
        return
      }
      if (choice === 'later') {
        setMessages((prev) => [
          ...prev,
          makeMessage('assistant', '알겠습니다. 이벤트명·기간·스킴이 정해지면 이어서 말씀해 주세요.'),
        ])
        return
      }
      if (choice === 'handoff') {
        const known = readSlots(messagesRef.current.map((m) => ({ role: m.role, text: m.text }))).product
        if (known) {
          openCampaignAdmin(known.scope)
          return
        }
        setMessages((prev) => [
          ...prev,
          makeMessage('assistant', '', { intent: { kind: 'product', question: INTENT_PRODUCT_QUESTION } }),
        ])
        return
      }
      // PPM 세부 상품 확인 — 다시 보내는 문장 앞의 라벨이 그대로 세부 상품 키워드로 읽힌다
      if (choice === 'btvplus' || choice === 'ppm-other') {
        if (retry) {
          askRef.current?.(`${answered} 기준으로 ${retry}`, { via: `${answered} 기준으로 다시` })
          return
        }
        setMessages((prev) => [
          ...prev,
          makeMessage('user', `${answered} 기준으로 물어볼게요`),
          makeMessage('assistant', `PPM(월정액) 중 ${answered} 기준으로 답하겠습니다. 궁금한 것을 물어봐 주세요.`),
        ])
        return
      }
      // 질문만 받기로 한 뒤의 상품 유형 확인 — 기준만 잡고 어드민은 열지 않는다
      if (answeredKind === 'product-qa') {
        const detail = readSlots(messagesRef.current.map((m) => ({ role: m.role, text: m.text }))).ppmDetail
        const askDetail = choice === 'PPM' && !detail && !detailAskedRef.current
        if (askDetail) detailAskedRef.current = true
        if (retry) {
          // PPM인데 세부를 모르면 다시 보내기 전에 세부 상품부터 고르게 한다 — 같은 원래 질문을 들고 간다
          if (askDetail) {
            setMessages((prev) => [
              ...prev,
              makeMessage('assistant', '', { intent: { kind: 'ppm-detail', question: PPM_DETAIL_QUESTION, retry } }),
            ])
            return
          }
          askRef.current?.(`${answered} 기준으로 ${retry}`, { via: `${answered} 기준으로 다시` })
          return
        }
        setMessages((prev) => [
          ...prev,
          // 고른 값을 사용자 발화로 남긴다 — 이후 질문의 근거 문서가 이 기준으로 걸러진다
          makeMessage('user', `${answered} 기준으로 물어볼게요`),
          askDetail
            ? makeMessage('assistant', `${answered} 기준으로 답하겠습니다.`, {
                intent: { kind: 'ppm-detail', question: PPM_DETAIL_QUESTION },
              })
            : makeMessage('assistant', `${answered} 기준으로 답하겠습니다. 궁금한 것을 물어봐 주세요.`),
        ])
        return
      }
      openCampaignAdmin(choice)
    },
    [openCampaignAdmin],
  )

  const proposalsBusy = useRef(false)
  const refreshProposals = useCallback(async () => {
    if (proposalsBusy.current) return
    proposalsBusy.current = true
    setProposalsLoading(true)
    try {
      setProposals(await fetchProposals())
      setProposalsError(null)
    } catch (err) {
      setProposalsError((err as Error).message)
    } finally {
      proposalsBusy.current = false
      setProposalsLoading(false)
    }
  }, [])
  const proposalsTried = useRef(false)
  const ensureProposals = useCallback(() => {
    if (proposalsTried.current) return
    proposalsTried.current = true
    void refreshProposals()
  }, [refreshProposals])

  const toggleFavoriteSystem = useCallback(
    (id: string) => {
      const on = favoriteSystems.includes(id)
      setFavoriteSystems((prev) => (on ? prev.filter((f) => f !== id) : [...prev, id]))
      setToast(on ? '자주 사용하는 시스템에서 뺐습니다' : '자주 사용하는 시스템에 담았습니다')
    },
    [favoriteSystems],
  )

  const requestSystemUrl = useCallback(
    (systemId: string, url: string) => {
      const system = systems.find((s) => s.id === systemId)
      if (!system) return
      if (systemRequests.some((r) => r.targetSystemId === systemId && r.status === 'pending')) {
        setToast('이미 주소 등록 요청이 대기 중입니다')
        return
      }
      applySystemsAction({
        kind: 'request',
        request: {
          id: newId('sy'),
          targetSystemId: systemId,
          name: system.name,
          desc: system.desc,
          url: url.trim(),
          access: system.access,
          group: system.group,
          status: 'pending',
          requestedBy: session.name,
          requestedAt: today(),
        },
      })
      setToast('접속 주소 등록을 요청했습니다 · 승인 대기')
    },
    [applySystemsAction, session.name, systemRequests, systems],
  )

  const submitSystemRequest = useCallback(
    (input: Omit<SystemRequest, 'id' | 'status' | 'requestedBy' | 'requestedAt'>) => {
      applySystemsAction({
        kind: 'request',
        request: {
          ...input,
          id: newId('sy'),
          status: 'pending',
          requestedBy: session.name,
          requestedAt: today(),
        },
      })
      setToast('시스템 등록을 요청했습니다 · 승인 대기')
    },
    [applySystemsAction, session.name],
  )

  const decideSystemRequest = useCallback(
    async (id: string, decision: 'approved' | 'rejected', reason?: string) => {
      const request = systemRequests.find((r) => r.id === id)
      await applySystemsAction({ kind: 'decide', id, decision, reason })
      if (decision !== 'approved') {
        setToast('반려 처리했습니다')
        return
      }
      setToast(
        request?.targetSystemId
          ? '승인 완료 · 접속 주소를 모두에게 공개했습니다'
          : '승인 완료 · 시스템 목록에 추가했습니다',
      )
    },
    [applySystemsAction, systemRequests],
  )

  const addSheet = useCallback(
    (input: Omit<Sheet, 'id' | 'ownerId' | 'ownerName' | 'lastCheckedAt'>) => {
      setSheets((prev) => [
        {
          ...input,
          id: newId('sh'),
          ownerId: session.userId,
          ownerName: session.name,
          lastCheckedAt: today(),
        },
        ...prev,
      ])
      setToast('편성표를 등록했습니다')
    },
    [session.name, session.userId],
  )

  const requestPromotion = useCallback(
    (sheetId: string) => {
      const sheet = sheets.find((s) => s.id === sheetId)
      if (!sheet) return
      if (promotions.some((p) => p.sheetId === sheetId && p.status === 'pending')) {
        setToast('이미 승격 요청이 대기 중입니다')
        return
      }
      setPromotions((prev) => [
        {
          id: newId('pm'),
          sheetId,
          sheetName: sheet.name,
          targetCategory: null,
          status: 'pending',
          requestedBy: session.name,
          requestedAt: today(),
        },
        ...prev,
      ])
      setToast('승격 요청을 제출했습니다 · 승인 대기')
    },
    [promotions, session.name, sheets],
  )

  const decidePromotion = useCallback(
    async (
      id: string,
      decision: 'approved' | 'rejected',
      opts: { category?: CategoryId; reason?: string },
    ) => {
      await new Promise((r) => setTimeout(r, 600))
      const promotion = promotions.find((p) => p.id === id)
      setPromotions((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...p, status: decision, rejectReason: opts.reason, targetCategory: opts.category ?? null }
            : p,
        ),
      )
      const category = opts.category
      if (decision === 'approved' && promotion && category) {
        const sheet = sheets.find((s) => s.id === promotion.sheetId)
        if (sheet) {
          setDocs((prev) => [
            ...prev,
            {
              id: newId('doc'),
              path: `${category}/${sheet.id}.md`,
              title: `${sheet.name} 요약`,
              category,
              subcategory: null,
              code: `SUM-${sheet.id.toUpperCase()}`,
              version: 1,
              updatedBy: session.name,
              updatedAt: today(),
              ownerId: sheet.ownerId,
              body: `## 개요\n\n${sheet.description}\n\n- 담당자: ${sheet.ownerName}\n- 대상 GNB: ${sheet.gnb}\n- 대상 기간: ${sheet.periodStart} ~ ${sheet.periodEnd}\n\n## 원본\n\n원본 편성표는 아래 링크에서 확인합니다. 본 요약 문서는 원본과 실시간 동기화되지 않습니다.\n\n[${sheet.name} 원본 열기](${sheet.url})\n`,
            },
          ])
        }
        setToast('승격 표시만 했습니다 · 요약 문서는 저장소에 아직 반영되지 않습니다')
      } else if (decision === 'rejected') {
        setToast('반려 처리했습니다')
      }
    },
    [promotions, session.name, sheets],
  )

  const value: AppState = {
    session,
    docs,
    sheets,
    proposals,
    proposalsError,
    proposalsLoading,
    promotions,
    systems,
    systemRequests,
    favoriteSystems,
    systemsStorage: remote ? (remote.shared ? 'shared' : 'local') : 'memory',
    assistant: {
      open: dockOpen,
      messages,
      pending,
      pendingReport,
      pendingSince,
      campaignDraft,
      engineStatus,
      engines,
      engine,
      usableEngines,
    },
    toast,
    setRole: setRoleState,
    showToast,
    openDock: () => setDockOpen(true),
    closeDock: () => setDockOpen(false),
    openQuestionTemplate: (templateId: string) => {
      setDockOpen(true)
      setQuestionTemplateRequest((r) => ({ id: templateId, n: (r?.n ?? 0) + 1 }))
    },
    questionTemplateRequest,
    clearQuestionTemplateRequest: () => setQuestionTemplateRequest(null),
    ask,
    askAgain,
    cancelReport,
    startReflect,
    openReflectEditor,
    closeReflect,
    markReportSubmitted,
    resolveIntent,
    setEngine: setPreferredEngine,
    refreshEngines,
    setCampaignDraft,
    toggleFavoriteSystem,
    requestSystemUrl,
    submitSystemRequest,
    decideSystemRequest,
    ensureProposals,
    refreshProposals,
    addSheet,
    requestPromotion,
    decidePromotion,
  }

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useApp() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}
