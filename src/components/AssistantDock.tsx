import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ENGINE_LABEL,
  ENGINE_NAME,
  ENGINE_TIMEOUT_MS,
  ENGINE_WAIT_HINT,
  PLAN_STARTER,
  RULE_BASED_LABEL,
  displayEngineText,
  dockSuggestions,
  fallbackCodes,
  fallbackNotice,
} from '../lib/assistant'
import { hasMyAccount, hubKind, isLocalStatus, type HubKind } from '../lib/localHub'
import { REPORT_TIMEOUT_MS, REPORT_WAIT_HINT } from '../lib/report'
import { useApp, type IntentChoice } from '../store/AppStore'
import type { ChatMessage, Engine, EngineTopic, PromotionBrief } from '../types'
import { EngineGuideModal } from './EngineGuide'
import { ReportCard } from './ReportCard'
import { SourceCards, sourceHref } from './SourceCards'

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

/** 챗봇 답 본문 — 대화 기록 화면도 같은 모양으로 그린다 */
export function RichText({ text }: { text: string }) {
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

/** 엔진이 하나도 없어 문서 검색으로 답했을 때 답 아래 한 줄 (assistant-engine-guide F4) */
const NO_ENGINE_NOTICE: Record<HubKind, string> = {
  local: '내 AI 계정이 연결되지 않아 문서에서 찾은 내용만 보여 드렸어요.',
  deploy: '지금은 AI 엔진을 쓸 수 없어 문서에서 찾은 내용만 보여 드렸어요. 계속되면 관리자에게 알려 주세요.',
  unknown: 'AI 연결 상태를 확인하지 못해 문서에서 찾은 내용만 보여 드렸어요. 잠시 후 다시 물어보세요.',
}

/** 엔진이 없어서(실패가 아니라) 규칙 기반으로 답한 메시지 — 엔진 안내 답은 자기 버튼이 있어 뺀다 */
const answeredWithoutEngine = (m: ChatMessage) => m.answeredBy === RULE_BASED_LABEL && !m.fallback?.length && !m.engineTopic

/**
 * 엔진 안내 답 끝 행동 버튼 — 메시지에는 주제만 두고 버튼은 **지금 상태**로 고른다. 연결한 뒤에는 같은 답의 버튼이 저절로 바뀐다.
 * 모두 보통 버튼이다 — 강조 버튼은 입력칸 위 [연결하기] 하나 (assistant-engine-guide 3-3)
 */
function EngineTopicActions({ topic }: { topic: EngineTopic }) {
  const { assistant, openEngineSettings } = useApp()
  const [guideOpen, setGuideOpen] = useState(false)
  const hub = hubKind(assistant.engineStatus)
  if (hub === 'unknown') return null
  const settings =
    hub === 'local'
      ? !hasMyAccount(assistant.engineStatus)
        ? '연결하기'
        : topic === 'connect' || topic === 'trouble'
          ? '연결 설정 열기'
          : null
      : topic === 'connect' || topic === 'benefit' || topic === 'compare'
        ? '내 PC에서 쓰기'
        : null
  if (!settings && topic !== 'compare') return null
  return (
    <div className="engine-actions">
      {settings && (
        <button type="button" className="btn sm" onClick={openEngineSettings}>
          {settings}
        </button>
      )}
      {topic === 'compare' && (
        <button type="button" className="btn sm" onClick={() => setGuideOpen(true)}>
          차이 표 보기
        </button>
      )}
      {guideOpen && <EngineGuideModal onClose={() => setGuideOpen(false)} />}
    </div>
  )
}

function Message({ msg, canAskAgain = false }: { msg: ChatMessage; canAskAgain?: boolean }) {
  const navigate = useNavigate()
  const { session, assistant, askAgain, docs, closeDock, openEngineSettings, askWithAccount } = useApp()
  const hub = hubKind(assistant.engineStatus)
  const linked = hasMyAccount(assistant.engineStatus)
  const noEngine = answeredWithoutEngine(msg) ? NO_ENGINE_NOTICE[hub] : null
  // 근거는 문서 카드로 — 목록에 없는 문서(지워진 문서 등)만 예전처럼 글자 버튼으로 남긴다
  const sourceItems = (msg.sources ?? []).flatMap((s) => {
    const doc = docs.find((d) => d.id === s.docId)
    return doc ? [{ doc, anchor: s.anchor }] : []
  })
  const unknownSources = (msg.sources ?? []).filter((s) => !docs.some((d) => d.id === s.docId))
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
      {msg.notice && <div className="fallback-notice">{msg.notice}</div>}
      {(msg.reportHint === 'offer' || msg.reportFailed) && (
        <div className="suggest report-chip">
          <button type="button" disabled={assistant.pending} onClick={() => askAgain(msg.id, msg.reportFailed ? 'qa' : 'report')}>
            {msg.reportFailed ? '짧게 답 받기' : '리포트로 자세히 받기'}
          </button>
          {!msg.reportFailed && <span className="muted">근거·비교를 갖춘 보고 문서로 받습니다 · {REPORT_WAIT_HINT}</span>}
        </div>
      )}
      <SourceCards
        items={sourceItems}
        // 휴대폰 폭에서는 창이 본문을 거의 다 덮는다 — 근거 문서를 읽을 수 있게 닫는다
        onOpen={() => window.innerWidth <= 760 && closeDock()}
      />
      {unknownSources.length > 0 && (
        <div className="sources">
          {unknownSources.map((s) => (
            <button key={s.docId} onClick={() => navigate(sourceHref(s))}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {msg.engineTopic && <EngineTopicActions topic={msg.engineTopic} />}
      {msg.brief && <BriefCard brief={msg.brief} />}
      {msg.intent && <IntentChip msg={msg} />}
      {msg.intentAnswer && <div className="intent-answer">선택 · {msg.intentAnswer}</div>}
      {notice && <div className="fallback-notice">{notice}</div>}
      {noEngine && (
        <div className="fallback-notice">
          {noEngine}
          {/* 연결하러 가는 길은 내 PC 허브에만 있다 — 이미 연결했으면 아래 다시 묻기 칩이 그 자리를 맡는다 */}
          {hub === 'local' && !linked && (
            <>
              {' '}
              <button type="button" className="btn sm" onClick={openEngineSettings}>
                연결하기
              </button>
            </>
          )}
        </div>
      )}
      {canAskAgain && linked && assistant.engine && (
        <div className="suggest report-chip">
          <button type="button" disabled={assistant.pending} onClick={() => askWithAccount(msg.id)}>
            내 계정으로 다시 묻기
          </button>
          <span className="muted">
            같은 질문을 {assistant.engine === 'gemini' ? '공용 AI로' : `${ENGINE_NAME[assistant.engine]} 계정으로`} 다시 보내요
          </span>
        </div>
      )}
      {msg.answeredBy && (
        <div className="by">
          답변 · {displayEngineText(msg.answeredBy)}
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
        {ENGINE_NAME[engine]}가 리포트를 정리하는 중입니다 · {REPORT_WAIT_HINT} · 최대 {maxMin}분 ·{' '}
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
  // 마우스를 올렸을 때도 화면 이름만 — CLI·API 같은 말은 설정 창 고급 설정(담당자용)에만 둔다
  if (e === 'gemini') return usable ? '공용 AI로 답해요' : '이 허브에는 공용 AI가 설정돼 있지 않아요'
  if (usable) return `${ENGINE_NAME[e]} 계정으로 답해요`
  return installed
    ? `${ENGINE_NAME[e]} 계정 로그인이 필요해요 — ⚙ 연결 설정에서 로그인`
    : `이 PC에는 ${ENGINE_NAME[e]} 연결 프로그램이 없어요`
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
            {ENGINE_NAME[e]}
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * 어시스턴트 입력칸 위 엔진 상태 한 줄 — 이번 답을 누가 하는지 마우스를 올리지 않아도 글자로 보인다 (F1).
 * 계정 관리는 공용 설정 창이 맡고, 여기서는 ⚙·[연결하기]로 그 창을 연다. 문구는 assistant-engine-guide 4-1.
 */
function DockEngineLine() {
  const { assistant, openEngineSettings } = useApp()
  const status = assistant.engineStatus
  const [guideOpen, setGuideOpen] = useState(false)
  const gear = (
    <button type="button" className="btn sm dock-engine-gear" aria-label="챗봇 답변 엔진 설정" title="챗봇 답변 엔진 설정" onClick={openEngineSettings}>
      ⚙
    </button>
  )
  const line = (dot: string, text: React.ReactNode, end?: React.ReactNode) => (
    <div className="engine-row dock-engine">
      <span className={`status-dot ${dot}`} />
      <span className="grow">{text}</span>
      {end}
    </div>
  )

  if (status === undefined) return line('loading', '연결 상태를 확인하는 중…')
  if (status === null) return line('off', '문서에서 찾은 내용만 보여 드려요')
  if (hasMyAccount(status))
    return (
      <div className="dock-engine">
        <EngineToggle />
        {gear}
      </div>
    )
  if (assistant.engines?.gemini)
    return (
      <>
        {line(
          'ok',
          <>
            공용 AI로 답해요 ·{' '}
            <button type="button" className="cli-os-switch" onClick={() => setGuideOpen(true)}>
              차이 보기
            </button>
          </>,
          gear,
        )}
        {guideOpen && <EngineGuideModal onClose={() => setGuideOpen(false)} />}
      </>
    )
  // 내 PC 허브에서 내 계정이 없으면 이 창의 강조 버튼은 [연결하기] 하나다 (UX 수용 기준 11)
  if (isLocalStatus(status))
    return line(
      'warn',
      '내 AI 계정이 연결 안 됐어요 · 문서에서 찾은 내용만 보여 드려요',
      <button type="button" className="btn sm accent" onClick={openEngineSettings}>
        연결하기
      </button>,
    )
  return line('off', '지금은 AI 엔진을 쓸 수 없어요 · 문서에서 찾은 내용만 보여 드려요', gear)
}

/** 바로가기 버튼 아이콘 — 라벨 왼쪽에 붙는 14px 선 아이콘 */
function QuickIcon({ name }: { name: 'tv' | 'calendar' | 'spark' }) {
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
 */
function QuickActions({ onPlan }: { onPlan: () => void }) {
  const navigate = useNavigate()

  return (
    <div className="dock-quick">
      <span className="label">바로 확인하기</span>
      <div className="suggest">
        <button onClick={() => navigate('/sheets/btv')}>
          <QuickIcon name="tv" />홈 편성 스케줄 (B tv)
        </button>
        <button onClick={() => navigate('/sheets/campaign')}>
          <QuickIcon name="calendar" />캠페인 신청 캘린더
        </button>
        <button onClick={onPlan}>
          <QuickIcon name="spark" />프로모션 기획 시작하기
        </button>
      </div>
    </div>
  )
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

/** 저장 고지 한 줄 — 웹 주소 허브 로그인(N-1)과 저장이 켜진 관리자 PC(N-2)만. 상태를 모르면 보이지 않는다 */
function chatLogNotice(status: ReturnType<typeof useApp>['chatLog']): string | null {
  if (!status?.enabled) return null
  const days = status.retentionDays
  // 계정은 팀 단위로 나눠 쓴다 — 같은 팀 계정을 쓰는 팀원도 내 대화 기록에서 본다
  if (status.mine) return `대화 내용은 챗봇을 고치는 데 쓰려고 ${days}일 동안 저장돼요. 관리자와 같은 팀 계정을 쓰는 팀원이 볼 수 있어요.`
  if (status.where === 'local') return `이 PC의 대화는 챗봇을 고치는 데 쓰려고 ${days}일 동안 저장돼요. 관리자만 볼 수 있어요.`
  return null
}

/** 마지막으로 입력칸에 채운 composeSeed 순번 — 창이 닫히면 컴포넌트가 사라져 바깥에 둔다 */
let appliedSeedSeq = 0

export function AssistantDock() {
  const { assistant, closeDock, ask, chatLog } = useApp()
  const navigate = useNavigate()
  const notice = chatLogNotice(chatLog)
  const [input, setInput] = useState('')
  const { width, dragging, startDrag, onKeyDown } = useDockResize()
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // '이 문서로 묻기' — 입력칸을 문서 코드로 채우고 커서를 끝에 둔다. 보내는 것은 사용자가 마저 쓴 뒤
  const seed = assistant.composeSeed
  useEffect(() => {
    // 창을 닫았다 다시 열 때 지난 글을 또 채우지 않게 한 번만 쓴다
    if (!seed || seed.seq === appliedSeedSeq) return
    appliedSeedSeq = seed.seq
    setInput(seed.text)
    requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.setSelectionRange(seed.text.length, seed.text.length)
    })
  }, [seed])

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [assistant.messages, assistant.pending])

  const send = (text: string) => {
    ask(text)
    setInput('')
  }

  // [내 계정으로 다시 묻기]는 엔진 없이 받은 답 중 가장 최근 하나에만 — 진행 확인 칩이 붙은 답은 흐름이 따로 있다 (F3)
  const lastWithoutEngine = [...assistant.messages].reverse().find((m) => m.role === 'assistant' && answeredWithoutEngine(m) && !m.intent)
  const askAgainId = lastWithoutEngine && !lastWithoutEngine.askedAgain ? lastWithoutEngine.id : null

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
        <span className="t">큐 어시스턴트</span>
        {chatLog?.mine && (
          <button
            type="button"
            className="dock-history"
            title={`최근 ${chatLog.retentionDays}일 동안 물어본 질문과 답을 다시 봐요`}
            onClick={() => {
              navigate('/my-chat-log')
              // 휴대폰 폭에서는 창이 본문을 거의 다 덮는다 — 기록을 읽을 수 있게 닫는다
              if (window.innerWidth <= 760) closeDock()
            }}
          >
            지난 대화
          </button>
        )}
        <button onClick={closeDock} aria-label="어시스턴트 닫기">
          ▸
        </button>
      </div>
      <div className="dock-scope">
        프로모션 정책·노출·인사이트, ACS·CBS·Swing 매뉴얼, 편성표까지 — 자세한 내용을 챗봇이 문서 근거로 정리해 드립니다
      </div>
      <QuickActions onPlan={() => send(PLAN_STARTER)} />

      <div className="dock-log" ref={logRef}>
        {assistant.messages.length === 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span className="label">이렇게 물어보세요</span>
            <div className="suggest">
              {dockSuggestions(assistant.engineStatus).map((q) => (
                <button key={q} onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {assistant.messages.map((m) => (
          <Message key={m.id} msg={m} canAskAgain={m.id === askAgainId} />
        ))}
        {assistant.pending && assistant.pendingReport && assistant.engine && assistant.engine !== 'gemini' && assistant.pendingSince ? (
          <ReportWaiting engine={assistant.engine} since={assistant.pendingSince} />
        ) : assistant.pending && (
          <div className="typing">
            {assistant.engine
              ? `${ENGINE_NAME[assistant.engine]}가 문서를 읽고 답을 정리하는 중… (${ENGINE_WAIT_HINT[assistant.engine]} 내외 · 최대 ${ENGINE_TIMEOUT_MS[assistant.engine] / 1000}초)`
              : '문서를 찾는 중…'}
          </div>
        )}
      </div>

      <div className="dock-foot">
        <DockEngineLine />
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            if (input.trim()) send(input.trim())
          }}
        >
          <input
            ref={inputRef}
            className="field"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="질문 입력…"
            aria-label="어시스턴트에게 질문"
            aria-describedby={notice ? 'dock-notice' : undefined}
          />
          <button className="btn accent" disabled={!input.trim()}>
            ↩
          </button>
        </form>
        {notice && (
          <p id="dock-notice" className="dock-notice">
            {notice}
          </p>
        )}
      </div>
    </aside>
  )
}
