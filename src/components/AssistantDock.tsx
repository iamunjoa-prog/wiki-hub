import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ENGINE_LABEL, PLAN_STARTER, SUGGESTED_QUESTIONS } from '../lib/assistant'
import { useApp, type IntentChoice } from '../store/AppStore'
import type { ChatMessage, Engine } from '../types'

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
      : [
          { label: '월정액(PPM)', value: 'PPM' },
          { label: '단건(PPV)', value: 'PPV' },
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
        <button className="go" onClick={onPlan}>
          <QuickIcon name="spark" />프로모션 기획 시작하기
        </button>
      </div>
    </div>
  )
}

export function AssistantDock() {
  const { assistant, closeDock, ask } = useApp()
  const [input, setInput] = useState('')
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: 'smooth' })
  }, [assistant.messages, assistant.pending])

  const send = (text: string) => {
    ask(text)
    setInput('')
  }

  return (
    <aside className="dock">
      <div className="dock-head">
        <span className="t">무엇이든 물어보세요</span>
        <button onClick={closeDock} aria-label="어시스턴트 닫기">
          ▸
        </button>
      </div>
      <div className="dock-scope">
        프로모션 정책·업무, 마케팅 인사이트, ACS·CBS·Swing 매뉴얼, 편성표까지 — 자세한 내용을 챗봇이 문서 근거로 정리해 드립니다
      </div>
      <QuickActions onPlan={() => send(PLAN_STARTER)} />

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
        {assistant.pending && (
          <div className="typing">
            {assistant.engine
              ? `${ENGINE_LABEL[assistant.engine]}가 문서를 읽고 답을 정리하는 중… (${assistant.engine === 'codex' ? '1~2분' : assistant.engine === 'gemini' ? '10~20초' : '30초'} 내외)`
              : '문서를 찾는 중…'}
          </div>
        )}
      </div>

      <div className="dock-foot">
        <EngineToggle />
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
            placeholder="질문 입력…"
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
