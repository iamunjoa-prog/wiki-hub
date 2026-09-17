import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ENGINE_LABEL, PLAN_STARTER, SUGGESTED_QUESTIONS } from '../lib/assistant'
import { useApp, type IntentChoice } from '../store/AppStore'
import { EngineSelector } from './EngineSelector'
import type { ChatMessage, Engine, PromotionBrief } from '../types'

function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g)
        return (
          <p key={i}>
            {parts.map((p, j) =>
              p.startsWith('**') && p.endsWith('**') ? <b key={j}>{p.slice(2, -2)}</b> : p,
            )}
          </p>
        )
      })}
    </>
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
      : intent.kind === 'product'
        ? [
            { label: '월정액(PPM)', value: 'PPM' },
            { label: '단건(PPV)', value: 'PPV' },
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

function Message({ msg }: { msg: ChatMessage }) {
  const navigate = useNavigate()

  if (msg.role === 'user') return <div className="msg user">{msg.text}</div>

  return (
    <div className="msg bot">
      {msg.text && <RichText text={msg.text} />}
      {msg.sources && msg.sources.length > 0 && (
        <div className="sources">
          {msg.sources.map((s) => (
            <button key={s.docId} onClick={() => navigate(`/wiki/${s.docId}`)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {msg.brief && <BriefCard brief={msg.brief} />}
      {msg.intent && <IntentChip msg={msg} />}
      {msg.intentAnswer && <div className="intent-answer">선택 · {msg.intentAnswer}</div>}
      {msg.answeredBy && <div className="by">답변 · {msg.answeredBy}</div>}
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
/** 디자인 확정 폭. 더 넓히고 싶으면 왼쪽 경계를 끌면 된다 */
const DOCK_W_DEFAULT = 420
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
  return clampDockWidth(DOCK_W_DEFAULT)
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
  const { assistant, closeDock, ask, showToast } = useApp()
  const { preferred, engine } = assistant
  const [input, setInput] = useState('')
  const { width, dragging, startDrag, onKeyDown } = useDockResize()
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [assistant.messages, assistant.pending])

  // Esc로 닫는다. 엔진 드롭다운이 열려 있으면 그쪽이 먼저 먹는다(capture 단계에서 멈춤).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDock()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeDock])

  const send = (text: string) => {
    ask(text)
    setInput('')
  }

  const fellBack = preferred && engine && preferred !== engine

  return (
    <aside className="dock" style={{ width }}>
      {fellBack && (
        <p className="dock-fallback">
          {ENGINE_LABEL[preferred]} 연결 안 됨 → {ENGINE_LABEL[engine]}로 답변합니다
        </p>
      )}
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
      {/* 헤더 — 드로어 안에서도 엔진을 바꿀 수 있어야 한다 */}
      <div className="dock-head">
        <EngineSelector variant="drawer" />
        <button className="dock-full" onClick={() => showToast('전용 대화 화면은 준비 중입니다')}>
          전체 화면
        </button>
        <button className="dock-x" onClick={closeDock} aria-label="대화 닫기">
          ✕
        </button>
      </div>

      <div className="dock-log" ref={logRef}>
        {assistant.messages.length === 0 && (
          <div className="dock-intro">
            <span className="label">이렇게 물어보세요</span>
            <div className="suggest">
              {SUGGESTED_QUESTIONS.map((q) => (
                <button key={q} onClick={() => send(q)}>
                  {q}
                </button>
              ))}
            </div>
            <QuickActions onPlan={() => send(PLAN_STARTER)} />
          </div>
        )}
        {assistant.messages.map((m) => (
          <Message key={m.id} msg={m} />
        ))}
        {assistant.pending && (
          <div className="typing">
            {assistant.engine
              ? `${ENGINE_LABEL[assistant.engine]}가 문서를 읽고 답을 정리하는 중… (${assistant.engine === 'codex' ? '1~2분' : assistant.engine === 'gemini' ? '10~20초' : '30초'} 내외)`
              : '문서를 찾는 중…'}
          </div>
        )}
      </div>

      <div className="dock-foot">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault()
            if (input.trim()) send(input.trim())
          }}
        >
          <input
            className="field"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="이어서 질문…"
            aria-label="어시스턴트에게 질문"
          />
          <button className="btn accent" disabled={!input.trim()}>
            ↩
          </button>
        </form>
      </div>
    </aside>
  )
}
