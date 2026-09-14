import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { docs as seedDocs } from '../data/docs'
import { initialPromotions, initialProposals, sheets as seedSheets } from '../data/sheets'
import { askAssistant, makeMessage, newId } from '../lib/assistant'
import type {
  CampaignDraft,
  CategoryId,
  ChatMessage,
  Promotion,
  Proposal,
  Role,
  Session,
  Sheet,
  WikiDoc,
} from '../types'

const LS_ROLE = 'wikihub.role'
const LS_DOCK = 'wikihub.dockOpen'

interface AssistantState {
  open: boolean
  messages: ChatMessage[]
  pending: boolean
  campaignDraft: CampaignDraft | null
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
  const [pending, setPending] = useState(false)
  const [campaignDraft, setCampaignDraft] = useState<CampaignDraft | null>(null)

  useEffect(() => localStorage.setItem(LS_ROLE, role), [role])
  useEffect(() => localStorage.setItem(LS_DOCK, dockOpen ? '1' : '0'), [dockOpen])

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
    setMessages((prev) => [...prev, makeMessage('user', q)])
    setPending(true)
    askAssistant(q).then((reply) => {
      setMessages((prev) => [
        ...prev,
        makeMessage('assistant', reply.text, { sources: reply.sources, campaign: reply.campaign }),
      ])
      if (reply.campaign) setCampaignDraft(reply.campaign)
      setPending(false)
    })
  }, [])

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
    assistant: { open: dockOpen, messages, pending, campaignDraft },
    toast,
    setRole: setRoleState,
    showToast,
    openDock: () => setDockOpen(true),
    closeDock: () => setDockOpen(false),
    ask,
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
