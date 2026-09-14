import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { SUGGESTED_QUESTIONS } from '../lib/assistant'
import { useApp } from '../store/AppStore'
import type { CampaignDraft, ChatMessage } from '../types'

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
      <span className="t">캠페인 의도 감지 · 조건 정리됨</span>
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
        {assistant.pending && <div className="typing">문서를 찾는 중…</div>}
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
