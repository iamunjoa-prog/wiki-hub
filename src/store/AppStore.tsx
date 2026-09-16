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
import { docs as seedDocs } from '../data/docs'
import { initialPromotions, initialProposals, sheets as seedSheets } from '../data/sheets'
import {
  askAssistant,
  buildCampaignDraft,
  ENGINE_PRIORITY,
  fetchEngines,
  INTENT_PRODUCT_QUESTION,
  makeMessage,
  NEXT_STEP_QUESTION,
  newId,
  readBrief,
  readSlots,
} from '../lib/assistant'
import { buildCampaignUrl } from '../lib/campaignLink'
import type {
  CampaignDraft,
  CategoryId,
  ChatMessage,
  Engine,
  EngineStatus,
  ProductScope,
  Promotion,
  Proposal,
  Role,
  Session,
  Sheet,
  WikiDoc,
} from '../types'

const LS_ROLE = 'wikihub.role'
const LS_DOCK = 'wikihub.dockOpen'
const LS_ENGINE = 'wikihub.engine'

interface AssistantState {
  open: boolean
  messages: ChatMessage[]
  pending: boolean
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
  proposals: Proposal[]
  promotions: Promotion[]
  assistant: AssistantState
  toast: string | null

  setRole: (role: Role) => void
  showToast: (msg: string) => void

  openDock: () => void
  closeDock: () => void
  ask: (query: string) => void
  /** 진행 의도 확인에 답한다 — '네'면 상품 유형만 더 묻고 어드민 화면을 연다 */
  resolveIntent: (messageId: string, choice: IntentChoice) => void
  setEngine: (engine: Engine) => void
  refreshEngines: () => Promise<void>
  setCampaignDraft: (draft: CampaignDraft | null) => void

  submitProposal: (docId: string, newBody: string, reason: string) => void
  decideProposal: (id: string, decision: 'approved' | 'rejected', reason?: string) => Promise<void>

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
export type IntentChoice = 'yes' | 'no' | ProductScope | 'copy' | 'placement' | 'handoff' | 'later'

const INTENT_ANSWER_LABEL: Record<IntentChoice, string> = {
  yes: '네, 진행할게요',
  no: '아니요, 질문만 할게요',
  PPM: '월정액(PPM)',
  PPV: '단건(PPV)',
  copy: '카피 추천 먼저',
  placement: '노출 구좌 추천 먼저',
  handoff: '프로모션 자동화로 연결',
  later: '조금 더 정리할게요',
}

/** 추천 버튼이 대신 보내는 질문 — 근거 문서를 타도록 평소 질문과 같은 경로로 보낸다 */
const COPY_REQUEST = '지금 정리한 프로모션 기준으로 카피 방향을 추천해줘'
const PLACEMENT_REQUEST = '지금 정리한 프로모션 기준으로 노출 구좌를 추천해줘'

const Ctx = createContext<AppState | null>(null)

const today = () => new Date().toISOString().slice(0, 10)

export function AppProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(
    () => (localStorage.getItem(LS_ROLE) as Role) || 'member',
  )
  const [docs, setDocs] = useState<WikiDoc[]>(seedDocs)
  const [sheets, setSheets] = useState<Sheet[]>(seedSheets)
  const [proposals, setProposals] = useState<Proposal[]>(initialProposals)
  const [promotions, setPromotions] = useState<Promotion[]>(initialPromotions)
  const [toast, setToast] = useState<string | null>(null)

  const [dockOpen, setDockOpen] = useState<boolean>(
    () => localStorage.getItem(LS_DOCK) === '1',
  )
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
  const [pending, setPending] = useState(false)
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
  useEffect(() => localStorage.setItem(LS_DOCK, dockOpen ? '1' : '0'), [dockOpen])
  useEffect(() => localStorage.setItem(LS_ENGINE, preferredEngine), [preferredEngine])
  useEffect(() => {
    refreshEngines()
  }, [refreshEngines])

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

  const session: Session = useMemo(
    () => ({ userId: 'kim', name: '김OO', team: '편성기획팀', role }),
    [role],
  )

  const showToast = useCallback((msg: string) => setToast(msg), [])

  const ask = useCallback((query: string) => {
    const q = query.trim()
    if (!q) return
    setDockOpen(true)
    // 이번 질문 전까지의 대화를 이력으로 넘긴다 — 기획 상담은 여러 턴에 걸쳐 조건을 모은다
    const history = messagesRef.current.map((m) => ({ role: m.role, text: m.text }))
    setMessages((prev) => [...prev, makeMessage('user', q)])
    setPending(true)
    askAssistant(q, usableEngines, history, intentAskedRef.current, nextAskedRef.current).then((reply) => {
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
      } else if (reply.intent) intentAskedRef.current = true
      setMessages((prev) => [
        ...prev,
        makeMessage('assistant', reply.text, {
          sources: reply.sources,
          intent: reply.intent,
          brief: reply.brief,
          answeredBy: reply.answeredBy,
        }),
      ])
      setPending(false)
    })
  }, [usableEngines])

  /** resolveIntent 가 ask 를 다시 호출해야 해서 최신 ask 를 ref 로 들고 있는다 */
  const askRef = useRef<((query: string) => void) | null>(null)
  askRef.current = ask

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
      // 버튼을 누른 메시지의 확인은 접고, 고른 값만 남긴다
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, intent: undefined, intentAnswer: answered } : m)),
      )
      intentAskedRef.current = true

      if (choice === 'no') {
        setMessages((prev) => [
          ...prev,
          makeMessage('assistant', '알겠습니다. 정책이나 시스템 관련해 궁금한 것을 물어봐 주세요.'),
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
      openCampaignAdmin(choice)
    },
    [openCampaignAdmin],
  )

  const submitProposal = useCallback(
    (docId: string, newBody: string, reason: string) => {
      const doc = docs.find((d) => d.id === docId)
      if (!doc) return
      setProposals((prev) => [
        {
          id: newId('pr'),
          docId,
          docTitle: doc.title,
          baseVersion: doc.version,
          newBody,
          reason,
          status: 'pending',
          requestedBy: session.name,
          requestedAt: today(),
        },
        ...prev,
      ])
      setToast('수정 제안을 제출했습니다 · 승인 대기')
    },
    [docs, session.name],
  )

  const decideProposal = useCallback(
    async (id: string, decision: 'approved' | 'rejected', reason?: string) => {
      // Git 반영이 실패할 수 있어 낙관적 업데이트를 쓰지 않는다.
      await new Promise((r) => setTimeout(r, 600))
      setProposals((prev) =>
        prev.map((p) => (p.id === id ? { ...p, status: decision, rejectReason: reason } : p)),
      )
      if (decision === 'approved') {
        const proposal = proposals.find((p) => p.id === id)
        if (proposal?.newBody) {
          setDocs((prev) =>
            prev.map((d) =>
              d.id === proposal.docId
                ? {
                    ...d,
                    body: proposal.newBody,
                    version: d.version + 1,
                    updatedBy: proposal.requestedBy,
                    updatedAt: today(),
                  }
                : d,
            ),
          )
        }
        setToast('승인 완료 · 커밋 생성 후 위키에 반영했습니다')
      } else {
        setToast('반려 처리했습니다')
      }
    },
    [proposals],
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
              code: `SUM-${sheet.id.toUpperCase()}`,
              version: 1,
              updatedBy: session.name,
              updatedAt: today(),
              ownerId: sheet.ownerId,
              body: `## 개요\n\n${sheet.description}\n\n- 담당자: ${sheet.ownerName}\n- 대상 GNB: ${sheet.gnb}\n- 대상 기간: ${sheet.periodStart} ~ ${sheet.periodEnd}\n\n## 원본\n\n원본 편성표는 아래 링크에서 확인합니다. 본 요약 문서는 원본과 실시간 동기화되지 않습니다.\n\n[${sheet.name} 원본 열기](${sheet.url})\n`,
            },
          ])
        }
        setToast('승격 완료 · 요약 문서를 생성했습니다')
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
    promotions,
    assistant: { open: dockOpen, messages, pending, campaignDraft, engineStatus, engines, engine, usableEngines },
    toast,
    setRole: setRoleState,
    showToast,
    openDock: () => setDockOpen(true),
    closeDock: () => setDockOpen(false),
    ask,
    resolveIntent,
    setEngine: setPreferredEngine,
    refreshEngines,
    setCampaignDraft,
    submitProposal,
    decideProposal,
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
