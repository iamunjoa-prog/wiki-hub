import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { EngineToggle } from './AssistantDock'
import { DiffView, diffStats } from './DiffView'
import { requestAiEdit, type AiEditResult } from '../lib/assistant'
import { sectionLabel } from '../lib/docEdit'
import { splitSections } from '../lib/draft'
import { useApp } from '../store/AppStore'
import type { WikiDoc } from '../types'

/** AI 가 돌려준 장 — 장 밖(다른 장·머리말)을 만들어 왔으면 받지 않는다(doc-editing 2절 ②, 1차 규칙) */
function sameShape(before: string, after: string) {
  const a = splitSections(before).map((s) => s.key)
  const b = splitSections(after).map((s) => s.key)
  return a.length === b.length && a.every((k, i) => k === b[i])
}

/** 장 끝 빈 줄은 다음 장과의 간격이다 — AI 가 지우거나 늘려도 원래대로 둬야 장 경계에 변경이 생기지 않는다 */
function keepTrailing(before: string, after: string) {
  const tail = /\s*$/.exec(before)?.[0] ?? ''
  return after.replace(/\s+$/, '') + tail
}

/**
 * 장 하나만 AI 에게 보낸다. 결과는 바로 넣지 않고 그 장 안에 제안으로 보인다 — [받기]를 눌러야 편집 칸에 들어간다.
 * 서버 /api/edit 는 그대로 쓴다(장 원문을 본문 자리에 보낸다)
 */
function SectionAi({
  doc,
  title,
  text,
  onSuggest,
  onClose,
}: {
  doc: WikiDoc
  title: string
  text: string
  onSuggest: (result: AiEditResult) => void
  onClose: () => void
}) {
  const { assistant } = useApp()
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const engines = assistant.usableEngines

  const run = async () => {
    if (!instruction.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await requestAiEdit(doc, text, instruction.trim(), engines)
      const next = keepTrailing(text, result.body)
      if (!sameShape(text, next)) setError('AI가 이 장 밖까지 바꿔 와서 받지 않았어요. 이 장 밖은 고치지 않았어요. 부탁을 조금 바꿔 다시 해 주세요.')
      else if (next === text) setError('바뀐 줄이 없는 결과가 나왔어요. 무엇을 무엇으로 바꿀지 한 번 더 알려 주세요.')
      else {
        onSuggest({ ...result, body: next })
        setInstruction('')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-edit sec-ai">
      <div className="ai-edit-head">
        <span className="label strong">AI에게 부탁 · 「{sectionLabel(title)}」 장만 고쳐요</span>
        <EngineToggle label="엔진" busy={busy} />
      </div>
      {engines.length === 0 ? (
        <span className="muted" style={{ fontSize: 13 }}>
          {assistant.engineStatus === undefined
            ? '엔진 확인 중…'
            : "AI를 쓸 수 없어요. 직접 고치거나 메인의 '챗봇 답변 엔진'에서 연결해 주세요"}
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
            placeholder="예: 이 표의 담당 칸을 최신 내용으로 바꾸고, 확인 필요 상자는 지워 줘"
            aria-label="AI에게 부탁할 내용"
            disabled={busy}
          />
          <button className="btn accent" disabled={!instruction.trim() || busy} onClick={run} title="Ctrl+Enter">
            {busy ? '고치는 중…' : '부탁하기'}
          </button>
        </div>
      )}
      <div className="form-actions">
        <span className="muted" style={{ fontSize: 12.5 }}>
          {busy ? '이 장을 고치는 중… 보통 20초~1분 (장 하나만 보내요)' : '보통 20초~1분 (장 하나만 보내요)'}
        </span>
        <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onClose} disabled={busy}>
          닫기
        </button>
      </div>
      {error && <span className="err">{error}</span>}
    </div>
  )
}

/** 장 편집 칸 — 1차는 장 원문 textarea + 바로 옆 결과 미리보기(doc-editing 6절 1-2) */
export const SectionEditor = memo(function SectionEditor({
  doc,
  slot,
  title,
  text,
  baseText,
  preview,
  onChange,
  onClose,
  onAccept,
}: {
  doc: WikiDoc
  slot: number
  title: string
  text: string
  /** 편집을 시작할 때의 이 장 — 되돌리기 기준 */
  baseText: string | null
  preview: ReactNode
  onChange: (slot: number, text: string) => void
  onClose: (slot: number) => void
  /** AI 제안을 받았을 때 — 사유가 비어 있으면 AI 요약으로 채운다 */
  onAccept: (slot: number, result: AiEditResult) => void
}) {
  const [aiOpen, setAiOpen] = useState(false)
  const [suggestion, setSuggestion] = useState<AiEditResult | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  // 열자마자 쓸 수 있게 하되 화면은 움직이지 않는다 — 읽던 자리에서 스크롤 0 (doc-editing 2절 ①)
  useEffect(() => area.current?.focus({ preventScroll: true }), [])
  // 줄이 접혀도 다 보이게 글 높이만큼 늘린다 — 화면의 3/4 를 넘으면 칸 안에서 스크롤
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, Math.round(window.innerHeight * 0.75))}px`
  }, [text])
  const stats = suggestion ? diffStats(text, suggestion.body) : null

  return (
    <div className="sec-editor">
      <div className="sec-toolbar">
        <span className="label strong sec-toolbar-title">✎ 「{sectionLabel(title)}」 고치는 중</span>
        <button className="btn sm" onClick={() => setAiOpen((v) => !v)} disabled={suggestion !== null}>
          ✦ AI에게 부탁
        </button>
        {baseText !== null && text !== baseText && (
          <button className="btn sm" onClick={() => onChange(slot, baseText)} disabled={suggestion !== null}>
            ↶ 이 장 되돌리기
          </button>
        )}
        <button className="btn sm" onClick={() => onClose(slot)} disabled={suggestion !== null}>
          이 장 닫기
        </button>
      </div>

      {aiOpen && !suggestion && (
        <SectionAi
          doc={doc}
          title={title}
          text={text}
          onSuggest={(r) => {
            setSuggestion(r)
            setAiOpen(false)
          }}
          onClose={() => setAiOpen(false)}
        />
      )}

      {suggestion && stats && (
        <div className="sec-suggest">
          <div className="form-actions">
            <span className="label strong">
              AI 제안 · {suggestion.by} · 추가 {stats.added}줄 / 삭제 {stats.removed}줄
            </span>
            <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setSuggestion(null)}>
              버리기
            </button>
            <button
              className="btn sm primary"
              onClick={() => {
                onAccept(slot, suggestion)
                setSuggestion(null)
              }}
            >
              받기
            </button>
          </div>
          {suggestion.summary && <span className="muted">{suggestion.summary}</span>}
          <DiffView before={text} after={suggestion.body} leftLabel="지금" rightLabel="AI 제안" mode="inline" />
        </div>
      )}

      <div className="sec-editor-grid">
        <textarea
          className="field sec-textarea"
          value={text}
          readOnly={suggestion !== null}
          onChange={(e) => onChange(slot, e.target.value)}
          aria-label={`「${sectionLabel(title)}」 장 원문`}
          spellCheck={false}
          ref={area}
        />
        <div className="md sec-preview" aria-label="미리보기">
          <div className="label sec-preview-label">미리보기</div>
          {preview}
        </div>
      </div>
    </div>
  )
})
