import { useState } from 'react'

/** 반려 사유 입력 — 승인 화면과 대시보드 인라인 반려가 같은 모달을 쓴다 */
export function RejectModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="modal-back" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="panel-head">
          <span className="label strong">반려 사유</span>
        </div>
        <div className="modal-body">
          <textarea
            className="field"
            style={{ minHeight: 80 }}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="요청자가 무엇을 고쳐야 하는지 적어 주세요"
            autoFocus
          />
          <div className="form-actions">
            <button className="btn primary" disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
              반려 처리
            </button>
            <button className="btn" onClick={onCancel}>
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
