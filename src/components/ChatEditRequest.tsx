import { useState } from 'react'
import { EngineToggle } from './AssistantDock'
import { requestAiEdit, type AiEditResult } from '../lib/assistant'
import { normBody } from '../lib/draft'
import { useApp } from '../store/AppStore'
import type { ChatEditHandoff, WikiDoc } from '../types'

/**
 * 챗봇 수정안 카드에서 넘어온 요청 — 문서 전체를 AI 에게 보내고, 결과는 편집 칸에 넣기만 한다.
 * 제출은 편집 바 [제출하기]로만 된다 — 사람이 바뀐 장을 보고 낸다(대화만으로 제출되지 않게)
 */
export function ChatEditRequest({
  doc,
  body,
  handoff,
  onResult,
  onClose,
}: {
  doc: WikiDoc
  body: string
  handoff: ChatEditHandoff
  onResult: (result: AiEditResult) => void
  onClose: () => void
}) {
  const { assistant } = useApp()
  const [instruction, setInstruction] = useState(handoff.instruction)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const engines = assistant.usableEngines

  const run = async () => {
    if (!instruction.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await requestAiEdit(doc, body, instruction.trim(), engines)
      if (normBody(result.body) === normBody(body)) setError('바뀐 곳이 없는 결과가 나왔어요. 무엇을 무엇으로 바꿀지 한 번 더 알려 주세요.')
      else {
        onResult(result)
        setApplied(result.summary || '요청대로 고쳤습니다')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-edit chat-edit" role="region" aria-label="챗봇 수정 요청">
      <div className="ai-edit-head">
        <span className="label strong">챗봇에서 넘어온 수정 요청 · 문서 전체를 AI에게 부탁해요</span>
        <EngineToggle label="엔진" busy={busy} />
      </div>
      <span className="muted chat-edit-reason">근거 · {handoff.reason || '근거 미기재'}</span>
      {engines.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>
          {assistant.engineStatus === undefined
            ? '엔진 확인 중…'
            : "AI를 쓸 수 없어요. 아래 장에서 직접 고치거나 메인의 '챗봇 답변 엔진'에서 연결해 주세요"}
        </span>
      ) : (
        <div className="ai-edit-form">
          <textarea
            className="field"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault()
                run()
              }
            }}
            aria-label="AI에게 부탁할 내용"
            disabled={busy}
          />
          <button className="btn primary" disabled={!instruction.trim() || busy} onClick={run} title="Ctrl+Enter">
            {busy ? '고치는 중…' : 'AI에게 부탁'}
          </button>
        </div>
      )}
      {applied && (
        <div className="ai-edit-result">
          <b>편집 칸에 넣었어요</b>
          <span>{applied} — 바뀐 장을 확인하고 편집 바의 [제출하기]를 눌러 주세요. 아직 제출되지 않았습니다.</span>
        </div>
      )}
      <div className="form-actions">
        <span className="muted" style={{ fontSize: 12.5 }}>
          {busy ? '문서 전체를 고치는 중… 보통 30초~1분' : '보통 30초~1분 · 결과는 바로 제출되지 않고 편집 칸에 들어가요'}
        </span>
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={busy}>
          닫기
        </button>
      </div>
      {error && <span className="err">{error}</span>}
    </div>
  )
}
