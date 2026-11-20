import { Fragment, useCallback, useEffect, useId, useRef, useState, type RefObject } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ENGINE_LABEL,
  ENGINE_TIMEOUT_MS,
  ENGINE_WAIT_HINT,
  PLACEHOLDER_EXAMPLES,
  PLAN_STARTER,
  QUESTION_TEMPLATES,
  RULE_BASED_LABEL,
  SUGGESTED_QUESTIONS,
  fallbackCodes,
  fallbackNotice,
} from '../lib/assistant'
import { docAskChips, docAskHint, docAskPlaceholder, docAskSentence, docAskVia } from '../lib/docAsk'
import { REPORT_TIMEOUT_MS, REPORT_WAIT_HINT } from '../lib/report'
import { useApp, type IntentChoice } from '../store/AppStore'
import type { ChatMessage, Engine, PromotionBrief, WikiDoc } from '../types'
import { EngineGuideModal } from './EngineGuide'
import { ReportCard } from './ReportCard'

// 굵게 안의 가린 이름(류*영)도 굵게로 묶이게 단일 `*` 는 허용한다
const BOLD = /(\*\*(?:[^*]|\*(?!\*))+?\*\*)/g

function Inline({ line }: { line: string }) {
  return (
    <>
      {line.split(BOLD).map((p, j) =>
        p.startsWith('**') && p.endsWith('**') ? <b key={j}>{p.slice(2, -2)}</b> : p,
      )}
    </>
  )
}

function RichText({ text }: { text: string }) {
  // 빈 줄로만 문단을 나눈다 — 줄마다 문단을 만들면 문단 안 줄바꿈과 문단 사이가 구분되지 않는다
  const paras = text
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n[ \t]*\n\s*/)
    .filter((para) => para.trim())
  return (
    <div className="msg-text">
      {paras.map((para, i) => (
        <p key={i}>
          {para.split('\n').map((line, j) => (
            <Fragment key={j}>
              {j > 0 && <br />}
              <Inline line={line} />
            </Fragment>
          ))}
        </p>
      ))}
    </div>
  )
}

/**
 * 진행 의도 확인 — 조건 카드를 먼저 띄우지 않고 "진행하려는 프로모션이 있는지"부터 묻는다.
 * '네'를 고르면 상품 유형만 확인하고 프로모션 어드민 화면을 새 탭으로 연다.
 */
function IntentChip({ msg }: { msg: ChatMessage }) {
  const { resolveIntent } = useApp()
  const intent = msg.intent
  if (!intent) return null

  const choices: { label: string; value: IntentChoice }[] =
    intent.kind === 'confirm'
      ? [
          { label: '네, 진행할게요', value: 'yes' },
          { label: '아니요, 질문만 할게요', value: 'no' },
        ]
      : intent.kind === 'product' || intent.kind === 'product-qa'
        ? [
            { label: '월정액(PPM)', value: 'PPM' },
            { label: '단건(PPV)', value: 'PPV' },
          ]
        : intent.kind === 'ppm-detail'
          ? [
              { label: 'B tv+', value: 'btvplus' },
              { label: '지상파·종편·CP 월정액', value: 'ppm-other' },
            ]
          : [
              { label: '카피 추천받기', value: 'copy' },
              { label: '노출 구좌 추천받기', value: 'placement' },
              { label: '프로모션 자동화로 연결', value: 'handoff' },
              { label: '조금 더 정리할게요', value: 'later' },
            ]

  return (
    <div className="intent-chip">
      <span className="t">{intent.question}</span>
      <div className="suggest">
        {choices.map((c) => (
          <button key={c.value} onClick={() => resolveIntent(msg.id, c.value)}>
            {c.label}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * 프로모션 뼈대 — 대화에서 모인 이벤트명·기간·스킴을 한눈에 보여 준다.
 * 아직 모르는 칸은 지어내지 않고 '미정'으로 남긴다.
 */
function BriefCard({ brief }: { brief: PromotionBrief }) {
  const rows: [string, string][] = [
    ['상품', brief.product],
    ['이벤트명', brief.name],
    ['기간', brief.period],
    ['스킴', brief.scheme],
    ['구좌', brief.channel],
  ]
  return (
    <div className="brief-card">
      <span className="t">지금까지 정리된 프로모션</span>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className={v ? undefined : 'todo'}>
            <dt>{k}</dt>
            <dd>{v || '미정'}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * 이 답의 근거 — 답 바로 밑에 문서 제목·코드·열기를 둔다. 제목·코드는 라벨을 쪼개지 않고 문서 목록에서 읽고,
 * 라벨은 앞머리(`참고 ·` = 위키 수정 안내 답)만 본다. 사라진 문서 줄은 뺀다.
 */
function SourceList({ msg }: { msg: ChatMessage }) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { docs } = useApp()
  const rows = (msg.sources ?? []).flatMap((s) => {
    const doc = docs.find((d) => d.id === s.docId)
    return doc ? [{ s, doc }] : []
  })

  if (rows.length === 0) {
    // 되묻기·정리 카드·리포트·리포트 실패·대화로 만든 안내는 질문에 대한 답이 아니거나 다음 행동이 따로 있다
    if (msg.intent || msg.intentAnswer || msg.brief || msg.report || msg.reportFailed || !msg.query || !msg.text) return null
    const q = msg.query
    return (
      <div className="msg-sources none">
        <span className="muted">근거 문서 없음</span>
        <button type="button" className="btn sm" onClick={() => navigate(`/search?q=${encodeURIComponent(q)}`)}>
          위키에서 찾아보기 →
        </button>
      </div>
    )
  }

  const label = rows[0].s.label.startsWith('참고 ·') ? '참고할 문서' : '이 답의 근거'
  return (
    <div className={`msg-sources${rows.length === 1 ? ' one' : ''}`}>
      <span className="label">{label}</span>
      {rows.map(({ s, doc }) => {
        const to = `/wiki/${doc.id}${s.anchor ? `#${s.anchor}` : ''}`
        // 지금 화면의 문서면 갈 곳이 없다 — 버튼 대신 글자로 알린다
        const here = pathname === `/wiki/${doc.id}`
        return (
          <div key={s.docId} className="source-row">
            {here ? (
              <span className="source-title">{doc.title}</span>
            ) : (
              <button type="button" className="source-title" onClick={() => navigate(to)}>
                {doc.title}
              </button>
            )}
            <span className="tag">{doc.code}</span>
            {here ? (
              <span className="source-open muted">지금 보는 문서</span>
            ) : (
              <button type="button" className="btn sm source-open" aria-label={`${doc.title} 문서 열기`} onClick={() => navigate(to)}>
                {s.anchor ? '해당 부분 열기' : '열기'}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Message({ msg }: { msg: ChatMessage }) {
  const { session, assistant, askAgain } = useApp()
  // 안내는 규칙 기반으로 떨어진 답에만 — 다음 엔진이 답했으면 답은 정상이라 출처 줄만 남긴다
  const notice = msg.fallback?.length && msg.answeredBy === RULE_BASED_LABEL ? fallbackNotice(msg.fallback) : null
  // 관리자에게만 엔진·분류 코드를 붙인다 — 원문 사유는 관리자 화면에도 두지 않는다
  const codes = session.role === 'admin' && msg.fallback?.length ? fallbackCodes(msg.fallback) : null
  // answeredBy 는 엔진 이름으로 시작한다(앞선 실패가 있으면 뒤에 괄호가 붙는다) — 공용 엔진 답에만 차이 안내를 붙인다
  const byShared = msg.answeredBy?.startsWith(ENGINE_LABEL.gemini) ?? false
  const [guideOpen, setGuideOpen] = useState(false)

  if (msg.role === 'user')
    return (
      <div className="msg user">
        {msg.via && <span className="msg-via">{msg.via}</span>}
        {msg.text}
      </div>
    )

  return (
    <div className={`msg bot${msg.report ? ' has-report' : ''}`}>
      {msg.text && <RichText text={msg.text} />}
      {msg.report && <ReportCard msg={msg} />}
      <SourceList msg={msg} />
      {msg.notice && <div className="fallback-notice">{msg.notice}</div>}
      {(msg.reportHint === 'offer' || msg.reportFailed) && (
        <div className="suggest report-chip">
          <button type="button" disabled={assistant.pending} onClick={() => askAgain(msg.id, msg.reportFailed ? 'qa' : 'report')}>
            {msg.reportFailed ? '짧게 답 받기' : '리포트로 자세히 받기'}
          </button>
          {!msg.reportFailed && <span className="muted">근거·비교를 갖춘 보고 문서로 받습니다 · {REPORT_WAIT_HINT}</span>}
        </div>
      )}
      {msg.brief && <BriefCard brief={msg.brief} />}
      {msg.intent && <IntentChip msg={msg} />}
      {msg.intentAnswer && <div className="intent-answer">선택 · {msg.intentAnswer}</div>}
      {notice && <div className="fallback-notice">{notice}</div>}
      {msg.answeredBy && (
        <div className="by">
          답변 · {msg.answeredBy}
          {codes && ` · ${codes}`}
        </div>
      )}
      {byShared && (
        <div className="by engine-by">
          공용 AI로 답했어요 ·{' '}
          <button type="button" className="cli-os-switch" onClick={() => setGuideOpen(true)}>
            차이 보기
          </button>
        </div>
      )}
      {guideOpen && <EngineGuideModal onClose={() => setGuideOpen(false)} />}
    </div>
  )
}

/** 리포트 대기 — 단계 표시는 2차(stream-json)라 지금은 경과 시간만 보여 준다 */
function ReportWaiting({ engine, since }: { engine: Exclude<Engine, 'gemini'>; since: number }) {
  const { cancelReport } = useApp()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const secs = Math.max(0, Math.floor((now - since) / 1000))
  const maxMin = Math.round((REPORT_TIMEOUT_MS[engine] - 30_000) / 60_000)
  return (
    <div className="typing report-wait">
      <span>
        {ENGINE_LABEL[engine]}가 리포트를 정리하는 중입니다 · {REPORT_WAIT_HINT} · 최대 {maxMin}분 ·{' '}
        <b>
          {Math.floor(secs / 60)}분 {String(secs % 60).padStart(2, '0')}초
        </b>{' '}
        지남
      </span>
      <button type="button" className="btn sm" onClick={cancelReport}>
        그만하고 짧게 답 받기
      </button>
    </div>
  )
}

function engineTitle(e: Engine, usable: boolean, installed: boolean): string {
  if (e === 'gemini') return usable ? 'Gemini API로 답변' : 'Gemini API 키가 설정되지 않았습니다'
  if (usable) return `${ENGINE_LABEL[e]} CLI로 답변`
  return installed
    ? `${ENGINE_LABEL[e]} CLI 로그인이 필요합니다 — 대시보드에서 로그인`
    : `${ENGINE_LABEL[e]} CLI가 설치되어 있지 않습니다`
}

/** 서버가 알려준 엔진만 보인다 — 로컬 허브는 CLI+Gemini, 배포 허브는 Gemini. 쓸 수 없는 엔진은 비활성화한다. */
export function EngineToggle({ label = '답변 엔진', busy = false }: { label?: string; busy?: boolean }) {
  const { assistant, setEngine } = useApp()
  const { engines, engine } = assistant
  const pending = assistant.pending || busy
  if (!engines) return null
  const shown = (Object.keys(ENGINE_LABEL) as Engine[]).filter((e) => e in engines)
  if (shown.length === 0) return null

  return (
    <div className="engine-row">
      <span>{label}</span>
      <div className="engine-toggle" role="radiogroup" aria-label={label}>
        {shown.map((e) => (
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={engine === e}
            className={engine === e ? 'on' : undefined}
            disabled={!engines[e] || pending}
            title={engineTitle(e, Boolean(engines[e]), Boolean(assistant.engineStatus?.[e]?.installed))}
            onClick={() => setEngine(e)}
          >
            {ENGINE_LABEL[e]}
          </button>
        ))}
      </div>
    </div>
  )
}

/** 바로가기 버튼 아이콘 — 라벨 왼쪽에 붙는 14px 선 아이콘 */
function QuickIcon({ name }: { name: 'tv' | 'calendar' | 'spark' | 'pencil' }) {
  const paths = {
    tv: (
      <>
        <rect x="2" y="7" width="20" height="13" rx="2" />
        <path d="m7 3 5 4 5-4" />
      </>
    ),
    calendar: (
      <>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </>
    ),
    spark: <path d="M12 3v4M12 17v4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M3 12h4M17 12h4M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8" />,
    pencil: <path d="M4 20h4L19 9l-4-4L4 16v4Z" />,
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

/**
 * 바로가기 — 챗봇 안에서 편성 스케줄·캠페인 현황을 열고, 프로모션 기획도 바로 시작한다.
 * 화면을 보면서 이어서 물어볼 수 있게 이동해도 독은 닫지 않는다.
 * 빈칸 질문 입구도 여기 둔다 — 대화가 진행 중이어도 늘 보이는 자리라서
 */
function QuickActions({
  onPlan,
  onTemplate,
  templateOpen,
  templatePanelId,
  templateEntryRef,
}: {
  onPlan: () => void
  onTemplate: () => void
  templateOpen: boolean
  templatePanelId: string
  templateEntryRef: RefObject<HTMLButtonElement>
}) {
  const navigate = useNavigate()

  return (
    <div className="dock-quick">
      <span className="label">바로 확인하기</span>
      <div className="suggest">
        <button onClick={() => navigate('/sheets/btv')}>
          <QuickIcon name="tv" />Today B tv 편성표
        </button>
        <button onClick={() => navigate('/sheets/campaign')}>
          <QuickIcon name="calendar" />캠페인 신청 캘린더
        </button>
        <button onClick={onPlan}>
          <QuickIcon name="spark" />프로모션 기획 시작하기
        </button>
        <button
          ref={templateEntryRef}
          aria-expanded={templateOpen}
          aria-controls={templateOpen ? templatePanelId : undefined}
          onClick={onTemplate}
        >
          <QuickIcon name="pencil" />빈칸 채워 질문하기
        </button>
      </div>
    </div>
  )
}

/* ---------- 빈칸 채워 질문하기 ---------- */

interface TemplateState {
  open: boolean
  id: string
  filled: Record<string, string>
  /** 지금 값을 고르는 빈칸 — 한 번에 하나만 */
  active: string | null
}

const findTemplate = (id: string) => QUESTION_TEMPLATES.find((t) => t.id === id) ?? QUESTION_TEMPLATES[0]

const slotOrder = (id: string) =>
  findTemplate(id).parts.flatMap((p) => (typeof p === 'string' ? [] : [p.slot]))

function slotValues(id: string, slotId: string, filled: Record<string, string>): string[] {
  const slot = findTemplate(id).slots[slotId]
  if (!slot.dependsOn) return slot.values ?? []
  const parent = filled[slot.dependsOn]
  return parent ? slot.valuesBy?.[parent] ?? [] : []
}

/** 앞 빈칸이 비어 있으면 딸린 빈칸은 고를 수 없다 */
const slotReady = (id: string, slotId: string, filled: Record<string, string>) => {
  const dep = findTemplate(id).slots[slotId].dependsOn
  return !dep || Boolean(filled[dep])
}

/** 문장 순서로 `from` 다음의 빈 빈칸, 없으면 앞쪽 빈 빈칸 */
function nextEmptySlot(id: string, filled: Record<string, string>, from?: string): string | null {
  const order = slotOrder(id)
  const start = from ? order.indexOf(from) + 1 : 0
  const rotated = [...order.slice(start), ...order.slice(0, start)]
  return rotated.find((s) => !filled[s] && slotReady(id, s, filled)) ?? null
}

const freshTemplate = (id: string): TemplateState => {
  const tid = findTemplate(id).id
  return { open: true, id: tid, filled: {}, active: nextEmptySlot(tid, {}) }
}

const CLOSED_TEMPLATE: TemplateState = { open: false, id: QUESTION_TEMPLATES[0].id, filled: {}, active: null }

function TemplatePanel({
  panelId,
  state,
  pending,
  valuesRef,
  sendRef,
  onPickTemplate,
  onPickSlot,
  onPickValue,
  onCancel,
  onSend,
}: {
  panelId: string
  state: TemplateState
  pending: boolean
  valuesRef: RefObject<HTMLDivElement>
  sendRef: RefObject<HTMLButtonElement>
  onPickTemplate: (id: string) => void
  onPickSlot: (slotId: string) => void
  onPickValue: (slotId: string, value: string) => void
  onCancel: () => void
  onSend: (sentence: string) => void
}) {
  const tpl = findTemplate(state.id)
  const valuesId = useId()
  const remaining = slotOrder(tpl.id).filter((s) => !state.filled[s]).length
  const sentence = tpl.parts.map((p) => (typeof p === 'string' ? p : state.filled[p.slot] ?? '')).join('')
  const activeSlot = state.active ? tpl.slots[state.active] : null
  const values = state.active ? slotValues(tpl.id, state.active, state.filled) : []
  // 두 조건이 함께면 빈칸 안내가 먼저다
  const sendBlock = remaining > 0 ? '빈칸을 모두 채워 주세요' : pending ? '답을 받는 중에는 보낼 수 없습니다' : null

  return (
    <div
      className="dock-template"
      id={panelId}
      role="region"
      aria-label="빈칸 채워 질문하기"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        onCancel()
      }}
    >
      <div className="tpl-head">
        <span className="label strong">빈칸 채워 질문하기</span>
        <button type="button" className="btn sm" onClick={onCancel}>
          닫기
        </button>
      </div>

      <div className="tpl-field">
        <span className="label">질문 틀</span>
        <div className="suggest" role="group" aria-label="질문 틀">
          {QUESTION_TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={t.id === tpl.id}
              className={t.id === tpl.id ? 'on' : undefined}
              onClick={() => onPickTemplate(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <p className="tpl-sentence">
        {tpl.parts.map((p, i) => {
          if (typeof p === 'string') return <Fragment key={i}>{p}</Fragment>
          const slot = tpl.slots[p.slot]
          const value = state.filled[p.slot]
          const on = state.active === p.slot
          const ready = slotReady(tpl.id, p.slot, state.filled)
          return (
            <button
              key={i}
              type="button"
              className={`tpl-slot ${value ? 'filled' : 'empty'}${on ? ' on' : ''}`}
              disabled={!ready}
              title={ready ? undefined : '앞 빈칸을 먼저 고르세요'}
              aria-label={value ? `${slot.label} 빈칸, ${value} 선택됨` : `${slot.label} 빈칸, 비어 있음`}
              aria-expanded={on}
              aria-controls={on ? valuesId : undefined}
              onClick={() => onPickSlot(p.slot)}
            >
              {value || `${slot.label} ▾`}
            </button>
          )
        })}
      </p>

      {activeSlot && state.active && (
        <div className="tpl-field">
          <span className="label">{activeSlot.label} 고르기</span>
          <div className="suggest" role="group" aria-label={`${activeSlot.label} 고르기`} id={valuesId} ref={valuesRef}>
            {values.map((v) => {
              const picked = state.filled[state.active!] === v
              return (
                <button
                  key={v}
                  type="button"
                  aria-pressed={picked}
                  className={picked ? 'on' : undefined}
                  onClick={() => onPickValue(state.active!, v)}
                >
                  {v}
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="tpl-field">
        <span className="label">보낼 문장</span>
        <div className="tpl-preview" aria-live="polite">
          {remaining > 0 ? (
            <span className="muted">빈칸 {remaining}개를 채우면 문장이 완성됩니다</span>
          ) : (
            <div className="msg user">{sentence}</div>
          )}
        </div>
      </div>

      <div className="tpl-actions">
        <button type="button" className="btn sm" onClick={onCancel}>
          취소
        </button>
        <button
          type="button"
          ref={sendRef}
          className="btn sm accent"
          disabled={Boolean(sendBlock)}
          title={sendBlock ?? undefined}
          onClick={() => onSend(sentence)}
        >
          보내기
        </button>
      </div>
    </div>
  )
}

/* ---------- 이 문서로 질문 ---------- */

/** 위키 문서 머리에서 연 패널 — 칩 글자가 곧 보내는 글자다. 누르기 전에는 아무것도 보내지 않는다 */
function DocAskPanel({
  doc,
  pending,
  chipsRef,
  onCancel,
  onSend,
}: {
  doc: WikiDoc
  pending: boolean
  chipsRef: RefObject<HTMLDivElement>
  onCancel: () => void
  onSend: (sentence: string) => void
}) {
  const block = pending ? '답을 받는 중에는 보낼 수 없습니다' : undefined
  return (
    <div
      className="dock-template dock-docask"
      role="region"
      aria-label="이 문서로 질문"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        e.preventDefault()
        onCancel()
      }}
    >
      <div className="tpl-head">
        <span className="label strong">이 문서로 질문</span>
        <button type="button" className="btn sm" aria-label="이 문서로 질문 닫기" onClick={onCancel}>
          닫기
        </button>
      </div>
      <div className="docask-doc">
        <span className="tag">{doc.code}</span>
        <span className="muted">·</span>
        <span>{doc.title}</span>
      </div>
      <div className="suggest" role="group" aria-label="이 문서 예시 질문" ref={chipsRef}>
        {docAskChips(doc.code).map((q) => (
          <button key={q} type="button" disabled={pending} title={block} onClick={() => onSend(q)}>
            {q}
          </button>
        ))}
      </div>
      <span className="docask-hint muted">{docAskHint(doc.code)}</span>
    </div>
  )
}

/**
 * 입력창 placeholder 순환 — 4초마다 다음 예시. 포커스·입력 중에는 멈추고,
 * 동작 줄이기 설정이면 첫 예시에 고정한다.
 */
function usePlaceholderCycle(paused: boolean) {
  const [index, setIndex] = useState(0)
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
  const wasPaused = useRef(paused)

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = () => setReduced(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const resumed = wasPaused.current && !paused
    wasPaused.current = paused
    if (reduced || paused) return
    const next = () => setIndex((i) => (i + 1) % PLACEHOLDER_EXAMPLES.length)
    // 멈췄다 다시 돌 때는 같은 문장을 또 보여 주지 않고 바로 다음 예시로
    if (resumed) next()
    const t = setInterval(next, 4000)
    return () => clearInterval(t)
  }, [paused, reduced])

  return PLACEHOLDER_EXAMPLES[reduced ? 0 : index]
}

/* ---------- 독 너비 조절 ---------- */

const DOCK_W_KEY = 'dock-width'
const DOCK_W_MIN = 320
/** 사이드바(248px) + 본문 최소 480px는 남겨 둔다 — 챗봇을 넓혀도 화면을 다 먹지 않게 */
const DOCK_W_RESERVE = 728
const clampDockWidth = (w: number) =>
  Math.min(Math.max(w, DOCK_W_MIN), Math.max(DOCK_W_MIN, window.innerWidth - DOCK_W_RESERVE))

function readStoredDockWidth() {
  try {
    const raw = localStorage.getItem(DOCK_W_KEY)
    if (raw) return clampDockWidth(Number(raw))
  } catch {
    /* 저장소를 못 쓰는 브라우저면 기본값으로 */
  }
  return clampDockWidth(Math.round(window.innerWidth * 0.33))
}

/**
 * 왼쪽 경계를 마우스로 끌어 독 너비를 바꾼다.
 * 드래그 중에는 본문 텍스트가 선택되지 않도록 body에 클래스를 건다.
 */
function useDockResize() {
  const [width, setWidth] = useState(readStoredDockWidth)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const onResize = () => setWidth((w) => clampDockWidth(w))
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    if (!dragging) return
    const onMove = (e: PointerEvent) => setWidth(clampDockWidth(window.innerWidth - e.clientX))
    const onUp = () => setDragging(false)
    document.body.classList.add('resizing-x')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      document.body.classList.remove('resizing-x')
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging])

  useEffect(() => {
    if (dragging) return
    try {
      localStorage.setItem(DOCK_W_KEY, String(width))
    } catch {
      /* 저장 못 해도 이번 세션 너비는 유지된다 */
    }
  }, [dragging, width])

  /** 키보드로도 조절 — 화살표 16px, 홈/엔드로 최소·최대 */
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 64 : 16
    if (e.key === 'ArrowLeft') setWidth((w) => clampDockWidth(w + step))
    else if (e.key === 'ArrowRight') setWidth((w) => clampDockWidth(w - step))
    else if (e.key === 'Home') setWidth(clampDockWidth(DOCK_W_MIN))
    else if (e.key === 'End') setWidth(clampDockWidth(window.innerWidth))
    else return
    e.preventDefault()
  }, [])

  return { width, dragging, startDrag: () => setDragging(true), onKeyDown }
}

export function AssistantDock() {
  const { assistant, docs, closeDock, ask, questionTemplateRequest, clearQuestionTemplateRequest, docQuestionRequest, clearDocQuestionRequest } =
    useApp()
  const location = useLocation()
  const [input, setInput] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  /** 이 문서로 질문 패널이 가리키는 문서 — 빈칸 패널과 동시에 열리지 않는다 */
  const [docAskId, setDocAskId] = useState<string | null>(null)
  const docAsk = docAskId ? docs.find((d) => d.id === docAskId) ?? null : null
  // 문서 패널이 열려 있으면 입력창 안내가 그 문서 기준이라 순환을 멈춘다
  const placeholder = usePlaceholderCycle(inputFocused || input.length > 0 || Boolean(docAsk))
  const { width, dragging, startDrag, onKeyDown } = useDockResize()
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [tpl, setTpl] = useState<TemplateState>(CLOSED_TEMPLATE)
  const templatePanelId = useId()
  const entryRef = useRef<HTMLButtonElement>(null)
  const valuesRef = useRef<HTMLDivElement>(null)
  const tplSendRef = useRef<HTMLButtonElement>(null)
  const docChipsRef = useRef<HTMLDivElement>(null)
  // 고른 뒤 다음 렌더에서 옮길 포커스 — 값 목록은 렌더가 끝나야 생긴다
  const focusNext = useRef<'values' | 'entry' | 'input' | 'doc-chips' | null>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [assistant.messages, assistant.pending])

  useEffect(() => {
    const target = focusNext.current
    if (!target) return
    focusNext.current = null
    if (target === 'entry') entryRef.current?.focus()
    else if (target === 'input') inputRef.current?.focus()
    else if (target === 'doc-chips') docChipsRef.current?.querySelector('button')?.focus()
    else {
      // 고를 빈칸이 없으면 다 채운 것 — 보내기로
      const first = valuesRef.current?.querySelector('button')
      if (first) first.focus()
      else tplSendRef.current?.focus()
    }
  })

  /** 같은 틀이 이미 열려 있으면 채운 빈칸을 지키고, 아니면 그 틀로 새로 연다 */
  const openTemplate = useCallback((id: string) => {
    setTpl((prev) =>
      prev.open && prev.id === findTemplate(id).id
        ? { ...prev, active: nextEmptySlot(prev.id, prev.filled) }
        : freshTemplate(id),
    )
    setDocAskId(null)
    focusNext.current = 'values'
  }, [])

  // 대시보드 카드처럼 독 밖에서 온 요청 — 받아서 패널을 열고 지운다
  useEffect(() => {
    if (!questionTemplateRequest) return
    openTemplate(questionTemplateRequest.id)
    clearQuestionTemplateRequest()
  }, [questionTemplateRequest, clearQuestionTemplateRequest, openTemplate])

  // 위키 문서 머리 버튼에서 온 요청 — 같은 문서를 다시 눌러도 패널을 다시 열고 칩으로 포커스를 옮긴다
  useEffect(() => {
    if (!docQuestionRequest) return
    setTpl(CLOSED_TEMPLATE)
    setDocAskId(docQuestionRequest.docId)
    focusNext.current = 'doc-chips'
    clearDocQuestionRequest()
  }, [docQuestionRequest, clearDocQuestionRequest])

  // 패널이 가리키는 문서 화면을 떠나면 닫는다 — 다른 화면에서 그 문서 기준 접두어가 붙지 않게
  useEffect(() => {
    if (docAskId && location.pathname !== `/wiki/${docAskId}`) setDocAskId(null)
  }, [docAskId, location.pathname])

  const cancelDocAsk = () => {
    setDocAskId(null)
    focusNext.current = 'input'
  }

  const sendDocAsk = (sentence: string) => {
    if (!docAsk) return
    ask(sentence, { via: docAskVia(docAsk.title) })
    // 이어지는 질문은 대화 이력에 코드가 남아 따로 붙이지 않는다
    setDocAskId(null)
    focusNext.current = 'input'
  }

  const cancelTemplate = () => {
    setTpl(CLOSED_TEMPLATE)
    focusNext.current = 'entry'
  }

  const pickTemplate = (id: string) => {
    if (id === tpl.id) return
    setTpl(freshTemplate(id))
  }

  const pickValue = (slotId: string, value: string) => {
    const filled = { ...tpl.filled, [slotId]: value }
    // 앞 빈칸이 바뀌면 딸린 빈칸 값은 더 이상 맞지 않을 수 있다 — 비운다
    if (tpl.filled[slotId] !== value)
      for (const [id, slot] of Object.entries(findTemplate(tpl.id).slots)) if (slot.dependsOn === slotId) delete filled[id]
    setTpl({ ...tpl, filled, active: nextEmptySlot(tpl.id, filled, slotId) })
    focusNext.current = 'values'
  }

  const sendTemplate = (sentence: string) => {
    // 미리 보인 문장을 그대로 — 입력창에 쓰던 글은 건드리지 않는다
    ask(sentence)
    setTpl(CLOSED_TEMPLATE)
    focusNext.current = 'input'
  }

  const send = (text: string) => {
    ask(text)
    setInput('')
  }

  /** 입력창 전송 — 문서 패널이 열려 있으면 안내한 대로 코드 접두어를 붙인다(말풍선에도 붙은 문장 그대로) */
  const submitInput = (text: string) => {
    if (!docAsk) return send(text)
    sendDocAsk(docAskSentence(docAsk.code, text))
    setInput('')
  }

  return (
    <aside className="dock" style={{ width }}>
      <div
        className={`dock-resizer${dragging ? ' on' : ''}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="챗봇 너비 조절"
        tabIndex={0}
        onPointerDown={(e) => {
          e.preventDefault()
          startDrag()
        }}
        onKeyDown={onKeyDown}
      />
      <div className="dock-head">
        <span className="t">챗봇</span>
        <button onClick={closeDock} aria-label="챗봇 닫기">
          ▸
        </button>
      </div>
      <div className="dock-scope">
        프로모션 정책·노출·인사이트, ACS·CBS·Swing 매뉴얼, 편성표까지 — 자세한 내용을 챗봇이 문서 근거로 정리해 드립니다
      </div>
      <QuickActions
        onPlan={() => send(PLAN_STARTER)}
        onTemplate={() => (tpl.open ? cancelTemplate() : openTemplate(QUESTION_TEMPLATES[0].id))}
        templateOpen={tpl.open}
        templatePanelId={templatePanelId}
        templateEntryRef={entryRef}
      />

      <div className="dock-log" ref={logRef}>
        {assistant.messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="label">이렇게 물어보세요</span>
            <div className="suggest">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button key={q} onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {assistant.messages.map((m) => (
          <Message key={m.id} msg={m} />
        ))}
        {assistant.pending && assistant.pendingReport && assistant.engine && assistant.engine !== 'gemini' && assistant.pendingSince ? (
          <ReportWaiting engine={assistant.engine} since={assistant.pendingSince} />
        ) : assistant.pending && (
          <div className="typing">
            {assistant.engine
              ? `${ENGINE_LABEL[assistant.engine]}가 문서를 읽고 답을 정리하는 중… (${ENGINE_WAIT_HINT[assistant.engine]} 내외 · 최대 ${ENGINE_TIMEOUT_MS[assistant.engine] / 1000}초)`
              : '문서를 찾는 중…'}
          </div>
        )}
      </div>

      {docAsk && (
        <DocAskPanel doc={docAsk} pending={assistant.pending} chipsRef={docChipsRef} onCancel={cancelDocAsk} onSend={sendDocAsk} />
      )}

      {tpl.open && (
        <TemplatePanel
          panelId={templatePanelId}
          state={tpl}
          pending={assistant.pending}
          valuesRef={valuesRef}
          sendRef={tplSendRef}
          onPickTemplate={pickTemplate}
          onPickSlot={(slotId) => setTpl({ ...tpl, active: slotId })}
          onPickValue={pickValue}
          onCancel={cancelTemplate}
          onSend={sendTemplate}
        />
      )}

      <div className="dock-foot">
        <EngineToggle />
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            if (input.trim()) submitInput(input.trim())
          }}
        >
          <input
            ref={inputRef}
            className="field"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder={docAsk ? docAskPlaceholder(docAsk.code) : `예: ${placeholder}`}
            aria-label="챗봇에게 질문"
          />
          <button className="btn accent" disabled={!input.trim()}>
            ↩
          </button>
        </form>
      </div>
    </aside>
  )
}
