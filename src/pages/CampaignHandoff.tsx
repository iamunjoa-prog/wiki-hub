import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { buildCampaignUrl, CAMPAIGN_URL } from '../lib/campaignLink'
import { useApp } from '../store/AppStore'
import type { CampaignDraft } from '../types'

export function CampaignHandoff() {
  const { assistant, setCampaignDraft, openDock, showToast } = useApp()
  const navigate = useNavigate()
  const [draft, setDraft] = useState<CampaignDraft | null>(assistant.campaignDraft)

  useEffect(() => setDraft(assistant.campaignDraft), [assistant.campaignDraft])

  if (!draft) {
    return (
      <>
        <TopBar />
        <div className="content">
          <div className="empty">
            <div className="box" />
            아직 정리된 프로모션 조건이 없습니다
            <button
              className="btn sm accent"
              onClick={() => {
                openDock()
                navigate('/')
              }}
            >
              어시스턴트와 대화 시작
            </button>
          </div>
        </div>
      </>
    )
  }

  const set = (patch: Partial<CampaignDraft>) => setDraft({ ...draft, ...patch })

  const proceed = () => {
    setCampaignDraft(draft)
    showToast('확정 조건을 담아 프로모션 자동화 화면으로 전달했습니다')
    window.open(buildCampaignUrl(draft), '_blank', 'noopener,noreferrer')
  }

  return (
    <>
      <TopBar />
      <div className="content">
        <div className="page-head">
          <span className="page-title">프로모션 자동화 연결 확인</span>
          <span className="tag">최종 확인 단계</span>
        </div>

        <div className="panel handoff">
          <div className="panel-head" style={{ boxShadow: 'inset 2px 0 0 var(--accent)' }}>
            <span className="label" style={{ color: 'var(--accent)' }}>
              어시스턴트가 정리한 확정 조건
            </span>
          </div>

          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="mono muted" style={{ fontSize: 10.5 }}>
              각 항목은 전달 전 마지막으로 직접 수정할 수 있습니다
            </div>

            <div className="handoff-grid">
              <span>타겟</span>
              <input className="field" value={draft.target} onChange={(e) => set({ target: e.target.value })} />

              <span>대상 기간</span>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  className="field"
                  type="date"
                  value={draft.periodStart}
                  onChange={(e) => set({ periodStart: e.target.value })}
                />
                <input
                  className="field"
                  type="date"
                  value={draft.periodEnd}
                  onChange={(e) => set({ periodEnd: e.target.value })}
                />
              </div>

              <span>채널</span>
              <input className="field" value={draft.channel} onChange={(e) => set({ channel: e.target.value })} />

              <span>전체 타겟수</span>
              <input
                className="field"
                value={draft.targetCount}
                onChange={(e) => set({ targetCount: e.target.value })}
              />

              <span>근거 정책</span>
              <input
                className="field"
                value={draft.policyRefs.join(', ')}
                onChange={(e) => set({ policyRefs: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              />

              <span>비고</span>
              <textarea
                className="field"
                style={{ minHeight: 56 }}
                value={draft.note}
                onChange={(e) => set({ note: e.target.value })}
                placeholder="실행 담당자에게 전달할 메모"
              />
            </div>

            <div className="hairline" style={{ paddingTop: 12 }}>
              <div className="mono muted" style={{ fontSize: 10.5, marginBottom: 10 }}>
                외부 프로모션 자동화 화면으로 이동합니다 — {CAMPAIGN_URL.replace('https://', '')}
              </div>
              <div className="form-actions">
                <button className="btn accent" onClick={proceed}>
                  프로모션 자동화로 진행 ↗
                </button>
                <button className="btn" onClick={() => navigate(-1)}>
                  대화로 돌아가기
                </button>
              </div>
            </div>
          </div>
        </div>

        <details style={{ marginTop: 14, maxWidth: 560 }}>
          <summary className="mono muted" style={{ fontSize: 10.5, cursor: 'pointer' }}>
            전달 URL 확인
          </summary>
          <div
            className="hint"
            style={{ marginTop: 8, wordBreak: 'break-all', fontSize: 10.5 }}
          >
            {buildCampaignUrl(draft)}
          </div>
        </details>
      </div>
    </>
  )
}
