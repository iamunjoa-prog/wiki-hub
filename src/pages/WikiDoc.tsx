import { Children, isValidElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import remarkCjkFriendly from 'remark-cjk-friendly'
import remarkGfm from 'remark-gfm'
import { TopBar } from '../components/AppShell'
import { DocEditPanel, DraftBanner, PendingProposalsNote, useEditChecks } from '../components/DocEditPanel'
import { agoLabel, categoryLabel, freshnessOf, FreshLamp, ScopeChip } from '../components/DocBits'
import { Icon } from '../components/Icon'
import { SectionEditor } from '../components/SectionEditor'
import { SubmitDoneDialog, SubmitEditDialog, type EditBase } from '../components/SubmitEditDialog'
import { docCommits } from '../data/docs'
import type { AiEditResult } from '../lib/assistant'
import { defaultEditReason, headingId, headingPlain, sectionAnchor, sectionChanges, sectionLabel, sectionTitleOf } from '../lib/docEdit'
import {
  changedSections,
  loadDraft,
  normBody,
  planRestore,
  removeDraft,
  saveDraft,
  splitSections,
  type DraftRestore,
  type EditDraft,
} from '../lib/draft'
import { fetchDocVersion, type DocVersion, type EditProposalResult } from '../lib/proposeEdit'
import { useApp } from '../store/AppStore'

interface Heading {
  level: 2 | 3
  text: string
}

function parseHeadings(body: string): Heading[] {
  return body
    .split('\n')
    .map((l) => l.match(/^(#{2,3})\s+(.*)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ level: m[1].length as 2 | 3, text: headingPlain(m[2].trim()) }))
}

/**
 * 문서 첫 줄 `> 대상 독자 … · 적용대상 …` 인용은 메타 줄 옆 태그로 옮긴다 — 원문·검색·챗봇 근거는 그대로, 화면에서만.
 * 이 줄 다음이 빈 줄·빈 `>` 줄·문서 끝일 때만 떼어 낸다. 뒤에 이어지는 주의 인용은 본문에 남긴다.
 */
function splitScope(body: string): { scope: string[]; body: string } {
  const m = body.match(/^\s*> ((?:대상 독자|적용대상) [^\r\n]*)(?:\r?\n>[ \t]*(?=\r?\n)|(?=\r?\n[ \t]*(?:\r?\n|$))|$)/)
  if (!m) return { scope: [], body }
  return { scope: m[1].split(' · '), body: body.slice(m[0].length) }
}

/** 렌더된 제목의 글자만 — 굵게·코드가 섞이면 children 이 배열이라 String() 하면 [object Object] 가 된다 */
function textOf(node: ReactNode): string {
  return Children.toArray(node)
    .map((c) => (typeof c === 'string' || typeof c === 'number' ? String(c) : isValidElement<{ children?: ReactNode }>(c) ? textOf(c.props.children) : ''))
    .join('')
}

const PLUGINS = [[remarkGfm, { singleTilde: false }], remarkCjkFriendly] as NonNullable<Parameters<typeof ReactMarkdown>[0]['remarkPlugins']>

/**
 * 장 하나를 그린다. 장마다 따로 그려야 장 제목 옆에 [이 장 고치기]를 달고 편집 칸과 바꿔 끼울 수 있다.
 * 글이 같으면 다시 그리지 않는다 — 다른 장을 고치는 동안 이 장의 DOM 이 새로 생기지 않게
 */
const SectionView = memo(function SectionView({ text, components, preamble }: { text: string; components: Components; preamble: boolean }) {
  // `**용어(설명)**를`처럼 닫는 ** 앞이 문장부호이고 뒤에 조사가 붙으면 표준 규칙상 굵게가 안 닫혀 별표가 남는다
  return (
    <ReactMarkdown remarkPlugins={PLUGINS} components={components}>
      {preamble ? splitScope(text).body : text}
    </ReactMarkdown>
  )
})

/** 편집 칸마다의 key — splitSections 와 같은 규칙(제목#몇 번째)이라 바뀐 곳 목록과 칸을 맞출 수 있다 */
function slotKeys(parts: string[]): string[] {
  const seen = new Map<string, number>()
  return parts.map((t) => {
    const title = sectionTitleOf(t)
    const n = (seen.get(title) ?? 0) + 1
    seen.set(title, n)
    return `${title}#${n}`
  })
}

/** `?edit=` 앵커가 가리키는 칸 — 장 앵커뿐 아니라 그 장 안 `###` 소제목 앵커로도 찾는다 */
function slotOfAnchor(parts: string[], anchor: string | null): number | null {
  if (!anchor || anchor === 'all') return null
  const i = parts.findIndex((t) => sectionAnchor(sectionTitleOf(t)) === anchor)
  if (i >= 0) return i
  const j = parts.findIndex((t) => t.split('\n').some((l) => /^###\s/.test(l) && headingId(l.replace(/^###\s+/, '').trim()) === anchor))
  return j >= 0 ? j : null
}

/** 편집 바 「임시 저장 10:42」 — 24시간 표기 */
const timeLabel = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
const LEAVE_SAVED = '고친 내용을 임시 저장했어요. 문서를 다시 열면 이어서 고칠 수 있어요.'

type SaveState = { state: 'idle' } | { state: 'pending' } | { state: 'saved'; at: string } | { state: 'failed' }

/** 다른 문서로 옮기면 편집 상태를 통째로 새로 시작한다 — 떠나는 문서의 고친 내용은 그 자리에서 임시 저장된다 */
export function WikiDoc() {
  const { docId } = useParams()
  return <WikiDocPage key={docId} />
}

function WikiDocPage() {
  const { docId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { docs, session, proposals, ensureProposals, refreshProposals, showToast, openDockWith } = useApp()
  const doc = docs.find((d) => d.id === docId)
  const [showHistory, setShowHistory] = useState(false)
  const [activeHeading, setActiveHeading] = useState<string | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const inlineTocRef = useRef<HTMLDetailsElement>(null)
  const tocRef = useRef<HTMLElement>(null)

  const headings = useMemo(() => (doc ? parseHeadings(doc.body) : []), [doc])
  const scoped = useMemo(() => splitScope(doc?.body ?? ''), [doc])
  /**
   * ReactMarkdown 에 넘기는 렌더러는 렌더마다 새로 만들면 React 가 본문 제목·표를 통째로 다시 만든다.
   * 그러면 스크롤할 때마다(목차 강조가 바뀔 때마다) 본문 DOM 이 새로 생기고 붙잡아 둔 제목 노드가 문서에서 떨어져 나간다 — 한 번만 만든다.
   */
  const md = useMemo(() => {
    /** 본문·적용대상 태그가 같이 쓰는 링크 — 문서 코드면 허브 안 이동, 아니면 새 창 */
    const mdLink = ({ href, children }: { href?: string; children?: ReactNode }) => {
      // 문서 코드 뒤에 #소제목을 붙이면(예: PPC-P-02#h-다크패턴-대응) 그 소제목으로 바로 스크롤한다
      const [code, anchor] = (href ?? '').split('#')
      const target = docs.find((d) => d.code === code)
      if (target) {
        const to = `/wiki/${target.id}${anchor ? `#${anchor}` : ''}`
        return (
          <a
            href={to}
            onClick={(e) => {
              e.preventDefault()
              navigate(to)
            }}
          >
            {children}
          </a>
        )
      }
      return (
        // 새 창으로 열리는 바깥 주소는 ↗ 로 문서 안 이동과 구분한다
        <a href={href} target="_blank" rel="noreferrer" className={/^https?:/i.test(href ?? '') ? 'ext' : undefined}>
          {children}
        </a>
      )
    }
    const body: Components = {
      h2: ({ children }) => <h2 id={headingId(textOf(children))}>{children}</h2>,
      h3: ({ children }) => <h3 id={headingId(textOf(children))}>{children}</h3>,
      a: mdLink,
      // 좁은 폭에서 표만 옆으로 밀고 본문 화면 전체가 밀리지 않게
      table: ({ children }) => (
        <div className="table-wrap">
          <table>{children}</table>
        </div>
      ),
    }
    const scope: Components = { p: ({ children }) => <>{children}</>, a: mdLink }
    return { body, scope }
  }, [docs, navigate])

  // ── 편집 모드 — 주소 `?edit=<장 앵커>` 가 있으면 같은 화면에서 고친다 (docs/ux/2026-11-25-doc-editing.md) ──
  const editParam = searchParams.get('edit')
  const editing = Boolean(doc) && editParam !== null
  // 초안은 계정별로 둔다 — 로그인 없는 데모에서는 데모 계정 아이디를 쓴다
  const accountId = session.loginId ?? session.userId
  /** 화면 묶음의 문서 — 편집하지 않을 때 보이는 본문 */
  const bundleBase = useMemo<EditBase | null>(() => (doc ? { version: doc.version, body: normBody(doc.body) } : null), [doc])
  /**
   * main 의 최신 버전(/api/docVersion) — 편집에 들어가거나 임시 저장이 있을 때 한 번 묻는다(doc-editing 2-6).
   * 화면 묶음보다 새것이면 그 본문을 편집·초안 복원 기준으로 쓴다. 못 읽으면 묻지 않고 묶음 본문으로
   */
  const remoteKey = doc ? `${doc.id}@${doc.version}` : ''
  const [remote, setRemote] = useState<{ key: string; v: DocVersion | null } | null>(null)
  const remoteReady = remote?.key === remoteKey
  const hasDraft = useMemo(() => (doc ? loadDraft(accountId, doc.id) !== null : false), [doc, accountId])
  const needRemote = Boolean(doc) && (editParam !== null || hasDraft)
  useEffect(() => {
    if (!doc || !needRemote || remote?.key === remoteKey) return
    let alive = true
    const done = (v: DocVersion | null) => alive && setRemote((r) => (r?.key === remoteKey ? r : { key: remoteKey, v }))
    // 오래 걸리면 기다리지 않는다 — 제출 때 409 흐름이 뒤를 받친다
    const t = setTimeout(() => done(null), 4000)
    fetchDocVersion(doc.path).then(done)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [doc, needRemote, remote, remoteKey])
  const docBase = useMemo<EditBase | null>(() => {
    const v = remoteReady ? remote.v : null
    // 로컬 지식 폴더가 main 보다 앞서 있으면(로컬 수정 중) 묶음 쪽을 둔다
    return v && bundleBase && v.version >= bundleBase.version ? { version: v.version, body: v.body } : bundleBase
  }, [remoteReady, remote, bundleBase])
  /** 409 뒤 서버가 준 최신본 — 배포 전까지는 화면 묶음 문서보다 새것을 기준으로 고친다 */
  const [baseOverride, setBaseOverride] = useState<EditBase | null>(null)
  const base = baseOverride ?? docBase
  /** 편집 칸 — 장마다 한 칸. 이어 붙이면(join '\n') 본문이다. null 이면 편집하지 않는 중 */
  const [parts, setParts] = useState<string[] | null>(null)
  const [open, setOpen] = useState<number[]>([])
  /** 원문 보기(고급) — 'sec' 는 연 장만 원문 칸, 'all' 은 문서 전체 원문 */
  const [raw, setRaw] = useState<false | 'sec' | 'all'>(false)
  const [showMarks, setShowMarks] = useState(true)
  const [reason, setReason] = useState('')
  const [reasonTouched, setReasonTouched] = useState(false)
  const [reference, setReference] = useState<{ label: string; text: string } | null>(null)
  /** 임시 저장이 있고 아직 고르지 않았다 — 고를 때까지 편집 칸을 초안으로 채우지 않는다 */
  const [draftInfo, setDraftInfo] = useState<{ draft: EditDraft; plan: Exclude<DraftRestore, { kind: 'empty' }> } | null>(null)
  /** 임시 저장을 찾았고 아직 고르지 않았다 — 같은 렌더 안에서 편집 칸이 먼저 열리지 않게 바로 본다 */
  const draftFound = useRef(false)
  const pickDraft = useCallback((v: { draft: EditDraft; plan: Exclude<DraftRestore, { kind: 'empty' }> } | null) => {
    draftFound.current = v !== null
    setDraftInfo(v)
  }, [])
  const [save, setSave] = useState<SaveState>({ state: 'idle' })
  const [submitOpen, setSubmitOpen] = useState(false)
  const [done, setDone] = useState<{ result: EditProposalResult; titles: string[] } | null>(null)
  const [exitAsk, setExitAsk] = useState(false)
  const [pendingSeen, setPendingSeen] = useState(false)
  const [flash, setFlash] = useState<number | null>(null)

  const viewParts = useMemo(() => (bundleBase ? splitSections(bundleBase.body).map((s) => s.text) : []), [bundleBase])
  const slots = parts ?? viewParts
  const body = parts ? parts.join('\n') : (base?.body ?? '')
  const baseSections = useMemo(() => (base ? splitSections(base.body) : []), [base])
  const baseByKey = useMemo(() => new Map(baseSections.map((s) => [s.key, s.text])), [baseSections])
  const keys = useMemo(() => slotKeys(slots), [slots])
  const changes = useMemo(() => (parts && base ? sectionChanges(baseSections, splitSections(body)) : []), [parts, base, baseSections, body])
  const slotOfKey = useCallback((key: string) => {
    const i = keys.indexOf(key)
    return i >= 0 ? i : null
  }, [keys])
  const autoReason = defaultEditReason(changes.map((c) => c.title))

  // 사유를 직접 쓰기 전에는 바뀐 장 이름으로 채워 둔다 — 버튼 하나로 제출 (requests-doc-edit.md 3-2)
  useEffect(() => {
    if (parts && !reasonTouched) setReason(autoReason)
  }, [autoReason, parts, reasonTouched])

  // 최신 값 — 떠날 때·탭 닫을 때의 저장은 렌더 밖에서 돈다
  const latest = useRef({ body, reason, base, parts, reference })
  latest.current = { body, reason, base, parts, reference }
  const lastSaved = useRef<string | null>(null)
  const snap = (b: string, r: string) => `${b}\u0000${r}`

  const saveNow = useCallback(() => {
    const { body: b, reason: r, base: bs, parts: ps, reference: ref } = latest.current
    if (!doc || !ps || !bs) return
    const s = snap(b, r)
    if (s === lastSaved.current) return
    lastSaved.current = s
    if (b === bs.body) {
      // 고친 것이 없으면 초안을 남기지 않는다 — 열고 닫기만 하면 아무것도 남지 않게. 합치는 중이면 옛 초안을 지우지 않는다
      if (!ref) removeDraft(accountId, doc.id)
      setSave({ state: 'idle' })
      return
    }
    const now = new Date()
    const ok = saveDraft(accountId, doc.id, { baseVersion: bs.version, baseBody: bs.body, body: b, reason: r, savedAt: now.toISOString() })
    if (!ok) lastSaved.current = null
    setSave(ok ? { state: 'saved', at: timeLabel(now) } : { state: 'failed' })
  }, [doc, accountId])
  const saveRef = useRef(saveNow)
  saveRef.current = saveNow

  const readDraft = useCallback(() => {
    if (!doc) return
    const draft = loadDraft(accountId, doc.id)
    if (!draft) return pickDraft(null)
    // 409 뒤 최신본(배포 전) 기준으로 저장한 초안 — 화면 문서보다 새 버전이라 그 기준 그대로 이어 고친다
    const bs = docBase ?? { version: doc.version, body: doc.body }
    const ahead = draft.baseVersion !== null && draft.baseBody !== null && draft.baseVersion > bs.version
    const plan: DraftRestore = ahead
      ? normBody(draft.body) === normBody(draft.baseBody!)
        ? { kind: 'empty' }
        : { kind: 'same', titles: (changedSections(draft.baseBody!, draft.body) ?? []).map((s) => s.title) }
      : planRestore(draft, bs.version, bs.body)
    if (plan.kind === 'empty') {
      removeDraft(accountId, doc.id)
      pickDraft(null)
    } else pickDraft({ draft, plan })
  }, [doc, accountId, docBase, pickDraft])

  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    // 최신 버전을 물어 보는 중이면 기다린다 — 초안 기준을 그 버전에 맞춘다
    if (!doc || !docBase || (needRemote && !remoteReady)) return
    // 문서 목록이 다시 그려져도 고른 결과를 되묻지 않게 계정·문서·버전마다 한 번만 읽는다
    const loadKey = `${accountId}.${doc.id}@${docBase.version}`
    if (loadedFor.current === loadKey) return
    loadedFor.current = loadKey
    readDraft()
  }, [doc, docBase, accountId, readDraft, needRemote, remoteReady])

  const startSession = useCallback(
    (opts: { body?: string; base?: EditBase | null; reason?: string; reference?: { label: string; text: string } | null; anchor?: string | null; keys?: string[] } = {}) => {
      if (!docBase) return
      const b = opts.base ?? docBase
      const ps = splitSections(opts.body ?? b.body).map((s) => s.text)
      setBaseOverride(opts.base ?? null)
      setParts(ps)
      setReason(opts.reason ?? '')
      setReasonTouched(Boolean(opts.reason))
      setReference(opts.reference ?? null)
      setRaw(false)
      setExitAsk(false)
      const ks = slotKeys(ps)
      const fromKeys = (opts.keys ?? []).map((k) => ks.indexOf(k)).filter((i) => i >= 0)
      const at = slotOfAnchor(ps, opts.anchor ?? null)
      setOpen(fromKeys.length ? fromKeys : at !== null ? [at] : opts.anchor === 'all' ? [0] : [])
      lastSaved.current = snap(ps.join('\n'), opts.reason ?? '')
      setSave({ state: 'idle' })
    },
    [docBase],
  )

  const endSession = useCallback(() => {
    setParts(null)
    setBaseOverride(null)
    setOpen([])
    setRaw(false)
    setReference(null)
    setExitAsk(false)
    setSubmitOpen(false)
    setSave({ state: 'idle' })
  }, [])

  // 편집 모드로 들어오면(주소에 ?edit=) 편집 칸을 연다. 임시 저장을 고르기 전에는 열지 않는다
  useEffect(() => {
    if (!editing || parts !== null || draftInfo || draftFound.current || !remoteReady || !doc || !docBase) return
    // 임시 저장을 아직 읽지 않았으면(최신 버전을 막 받음) 띠부터 — 고르기 전에는 편집 칸을 열지 않는다
    if (loadedFor.current !== `${accountId}.${doc.id}@${docBase.version}`) return
    startSession({ anchor: editParam })
  }, [editing, parts, draftInfo, editParam, startSession, remoteReady, accountId, doc, docBase])

  // 편집 모드에서 나가면(편집 끝내기·뒤로 가기) 바로 임시 저장하고 보기로 돌아간다
  useEffect(() => {
    if (editing || parts === null) return
    saveRef.current()
    endSession()
    readDraft()
  }, [editing, parts, endSession, readDraft])

  // 편집을 시작할 때 같은 문서의 대기 제안을 한 번 읽는다 — 못 읽으면 알림 없이 넘어간다(4-2)
  useEffect(() => {
    if (editing) ensureProposals()
  }, [editing, ensureProposals])

  // 글이 바뀌고 2초 쉬면 임시 저장
  useEffect(() => {
    if (!parts) return
    if (snap(body, reason) === lastSaved.current) return
    setSave({ state: 'pending' })
    const t = setTimeout(() => saveRef.current(), 2000)
    return () => clearTimeout(t)
  }, [body, reason, parts])

  // 허브 안에서 떠나면 막지 않는다 — 그 자리에서 저장하고 알린다(4-2). 탭을 닫는 건 저장 안 된 틈이 있을 때만 브라우저가 묻는다
  useEffect(
    () => () => {
      const { body: b, base: bs, parts: ps } = latest.current
      if (!ps || !bs) return
      saveRef.current()
      if (b !== bs.body) showToast(LEAVE_SAVED)
    },
    [showToast],
  )
  const sessionOn = parts !== null
  useEffect(() => {
    if (!sessionOn) return
    const unsaved = () => {
      const { body: b, reason: r, base: bs } = latest.current
      return Boolean(bs) && b !== bs!.body && snap(b, r) !== lastSaved.current
    }
    const onBefore = (e: BeforeUnloadEvent) => {
      if (!unsaved()) return
      e.preventDefault()
      e.returnValue = ''
    }
    // 실제로 떠나는 순간에는 묻지 않고 저장해 둔다 — 확인창에서 [나가기]를 눌러도 잃지 않게
    const onHide = () => saveRef.current()
    window.addEventListener('beforeunload', onBefore)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('beforeunload', onBefore)
      window.removeEventListener('pagehide', onHide)
    }
  }, [sessionOn])

  // location.hash는 퍼센트 인코딩된 상태다 — getElementById는 원문(디코딩된) id로 찾아야 한다
  const hashId = location.hash ? decodeURIComponent(location.hash.slice(1)) : null

  /**
   * 다른 문서로 이동하면 스크롤을 밑에 남겨 두지 않고 맨 위에서 새로 읽는다.
   * 단, 다른 문서의 특정 소제목을 가리키는 링크(`#h-...`)를 타고 왔으면
   * 그 소제목이 시작하는 위치로 바로 스크롤한다 — 문서 맨 위부터 다시 찾게 하지 않는다.
   */
  useEffect(() => {
    if (hashId) {
      const el = document.getElementById(hashId)
      if (el) {
        el.scrollIntoView({ block: 'start' })
        // 근거 카드·문서 링크로 들어온 장은 2초 강조한다 — 편집 패널의 장 이동과 같은 표시
        const slot = Number(el.closest('section.doc-sec')?.id.replace('sec-', ''))
        if (Number.isInteger(slot)) {
          setFlash(slot)
          const t = setTimeout(() => setFlash((f) => (f === slot ? null : f)), 2000)
          return () => clearTimeout(t)
        }
        return
      }
    }
    contentRef.current?.scrollTo({ top: 0 })
  }, [docId, hashId])

  useEffect(() => {
    setShowHistory(false)
    setActiveHeading(hashId && headings.some((h) => headingId(h.text) === hashId) ? hashId : headings[0] ? headingId(headings[0].text) : null)
  }, [docId, headings, hashId])

  // 지금 읽는 장 = 본문 위쪽 기준선을 마지막으로 넘은 제목. 바뀐 제목만 알려 주는 IntersectionObserver 는
  // 빠르게 스크롤하면 기준 구역을 건너뛰고, 목차로 이동하면 바로 아래 소제목을 잡아서 위치로 직접 잰다
  useEffect(() => {
    const box = contentRef.current
    if (!box || headings.length === 0) return
    let frame = 0
    const update = () => {
      frame = 0
      const els = headings.map((h) => document.getElementById(headingId(h.text))).filter((el): el is HTMLElement => Boolean(el))
      if (els.length === 0) return
      // 끝까지 내렸으면 마지막 제목 — 짧은 마지막 장은 기준선까지 올라오지 못한다
      if (box.scrollTop > 0 && box.scrollTop + box.clientHeight >= box.scrollHeight - 2) {
        setActiveHeading(els[els.length - 1].id)
        return
      }
      const line = box.getBoundingClientRect().top + 96
      let current = els[0].id
      for (const el of els) {
        if (el.getBoundingClientRect().top > line) break
        current = el.id
      }
      setActiveHeading(current)
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      box.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [headings, docId, md])

  // 목차가 길어 스크롤되면 지금 읽는 항목을 목차 안에서 보이게 한다 — 본문 스크롤은 건드리지 않게 목차 상자만 움직인다
  useEffect(() => {
    const toc = tocRef.current
    const on = toc?.querySelector<HTMLElement>('a.on')
    if (!toc || !on || toc.scrollHeight <= toc.clientHeight) return
    const pad = parseFloat(getComputedStyle(toc).paddingBottom) || 0
    if (on.offsetTop < toc.scrollTop) toc.scrollTop = on.offsetTop - 8
    else if (on.offsetTop + on.offsetHeight > toc.scrollTop + toc.clientHeight - pad) {
      toc.scrollTop = on.offsetTop + on.offsetHeight - toc.clientHeight + pad
    }
  }, [activeHeading])

  // 새로고침·링크로 편집 주소를 바로 열었을 때만 그 장으로 옮긴다 — 화면 안에서 눌러 연 장은 이미 보이는 자리라 움직이지 않는다
  const scrolledFor = useRef(false)
  useEffect(() => {
    if (!parts || scrolledFor.current) return
    scrolledFor.current = true
    const at = open[0]
    if (at === undefined) return
    const el = document.getElementById(`sec-${at}`)
    const box = contentRef.current
    if (!el || !box) return
    const r = el.getBoundingClientRect()
    const b = box.getBoundingClientRect()
    if (r.top < b.top || r.top > b.bottom - 80) el.scrollIntoView({ block: 'start' })
  }, [parts, open])

  const onChangeSlot = useCallback((slot: number, text: string) => {
    setParts((ps) => (ps ? ps.map((t, i) => (i === slot ? text : t)) : ps))
  }, [])
  const onCloseSlot = useCallback((slot: number) => {
    setOpen((o) => o.filter((i) => i !== slot))
    // 장을 닫을 때 바로 임시 저장한다
    setTimeout(() => saveRef.current(), 0)
  }, [])
  const onAccept = useCallback(
    (slot: number, result: AiEditResult) => {
      setParts((ps) => (ps ? ps.map((t, i) => (i === slot ? result.body : t)) : ps))
      // 사유를 직접 쓰지 않았을 때만 AI 요약을 넣는다
      if (!reasonTouched && result.summary) {
        setReason(`${result.summary} (AI 수정 · ${result.by})`)
        setReasonTouched(true)
      }
    },
    [reasonTouched],
  )

  const outline = useMemo(() => slots.map(sectionTitleOf).filter(Boolean), [slots])
  const renderMd = useCallback(
    (text: string, preamble: boolean) => <SectionView text={text} components={md.body} preamble={preamble} />,
    [md],
  )
  const onWholeRaw = useCallback(() => setRaw('all'), [])

  const checks = useEditChecks({ doc, docs, baseBody: base?.body ?? '', body, reason, changes, slotOfKey })

  if (!doc || !base) {
    return (
      <>
        <TopBar />
        <div className="content">
          <div className="empty">문서를 찾을 수 없습니다</div>
        </div>
      </>
    )
  }

  const commits = docCommits[doc.id] ?? [{ version: doc.version, author: doc.updatedBy, at: doc.updatedAt, message: '문서 등록' }]
  const fresh = freshnessOf(doc.updatedAt)
  // 첫 줄 '적용대상 **X**'는 [X] 칩이 대신 보여 준다 — 뒤에 붙은 설명(예: (B tv+))만 태그로 남긴다
  const scopeNotes = scoped.scope
    .map((s) => s.replace(/^적용대상 \*\*[^*]+\*\*\s*/, '').replace(/^[—–-]\s*/, '').trim())
    .filter(Boolean)
  /** 이 문서로 묻기 — 챗봇 창을 열고 입력칸에 문서 코드를 미리 넣는다. 질문은 사용자가 마저 쓴다 */
  const askDoc = () => openDockWith(`${doc.code} 기준으로: `)

  const tocLinks = (onPick?: () => void) =>
    headings.map((h, i) => {
      const id = headingId(h.text)
      return (
        <a
          key={`${i}-${id}`}
          href={`#${id}`}
          className={`${h.level === 3 ? 'h3' : ''}${activeHeading === id ? ' on' : ''}`}
          onClick={(e) => {
            e.preventDefault()
            // 접는 목차를 먼저 닫고 줄어든 화면에서 위치를 잰다 — 반대로 하면 목차 높이만큼 지나쳐 멈춘다
            onPick?.()
            requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
          }}
        >
          {h.text}
        </a>
      )
    })

  const setEditParam = (anchor: string, replace: boolean) => setSearchParams({ edit: anchor }, { replace })
  /** 장 [이 장 고치기] — 보기 중이면 편집 모드로 들어가며 그 장을 연다. 편집 중이면 그 장만 더 연다 */
  const editSlot = (i: number) => {
    const anchor = sectionAnchor(sectionTitleOf(slots[i]))
    if (parts && !draftInfo) {
      setOpen((o) => (o.includes(i) ? o : [...o, i]))
      setEditParam(anchor, true)
    } else setEditParam(anchor, false)
  }
  const exitEdit = () => {
    setExitAsk(false)
    setSearchParams({}, { replace: false })
  }
  const jump = (slot: number | null) => {
    setSubmitOpen(false)
    if (slot === null) return
    setOpen((o) => (o.includes(slot) ? o : [...o, slot]))
    requestAnimationFrame(() => document.getElementById(`sec-${slot}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    // 패널 항목을 누르면 그 장을 2초 강조한다
    setFlash(slot)
    setTimeout(() => setFlash((f) => (f === slot ? null : f)), 2000)
  }
  const continueDraft = (next: { body: string; base: EditBase | null; reference?: { label: string; text: string } }) => {
    if (!draftInfo) return
    const { draft } = draftInfo
    const bs = next.base ?? docBase!
    const first = (changedSections(bs.body, next.body) ?? [])[0]
    const anchor = editParam ?? (first ? sectionAnchor(first.title) : 'all')
    pickDraft(null)
    startSession({ body: next.body, base: next.base, reason: next.reference ? '' : draft.reason, reference: next.reference ?? null, anchor })
    if (!editing) setEditParam(anchor, false)
  }

  const pending = editing && proposals ? proposals.filter((p) => p.kind === 'edit' && p.status === 'pending' && p.docCode === doc.code) : []
  const ahead = editing && parts && base.version > doc.version ? base.version : null
  const saveLabel =
    save.state === 'pending'
      ? '저장 중…'
      : save.state === 'saved'
        ? `임시 저장 ${save.at}`
        : save.state === 'failed'
          ? '임시 저장 못 함 · 지금 할 일: 내용 복사해 두기'
          : '고치면 이 PC에 임시 저장돼요'

  return (
    <>
      {/* 편집 중 빨강은 편집 바 램프 하나 — 상단바 [묻기]는 테두리형 (docs/ux/2026-11-26-home-engine-assistant-cards.md A-7) */}
      <TopBar ask={editing ? 'line' : 'onair'} />
      <div className="content flush" style={{ overflow: 'auto' }} ref={contentRef}>
        {editing && parts && (
          <div className={`edit-bar${checks.blocked ? ' blocked' : ''}`} role="region" aria-label="편집 바">
            <span className={`lamp ${checks.blocked ? 'warn' : 'on'}`} aria-hidden="true" />
            <b className="edit-bar-title">
              {checks.blocked ? '제출 전 확인' : '편집 중'} · {doc.title}
            </b>
            <span className={`mono edit-bar-save${save.state === 'failed' ? ' err' : ''}`}>{saveLabel}</span>
            <span className="edit-bar-gap" />
            <button className="btn sm" aria-pressed={!showMarks} onClick={() => setShowMarks((v) => !v)}>
              {showMarks ? '바뀐 곳 표시 끄기' : '바뀐 곳 표시 켜기'}
            </button>
            <button className="btn sm" onClick={() => setRaw((v) => (v ? false : 'sec'))}>
              {raw ? '보기 모양으로' : '원문 보기(고급)'}
            </button>
            <button className="btn sm edit-bar-submit" disabled={changes.length === 0} onClick={() => setSubmitOpen(true)}>
              제출하기
            </button>
            <button className="btn sm primary" onClick={() => (changes.length > 0 ? setExitAsk(true) : exitEdit())}>
              편집 끝내기
            </button>
            {exitAsk && (
              <div className="edit-bar-ask" role="alertdialog" aria-label="편집 끝내기">
                <span>고친 내용은 임시 저장돼 있어요. 보기로 돌아갈까요?</span>
                <button className="btn sm primary" onClick={exitEdit}>
                  돌아가기
                </button>
                <button className="btn sm" onClick={() => setExitAsk(false)}>
                  계속 고치기
                </button>
              </div>
            )}
            {ahead && (
              <div className="edit-bar-note">ⓘ 승인된 새 버전(v{ahead})으로 고쳐요 — 화면의 문서에는 아직 반영 전이에요</div>
            )}
          </div>
        )}
        <div className={`doc-layout${editing ? ' editing' : ''}`}>
          <div className="doc-body">
            {draftInfo && (
              <DraftBanner
                draft={draftInfo.draft}
                plan={draftInfo.plan}
                docVersion={docBase!.version}
                onContinue={() => {
                  const { draft, plan } = draftInfo
                  const ahead = draft.baseVersion !== null && draft.baseBody !== null && draft.baseVersion > docBase!.version
                  if (plan.kind === 'rebased') continueDraft({ body: plan.body, base: null })
                  else continueDraft({ body: draft.body, base: ahead ? { version: draft.baseVersion!, body: normBody(draft.baseBody!) } : null })
                }}
                onMerge={() =>
                  continueDraft({
                    body: docBase!.body,
                    base: null,
                    reference: {
                      label: `내 임시 저장본${draftInfo.draft.baseVersion !== null ? ` (v${draftInfo.draft.baseVersion} 기준)` : ''}`,
                      text: draftInfo.draft.body,
                    },
                  })
                }
                onDiscard={() => {
                  removeDraft(accountId, doc.id)
                  pickDraft(null)
                }}
              />
            )}
            {/* 문서 머리 — 왼쪽 카테고리 띠 + 타임코드 메타 + 적용대상 칩 + 최신성 램프 (identity-redesign 4-2) */}
            <div className="doc-head" data-cat={doc.category}>
              <div className="doc-title">
                <h1>{doc.title}</h1>
                <div className="doc-meta doc-tc">
                  <span className="tc strong">{doc.code}</span>
                  <span className="sep">·</span>
                  <span className="tc">v{doc.version}</span>
                  <span className="sep">·</span>
                  <span>
                    <span className="tc">{doc.updatedAt}</span> 갱신
                  </span>
                  <span className="sep">·</span>
                  <span>{doc.updatedBy}</span>
                </div>
                <div className="doc-meta">
                  <ScopeChip scope={doc.scope} />
                  {scopeNotes.map((s, i) => (
                    <span key={i} className="doc-scope">
                      <ReactMarkdown remarkPlugins={PLUGINS} components={md.scope}>
                        {s}
                      </ReactMarkdown>
                    </span>
                  ))}
                  <FreshLamp updatedAt={doc.updatedAt} />
                </div>
              </div>
              <button className="btn sm" onClick={() => setShowHistory((v) => !v)}>
                ⎇ 히스토리
              </button>
              {!editing && (
                // 지금 읽는 장을 열고 편집 모드로 — 페이지를 옮기지 않는다
                <button className="btn sm primary" onClick={() => setEditParam(activeHeading ?? 'all', false)}>
                  ✎ 고치기
                </button>
              )}
              {/* 오른쪽 칸이 접히는 좁은 폭에서만 — 넓은 화면은 문서 정보 카드 아래 버튼을 쓴다 */}
              {!editing && (
                <button className="btn sm doc-ask-inline" onClick={askDoc}>
                  <Icon name="ask" />
                  이 문서로 묻기
                </button>
              )}
            </div>

            {fresh.level === 'old' && (
              <div className="doc-stale" role="note">
                <span className="lamp no" aria-hidden="true" />
                90일 넘게 갱신되지 않은 문서예요. 담당 {doc.ownerId} 에게 확인하고 쓰세요
              </div>
            )}

            {showHistory && (
              <div className="panel" style={{ marginBottom: 16 }}>
                <div className="panel-head">
                  <span className="label strong">수정 이력</span>
                </div>
                {commits.map((c) => (
                  <div key={c.version} className="row">
                    <span className="tag">v{c.version}</span>
                    <span className="grow">{c.message}</span>
                    <span className="muted">{c.author}</span>
                    <span className="muted">{c.at}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 목차 열이 숨는 좁은 폭(챗봇 창을 열었을 때 등)에서만 보이는 접는 목차 */}
            {headings.length > 0 && (
              <details className="panel doc-toc-inline" key={doc.id} ref={inlineTocRef}>
                <summary>목차 ({headings.length})</summary>
                <div className="doc-toc-inline-list">{tocLinks(() => inlineTocRef.current?.removeAttribute('open'))}</div>
              </details>
            )}

            {editing && parts && raw === 'all' ? (
              <div className="raw-editor">
                <div className="form-actions">
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    문서 전체 원문이에요. 여기서 고친 것도 같은 검사·같은 「바뀐 곳」 목록에 들어가요.
                  </span>
                  <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setRaw('sec')}>
                    장으로 나눠 보기
                  </button>
                </div>
                <textarea
                  className="field raw-textarea"
                  value={body}
                  onChange={(e) => {
                    setParts(splitSections(e.target.value).map((s) => s.text))
                    setOpen([])
                  }}
                  aria-label="문서 전체 원문"
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className={`md doc-md${showMarks ? '' : ' marks-off'}`}>
                {slots.map((text, i) => {
                  const title = sectionTitleOf(text)
                  const preamble = i === 0 && !title
                  const isOpen = Boolean(parts) && open.includes(i)
                  // 장 제목을 고쳐 key 가 달라졌어도 장 수가 같으면 같은 자리의 장을 기준으로 칠한다
                  const baseText = baseByKey.get(keys[i]) ?? (parts && baseSections.length === slots.length ? baseSections[i].text : null)
                  const changed = Boolean(parts) && baseText !== text
                  return (
                    <section
                      key={i}
                      id={`sec-${i}`}
                      className={`doc-sec${changed ? ' changed' : ''}${isOpen ? ' open' : ''}${flash === i ? ' flash' : ''}${title ? '' : ' intro'}`}
                    >
                      {isOpen ? (
                        <SectionEditor
                          doc={doc}
                          docBody={body}
                          outline={outline}
                          slot={i}
                          title={title}
                          text={text}
                          baseText={baseText}
                          preamble={preamble}
                          mode={raw ? 'raw' : 'blocks'}
                          showMarks={showMarks}
                          renderMd={renderMd}
                          onChange={onChangeSlot}
                          onClose={onCloseSlot}
                          onAccept={onAccept}
                          onWholeRaw={onWholeRaw}
                        />
                      ) : (
                        <>
                          <SectionView text={text} components={md.body} preamble={preamble} />
                          {changed && baseText === null && <span className="sec-new">새로</span>}
                          {/* 머리말이 적용대상 줄뿐이면(메타 줄 태그로 옮겨 보임) 고칠 것이 안 보이므로 단추도 두지 않는다 — 원문 보기에서 고친다 */}
                          {!(preamble && !splitScope(text).body.trim()) && (
                            <button
                              className="sec-edit"
                              onClick={() => editSlot(i)}
                              title={`「${sectionLabel(title)}」 장만 고쳐요 — 읽던 자리에서 열려요`}
                            >
                              ✎ {title ? '이 장 고치기' : '머리말 고치기'}
                            </button>
                          )}
                        </>
                      )}
                    </section>
                  )
                })}
              </div>
            )}
          </div>

          {editing && parts ? (
            <DocEditPanel
              changes={changes}
              checks={checks}
              body={body}
              parts={parts}
              reason={reason}
              defaultReason={autoReason}
              onReason={(v) => {
                setReason(v)
                setReasonTouched(true)
              }}
              onFillReason={() => {
                setReason(autoReason)
                setReasonTouched(false)
              }}
              onJump={jump}
              slotOfKey={slotOfKey}
              onSubmit={() => setSubmitOpen(true)}
              onDiscardAll={() => {
                removeDraft(accountId, doc.id)
                startSession({ anchor: editParam })
              }}
              pendingNote={
                !pendingSeen && pending.length > 0 ? (
                  <PendingProposalsNote pending={pending} myName={session.name} onDismiss={() => setPendingSeen(true)} />
                ) : null
              }
              reference={reference}
              onCloseReference={() => setReference(null)}
            />
          ) : (
            // 오른쪽 칸 — 문서 정보 카드 → 이 문서로 묻기 → 목차. 카드는 5줄 고정이라 목차를 크게 밀지 않는다
            <aside className="doc-side">
              <section className="panel doc-info" data-cat={doc.category} aria-label="문서 정보">
                <div className="doc-info-head">
                  <span className="label strong">문서 정보</span>
                  <span className="doc-info-cat">
                    <span className="cat-dot" aria-hidden="true" />
                    {categoryLabel(doc.category)}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>코드</dt>
                    <dd className="tc">{doc.code}</dd>
                  </div>
                  <div>
                    <dt>담당</dt>
                    <dd>{doc.ownerId}</dd>
                  </div>
                  <div>
                    <dt>갱신</dt>
                    <dd>
                      <span className="tc">{doc.updatedAt.slice(5)}</span> ({agoLabel(doc.updatedAt)})
                    </dd>
                  </div>
                  <div>
                    <dt>상태</dt>
                    <dd>
                      <FreshLamp updatedAt={doc.updatedAt} basis />
                    </dd>
                  </div>
                  <div>
                    <dt>적용</dt>
                    <dd>
                      <ScopeChip scope={doc.scope} />
                    </dd>
                  </div>
                </dl>
              </section>
              <button className="btn block doc-ask" onClick={askDoc} title={`챗봇 창을 열고 「${doc.code} 기준으로: 」를 넣어 둬요`}>
                <Icon name="ask" />
                이 문서로 묻기
              </button>
              <nav className="doc-toc" ref={tocRef} aria-label="이 페이지 목차">
                <div className="label" style={{ marginBottom: 8 }}>
                  이 페이지 목차
                </div>
                {tocLinks()}
              </nav>
            </aside>
          )}
        </div>
      </div>

      {submitOpen && parts && (
        <SubmitEditDialog
          doc={doc}
          base={base}
          body={body}
          reason={reason}
          defaultReason={autoReason}
          onReason={(v) => {
            setReason(v)
            setReasonTouched(true)
          }}
          changes={changes}
          checks={checks}
          parts={parts}
          pendingCount={pending.length}
          onClose={() => setSubmitOpen(false)}
          onGoFix={jump}
          onRebase={(next, nextBody) => {
            const openKeys = open.map((i) => keys[i])
            const ps = splitSections(nextBody).map((s) => s.text)
            const ks = slotKeys(ps)
            setBaseOverride(next)
            setParts(ps)
            setOpen(openKeys.map((k) => ks.indexOf(k)).filter((i) => i >= 0))
          }}
          onReEdit={(next, nextBody, mine, clashKeys) => {
            startSession({ body: nextBody, base: next, reason, reference: { label: '내가 쓴 글', text: mine }, keys: clashKeys })
            setSubmitOpen(false)
          }}
          onSubmitted={(result) => {
            // 초안은 PR 이 실제로 만들어진 뒤에만 지운다 — 실패하면 긴 수정이 그대로 남아야 한다
            removeDraft(accountId, doc.id)
            lastSaved.current = null
            setDone({ result, titles: changes.map((c) => c.title) })
            endSession()
            pickDraft(null)
            setSearchParams({}, { replace: true })
            void refreshProposals()
          }}
        />
      )}
      {done && <SubmitDoneDialog result={done.result} titles={done.titles} onClose={() => setDone(null)} />}
    </>
  )
}
