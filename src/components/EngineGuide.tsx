import { useEffect } from 'react'

// 확정 문구(docs/ux/2026-11-13-engine-guide-copy.md ②·③) — 대시보드·챗봇 창이 같이 쓰므로 여기에만 둔다
const DIFF_ROWS: [label: string, mine: string, shared: string][] = [
  ['준비', '내 PC에 한 번 설치', '없음, 바로 사용'],
  ['답의 깊이', '문서를 꼼꼼히 읽음', '전체를 훑어 빠르게 찾음. 간단한 질문에 맞음'],
  ['AI로 문서 수정', '됨 · Claude는 관련 문서도 참고', '됨 · 고칠 문서만 봄'],
  ['붐빌 때', '영향 없음', '느려지거나 보조 AI로 바뀔 수 있음'],
  ['Jira 스케줄 확인', '됨 (Claude)', '안 됨'],
  ['응답 시간', '조금 더 걸릴 수 있음', '대체로 빠름'],
  ['비용', '내 구독에 포함', '회사 공용'],
]

/** 내 AI 계정과 공용 AI 엔진의 차이 — ② 좋은 점 + ③ 대비 표 */
export function EngineGuide() {
  return (
    <div className="engine-guide">
      <b>내 AI 계정으로 쓰면 좋은 점</b>
      <ul>
        <li>
          <b>더 정확해요</b> — 시간을 들여 문서를 꼼꼼히 읽고 답해요. Claude 계정은 질문에 맞는 문서를 직접 찾아 읽어요.
          조건이 여러 개 엮인 기획 상담에 강해요.
        </li>
        <li>
          <b>문서 수정도 꼼꼼해요</b> — 수정 제안의 <b>AI로 수정</b>도 내 계정으로 돌아요. Claude 계정은 고칠 때 관련된
          다른 문서도 찾아보고 맞춰 고쳐요.
        </li>
        <li>
          <b>붐벼도 괜찮아요</b> — 내 구독으로 돌아서 다른 사람 사용량 때문에 느려지거나 막히지 않아요.
        </li>
        <li>
          <b>할 수 있는 일이 더 많아요</b> — Jira 스케줄 확인은 내 Claude 계정으로만 돼요.
        </li>
        <li>처음 한 번만 설치하면(5~10분) 그다음엔 바탕화면 아이콘으로 켜면 돼요.</li>
      </ul>

      <b>공용 AI 엔진(Gemini)과 다른 점</b>
      {/* 좁은 창에서는 표만 가로로 밀어 본다 */}
      <div className="table-scroll">
        <table className="engine-table">
          <thead>
            <tr>
              <th />
              <th>내 AI 계정</th>
              <th>공용 AI 엔진 (Gemini)</th>
            </tr>
          </thead>
          <tbody>
            {DIFF_ROWS.map(([label, mine, shared]) => (
              <tr key={label}>
                <th>{label}</th>
                <td>{mine}</td>
                <td>{shared}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">
        간단히 찾아보는 질문은 공용 엔진으로도 충분해요. 편성 기획처럼 여러 조건을 따져야 하거나 문서를 고칠 때는 내 AI 계정을
        권해요.
      </p>
    </div>
  )
}

/** 차이 안내를 띄우는 창 — 대시보드 패널과 챗봇 창의 "차이 보기"가 같이 쓴다 */
export function EngineGuideModal({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal cli-modal engine-guide-modal" role="dialog" aria-label="내 AI 계정과 공용 AI 엔진의 차이" onClick={(ev) => ev.stopPropagation()}>
        <div className="panel-head">
          <span className="label strong">무슨 차이가 있나요?</span>
          <button className="btn sm" style={{ marginLeft: 'auto' }} onClick={onClose}>
            닫기
          </button>
        </div>
        <div className="modal-body">
          <EngineGuide />
        </div>
      </div>
    </div>
  )
}
