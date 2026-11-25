import { lazy, memo, Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { EngineToggle } from './AssistantDock'
import { changeSummary } from './ChangeCards'
import { DiffView } from './DiffView'
import { EditIcon } from './EditIcons'
import { requestAiEdit, type AiEditResult } from '../lib/assistant'
import { changeCards } from '../lib/blocks'
import { sectionAnchor, sectionLabel } from '../lib/docEdit'
import { splitSections } from '../lib/draft'
import { useApp } from '../store/AppStore'
import type { WikiDoc } from '../types'

// 블록 편집 면은 편집 모드에 들어갈 때만 불러온다 — 읽기만 하는 화면의 첫 로딩을 무겁게 하지 않게(doc-editing 7절 R3)
const BlockSurface = lazy(() => import('./BlockEditor'))

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

export type AiSuggestion = AiEditResult

/**
 * 장 하나만 AI 에게 보낸다(/api/edit 의 section — 장 원문과 문서 장 제목 순서). 결과는 바로 넣지 않고 그 장 안에 제안으로 보인다 —
 * [받기]를 눌러야 편집 칸에 들어간다
 */
function SectionAi({
  doc,
  docBody,
  outline,
  title,
  text,
  onSuggest,
  onClose,
}: {
  doc: WikiDoc
  docBody: string
  outline: string[]
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
      const result = await requestAiEdit(doc, docBody, instruction.trim(), engines, { body: text, title, anchor: sectionAnchor(title), outline })
      const next = keepTrailing(text, result.body)
      if (!sameShape(text, next)) setError('AI가 이 장 밖까지 바꿔 와서 받지 않았어요. 부탁을 이 장 안의 일로 좁혀 다시 해 주세요')
      else if (next === text) setError('바뀐 곳이 없는 결과가 나왔어요. 무엇을 무엇으로 바꿀지 한 번 더 알려 주세요.')
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

/** 되돌리기 기록 — 0.8초 안에 이어 친 글자는 한 번으로 묶는다 */
function useUndo(text: string) {
  const stack = useRef<string[]>([])
  const last = useRef(text)
  const lastAt = useRef(0)
  const skip = useRef(false)
  const [depth, setDepth] = useState(0)
  useEffect(() => {
    if (text === last.current) return
    if (skip.current) skip.current = false
    else {
      const now = Date.now()
      if (now - lastAt.current > 800 || stack.current.length === 0) stack.current.push(last.current)
      lastAt.current = now
    }
    last.current = text
    setDepth(stack.current.length)
  }, [text])
  const pop = () => {
    const prev = stack.current.pop()
    setDepth(stack.current.length)
    if (prev === undefined) return null
    skip.current = true
    lastAt.current = 0
    return prev
  }
  return { canUndo: depth > 0, pop }
}

/**
 * 장 편집 칸 — 기본은 보이는 모양 그대로 고치는 블록 편집(2차). 원문 보기(고급)면 1차의 장 원문 textarea + 바로 옆 결과 미리보기.
 * 어느 쪽으로 고쳐도 장 원문 하나(text)만 바뀌므로 검사·바뀐 곳 목록·임시 저장이 같다
 */
export const SectionEditor = memo(function SectionEditor({
  doc,
  docBody,
  outline,
  slot,
  title,
  text,
  baseText,
  preamble,
  mode,
  showMarks,
  renderMd,
  onChange,
  onClose,
  onAccept,
  onWholeRaw,
}: {
  doc: WikiDoc
  /** AI 에 함께 보내는 문서 전체 지금 본문 */
  docBody: string
  /** 문서 장 제목 순서 — AI 가 용어를 다른 장과 맞추는 데만 */
  outline: string[]
  slot: number
  title: string
  text: string
  /** 편집을 시작할 때의 이 장 — 되돌리기·바뀐 곳 칠 기준. 새로 생긴 장이면 null */
  baseText: string | null
  preamble: boolean
  mode: 'blocks' | 'raw'
  showMarks: boolean
  renderMd: (text: string, preamble: boolean) => ReactNode
  onChange: (slot: number, text: string) => void
  onClose: (slot: number) => void
  /** AI 제안을 받았을 때 — 사유가 비어 있으면 AI 요약으로 채운다 */
  onAccept: (slot: number, result: AiEditResult) => void
  /** 원문 보기 안의 [문서 전체 원문] */
  onWholeRaw: () => void
}) {
  const [aiOpen, setAiOpen] = useState(false)
  const [suggestion, setSuggestion] = useState<AiEditResult | null>(null)
  const area = useRef<HTMLTextAreaElement>(null)
  const undo = useUndo(text)
  // 열자마자 쓸 수 있게 하되 화면은 움직이지 않는다 — 읽던 자리에서 스크롤 0 (doc-editing 2절 ①)
  useEffect(() => {
    if (mode === 'raw') area.current?.focus({ preventScroll: true })
  }, [mode])
  // 줄이 접혀도 다 보이게 글 높이만큼 늘린다 — 화면의 3/4 를 넘으면 칸 안에서 스크롤
  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight + 2, Math.round(window.innerHeight * 0.75))}px`
  }, [text, mode])
  const locked = suggestion !== null
  const md = (t: string) => renderMd(t, false)

  const sectionTools = (
    <>
      <button className="btn sm" onMouseDown={(e) => e.preventDefault()} onClick={() => setAiOpen((v) => !v)} disabled={locked}>
        <EditIcon name="sparkle" /> AI에게 부탁
      </button>
      <button
        className="btn sm"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const prev = undo.pop()
          if (prev !== null) onChange(slot, prev)
        }}
        disabled={locked || !undo.canUndo}
        title="방금 고친 것을 하나씩 되돌려요"
      >
        <EditIcon name="undo" /> 되돌리기
      </button>
      {baseText !== null && text !== baseText && (
        <button className="btn sm" onClick={() => onChange(slot, baseText)} disabled={locked} title="이 장을 편집을 시작할 때로 돌려요">
          이 장 원래대로
        </button>
      )}
      <button className="btn sm" onClick={() => onClose(slot)} disabled={locked}>
        이 장 닫기
      </button>
    </>
  )

  const aiBox = (
    <>
      {aiOpen && !suggestion && (
        <SectionAi
          doc={doc}
          docBody={docBody}
          outline={outline}
          title={title}
          text={text}
          onSuggest={(r) => {
            setSuggestion(r)
            setAiOpen(false)
          }}
          onClose={() => setAiOpen(false)}
        />
      )}
      {suggestion && (
        <div className="sec-suggest" role="region" aria-label="AI 제안">
          <div className="form-actions">
            <span className="label strong">
              AI 제안 · {suggestion.by} · {changeSummary({ key: '', title, kind: 'changed', before: text, after: suggestion.body }, changeCards(text, suggestion.body, preamble))}
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
          {suggestion.trimmed && <span className="muted">AI가 이 장 밖까지 고쳐 와서 이 장만 받았어요</span>}
          {suggestion.summary && <span className="muted">{suggestion.summary}</span>}
          <span className="muted">받기 전에는 고칠 수 없어요. 칠한 곳이 AI가 바꾼 곳이에요.</span>
        </div>
      )}
    </>
  )

  if (mode === 'raw') {
    return (
      <div className="sec-editor">
        <div className="sec-toolbar">
          <span className="label strong sec-toolbar-title">✎ 「{sectionLabel(title)}」 원문 고치는 중</span>
          <button className="btn sm" onClick={onWholeRaw}>
            문서 전체 원문
          </button>
          {sectionTools}
        </div>
        {aiBox}
        {suggestion && <DiffView before={text} after={suggestion.body} leftLabel="지금" rightLabel="AI 제안" mode="inline" />}
        <div className="sec-editor-grid">
          <textarea
            className="field sec-textarea"
            value={text}
            readOnly={locked}
            onChange={(e) => onChange(slot, e.target.value)}
            aria-label={`「${sectionLabel(title)}」 장 원문`}
            spellCheck={false}
            ref={area}
          />
          <div className="md sec-preview" aria-label="미리보기">
            <div className="label sec-preview-label">미리보기</div>
            {renderMd(text, preamble)}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="sec-editor blocks">
      <Suspense fallback={<span className="muted">편집 칸을 여는 중…</span>}>
        {suggestion ? (
          // AI 제안은 같은 칠 규칙으로 — 지금 글과 비교해 바뀐 곳만 칠한다. 받기 전에는 고칠 수 없다
          <>
            <div className="sec-toolbar">
              <span className="label strong sec-toolbar-title">✎ 「{sectionLabel(title)}」 AI 제안 보는 중</span>
              {sectionTools}
            </div>
            {aiBox}
            <BlockSurface key="ai" text={suggestion.body} baseText={text} preamble={preamble} readOnly showMarks renderMd={md} label="AI 제안 (읽기 전용)" />
          </>
        ) : (
          <BlockSurface
            key="edit"
            text={text}
            baseText={baseText}
            preamble={preamble}
            showMarks={showMarks}
            onChange={(t) => onChange(slot, t)}
            renderMd={md}
            tools={sectionTools}
            label={`「${sectionLabel(title)}」 장 편집`}
          >
            {aiBox}
          </BlockSurface>
        )}
      </Suspense>
    </div>
  )
})
