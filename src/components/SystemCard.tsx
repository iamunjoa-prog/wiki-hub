import { useState } from 'react'
import type { SystemEntry } from '../types'
import { useApp } from '../store/AppStore'

function Star({ on }: { on: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill={on ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L2.6 9.8l6.5-.9L12 3Z" />
    </svg>
  )
}

/**
 * 시스템 카드 — 시스템 화면과 대시보드가 같은 카드를 쓴다.
 *
 * 별표는 대시보드 '자주 사용하는 시스템'에 올리는 스위치다. 링크와 겹치지 않게
 * 별표만 버튼으로 두고, 카드 본문은 새 탭으로 여는 링크로 둔다.
 */
export function SystemCard({ system }: { system: SystemEntry }) {
  const { favoriteSystems, toggleFavoriteSystem, requestSystemUrl, systemRequests } = useApp()
  const fav = favoriteSystems.includes(system.id)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // 주소는 모두가 함께 쓰는 값이라 승인을 거친다 — 대기 중이면 또 넣지 않게 막는다
  const urlPending = systemRequests.some(
    (r) => r.targetSystemId === system.id && r.status === 'pending',
  )

  const save = () => {
    if (!/^https?:\/\//.test(draft.trim())) return
    requestSystemUrl(system.id, draft)
    setEditing(false)
  }

  const body = (
    <>
      <span className="t">
        {system.name}
        {system.url && ' ↗'}
        <span className={system.access === '로컬 전용' ? 'net' : 'net cloud'}>{system.access}</span>
      </span>
      <span>{system.desc}</span>
    </>
  )

  return (
    <div className="sys-card">
      <button
        className={`sys-star${fav ? ' on' : ''}`}
        onClick={() => toggleFavoriteSystem(system.id)}
        aria-pressed={fav}
        title={fav ? '자주 사용하는 시스템에서 빼기' : '자주 사용하는 시스템에 담기'}
      >
        <Star on={fav} />
      </button>
      {editing ? (
        <div className="link-card sys-main editing">
          <span className="t">{system.name}</span>
          <input
            className="field"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save()
              if (e.key === 'Escape') setEditing(false)
            }}
            placeholder="http://"
            autoFocus
          />
          <span className="sys-url-note">승인되면 모두에게 보입니다</span>
          <span className="form-actions">
            <button
              className="btn sm primary"
              disabled={!/^https?:\/\//.test(draft.trim())}
              onClick={save}
            >
              등록 요청
            </button>
            <button className="btn sm" onClick={() => setEditing(false)}>
              취소
            </button>
          </span>
        </div>
      ) : system.url ? (
        <a className="link-card sys-main" href={system.url} target="_blank" rel="noreferrer">
          {body}
        </a>
      ) : (
        // 주소를 아직 못 받은 시스템 — 눌러도 아무 일이 없으면 고장으로 읽으므로 이유를 적어 둔다
        <div className="link-card sys-main off">
          {body}
          {urlPending ? (
            <span className="sys-url-note">접속 주소 승인 대기</span>
          ) : (
            <button
              className="sys-url-add"
              onClick={() => {
                setDraft('')
                setEditing(true)
              }}
            >
              URL 입력
            </button>
          )}
        </div>
      )}
    </div>
  )
}
