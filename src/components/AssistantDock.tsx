import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ENGINE_LABEL, SUGGESTED_QUESTIONS } from '../lib/assistant'
import { useApp } from '../store/AppStore'
import type { CampaignDraft, ChatMessage, Engine } from '../types'

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

function CampaignCard({ draft }: { draft: CampaignDraft }) {
  const navigate = useNavigate()
  return (
    <div className="campaign-card">
      <span className="t">프로모션 진행 의도 감지 · 조건 정리됨</span>
      <dl>
        <dt>타겟</dt>
        <dd>{draft.target}</dd>
        <dt>기간</dt>
        <dd>
          {draft.periodStart} ~ {draft.periodEnd}
        </dd>
        <dt>채널</dt>
        <dd>{draft.channel}</dd>
        <dt>타겟수</dt>
        <dd>{draft.targetCount}</dd>
        <dt>근거 정책</dt>
        <dd>{draft.policyRefs.join(' · ')}</dd>
      </dl>
      <button className="btn accent sm block" onClick={() => navigate('/handoff')}>
        확인 화면으로 →
      </button>
    </div>
  )
}

function Message({ msg }: { msg: ChatMessage }) {
  const navigate = useNavigate()

  if (msg.role === 'user') return <div className="msg user">{msg.text}</div>

  return (
    <div className="msg bot">
      <RichText text={msg.text} />
      {msg.sources && msg.sources.length > 0 && (
        <div className="sources">
          {msg.sources.map((s) => (
            <button key={s.docId} onClick={() => navigate(`/wiki/${s.docId}`)}>
              {s.label}
            </button>
          ))}
        </div>
      )}
      {msg.campaign && <CampaignCard draft={msg.campaign} />}
      {msg.answeredBy && <div className="by">답변 · {msg.answeredBy}</div>}
    </div>
  )
}

/** 로컬 dev 서버에서만 보인다. 설치되지 않은 CLI는 비활성화한다. */
function EngineToggle() {
  const { assistant, setEngine } = useApp()
  const { engines, engine, pending } = assistant
  if (!engines) return null

  return (
    <div className="engine-row">
      <span>답변 엔진</span>
      <div className="engine-toggle" role="radiogroup" aria-label="답변 엔진">
        {(Object.keys(ENGINE_LABEL) as Engine[]).map((e) => (
          <button
            key={e}
            type="button"
            role="radio"
            aria-checked={engine === e}
            className={engine === e ? 'on' : undefined}
            disabled={!engines[e] || pending}
            title={
              engines[e]
                ? `${ENGINE_LABEL[e]} CLI로 답변`
                : assistant.engineStatus?.[e].installed
                  ? `${ENGINE_LABEL[e]} CLI 로그인이 필요합니다 — 대시보드에서 로그인`
                  : `${ENGINE_LABEL[e]} CLI가 설치되어 있지 않습니다`
            }
            onClick={() => setEngine(e)}
          >
            {ENGINE_LABEL[e]}
          </button>
        ))}
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
        <span className="t">편성·마케팅 어시스턴트</span>
        <button onClick={closeDock} aria-label="어시스턴트 닫기">
          ▸
        </button>
      </div>
      <div className="dock-scope">담당 범위 · 프로모션 정책·업무 + ACS·CBS·Swing 매뉴얼 + 등록된 편성표</div>

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
              ? `${ENGINE_LABEL[assistant.engine]}가 문서를 읽고 답을 정리하는 중… (${assistant.engine === 'codex' ? '1~2분' : '30초'} 내외)`
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
