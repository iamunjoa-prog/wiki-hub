import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TopBar } from '../components/AppShell'
import { EngineToggle } from '../components/AssistantDock'
import { DiffView, diffStats } from '../components/DiffView'
import { ENGINE_LABEL, requestAiEdit, type AiEditResult } from '../lib/assistant'
import { useApp } from '../store/AppStore'
import type { WikiDoc } from '../types'

const AI_WAIT_HINT = { claude: '1~2분', codex: '2~3분', gemini: '20~40초' } as const

/**
 * 내 PC의 Claude·Codex CLI(배포 허브는 Gemini)에게 수정 요청을 보내 본문을 고친다.
 * 결과는 편집 칸에만 들어가고, 변경 확인 → 제안 제출 → 승인을 거쳐야 반영된다.
 */
function AiEditBox({
  doc,
  body,
  onApply,
  onUndo,
  onReview,
}: {
  doc: WikiDoc
  body: string
  onApply: (result: AiEditResult) => void
  onUndo: () => void
  onReview: () => void
}) {
  const { assistant } = useApp()
  const [instruction, setInstruction] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<(AiEditResult & { added: number; removed: number }) | null>(null)

  const engines = assistant.usableEngines
  const available = engines.length > 0

  const run = async () => {
    if (!instruction.trim() || busy) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const result = await requestAiEdit(doc, body, instruction.trim(), engines)
      const stats = diffStats(body, result.body)
      onApply(result)
      setDone({ ...result, added: stats.added, removed: stats.removed })
      setInstruction('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-edit">
      <div className="ai-edit-head">
        <span className="label strong">AI로 수정</span>
        <span className="muted" style={{ fontSize: 12.5 }}>
          바꿀 내용을 말로 적으면 연결된 CLI가 본문을 고쳐 줍니다
        </span>
        <EngineToggle label="엔진" busy={busy} />
      </div>

      {!available ? (
        <span className="muted" style={{ fontSize: 13 }}>
          {assistant.engineStatus === undefined
            ? '엔진 확인 중…'
            : '쓸 수 있는 엔진이 없습니다 — 대시보드의 챗봇 답변 엔진에서 Claude·Codex CLI를 로그인하거나 Gemini API 키를 설정하세요.'}
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
            placeholder="예: 쿠폰 발급 한도를 시간당 12만 건으로 바꾸고, 변경 이력 표에 오늘 날짜로 한 줄 추가해 줘"
            aria-label="AI 수정 요청"
            disabled={busy}
          />
          <button className="btn accent" disabled={!instruction.trim() || busy} onClick={run} title="Ctrl+Enter">
            {busy ? '수정 중…' : '수정 요청'}
          </button>
        </div>
      )}

      {busy && assistant.engine && (
        <span className="muted" style={{ fontSize: 12.5 }}>
          {ENGINE_LABEL[assistant.engine]}가 문서를 고치는 중… ({AI_WAIT_HINT[assistant.engine]} 내외)
        </span>
      )}
      {error && <span className="err">{error}</span>}
      {done && (
        <div className="ai-edit-result">
          <b>✓ {done.by}</b>
          <span>
            추가 {done.added}줄 / 삭제 {done.removed}줄
            {done.summary && ` · ${done.summary}`}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button
              className="btn sm"
              onClick={() => {
                onUndo()
                setDone(null)
              }}
            >
              되돌리기
            </button>
            <button className="btn sm primary" onClick={onReview} disabled={done.added + done.removed === 0}>
              변경 확인 →
            </button>
          </span>
        </div>
      )}
    </div>
  )
}

export function ProposeEdit() {
  const { docId } = useParams()
  const navigate = useNavigate()
  const { docs, submitProposal } = useApp()
  const doc = docs.find((d) => d.id === docId)
  const [beforeAi, setBeforeAi] = useState<string | null>(null)

  const draftKey = `wikihub.draft.${docId}`
  const [step, setStep] = useState<1 | 2>(1)
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [body, setBody] = useState('')
  const [reason, setReason] = useState('')
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<'split' | 'inline'>('split')

  useEffect(() => {
    if (!doc) return
    setBody(localStorage.getItem(draftKey) ?? doc.body)
  }, [doc, draftKey])

  useEffect(() => {
    if (!doc || !body || body === doc.body) return
    const t = setTimeout(() => {
      localStorage.setItem(draftKey, body)
      setSavedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))
    }, 2000)
    return () => clearTimeout(t)
  }, [body, doc, draftKey])

  if (!doc) {
    return (
      <>
        <TopBar />
        <div className="content">
          <div className="empty">문서를 찾을 수 없습니다</div>
        </div>
      </>
    )
  }

  const stats = diffStats(doc.body, body)

  const submit = () => {
    submitProposal(doc.id, body, reason.trim())
    localStorage.removeItem(draftKey)
    navigate('/requests')
  }

  return (
    <>
      <TopBar />
      <div className="content">
        <div className="page-head">
          <span className="page-title">수정 제안 · {step}단계 {step === 1 ? '편집' : '확인'}</span>
          <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 11 }}>
            {doc.title} v{doc.version}
          </span>
        </div>

        {step === 1 ? (
          <div className="panel">
            <div className="panel-head">
              <button
                className={`btn sm${tab === 'edit' ? ' primary' : ''}`}
                onClick={() => setTab('edit')}
              >
                편집
              </button>
              <button
                className={`btn sm${tab === 'preview' ? ' primary' : ''}`}
                onClick={() => setTab('preview')}
              >
                미리보기
              </button>
              <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                {savedAt ? `자동 임시저장 · ${savedAt}` : '변경 시 자동 임시저장'}
              </span>
            </div>

            <div style={{ padding: 14 }}>
              <AiEditBox
                doc={doc}
                body={body}
                onApply={(result) => {
                  setBeforeAi(body)
                  setBody(result.body)
                  setTab('edit')
                  if (!reason.trim() && result.summary) setReason(`${result.summary} (AI 수정 · ${result.by})`)
                }}
                onUndo={() => {
                  if (beforeAi !== null) setBody(beforeAi)
                  setBeforeAi(null)
                }}
                onReview={() => setStep(2)}
              />
              {tab === 'edit' ? (
                <textarea
                  className="field"
                  style={{ minHeight: 380 }}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  aria-label="마크다운 편집"
                />
              ) : (
                <div className="md" style={{ minHeight: 380 }}>
                  <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]}>{body}</ReactMarkdown>
                </div>
              )}

              <div className="form-actions" style={{ marginTop: 14 }}>
                <button className="btn primary" disabled={!stats.changed} onClick={() => setStep(2)}>
                  다음 · 변경 확인
                </button>
                <button className="btn" onClick={() => navigate(`/wiki/${doc.id}`)}>
                  취소
                </button>
                {!stats.changed && (
                  <span className="mono muted" style={{ fontSize: 10.5 }}>
                    변경 사항이 없습니다
                  </span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="panel">
            <div className="panel-head">
              <span className="label strong">변경 내용 확인</span>
              <button
                className="btn sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => setDiffMode((m) => (m === 'split' ? 'inline' : 'split'))}
              >
                {diffMode === 'split' ? '좌우' : '인라인'} ▾
              </button>
            </div>

            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <DiffView
                before={doc.body}
                after={body}
                leftLabel={`원본 v${doc.version}`}
                rightLabel="내 제안"
                mode={diffMode}
              />

              <span className="mono muted" style={{ fontSize: 10.5 }}>
                추가 {stats.added}줄 / 삭제 {stats.removed}줄
              </span>

              <div className="form-row">
                <span className="label strong">수정 사유 *</span>
                <textarea
                  className="field"
                  style={{ minHeight: 64 }}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="무엇을 왜 바꿨는지 적어 주세요 — 승인자가 판단하는 근거가 됩니다"
                />
              </div>

              <div className="form-actions">
                <button className="btn primary" disabled={!reason.trim()} onClick={submit}>
                  제안 제출
                </button>
                <button className="btn" onClick={() => setStep(1)}>
                  편집으로
                </button>
                <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
                  제출 → 승인 대기
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
