import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { gnbList, platformLabel } from '../data/sheets'
import { useApp } from '../store/AppStore'
import type { SheetPlatform } from '../types'

const typeLabel = { sheet: '시트', screen: '전용 화면' } as const

export function Sheets() {
  const { sheets, requestPromotion, promotions } = useApp()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()

  const [q, setQ] = useState('')
  const [owner, setOwner] = useState('')

  // GNB·플랫폼은 사이드바 메뉴(편성/스케줄 › 홈 › B tv)와 맞물리도록 URL에 둔다
  const gnb = params.get('gnb') ?? ''
  const platformParam = params.get('platform')
  const platform = platformParam && platformParam in platformLabel ? (platformParam as SheetPlatform) : null

  const setGnb = (value: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (value) next.set('gnb', value)
      else next.delete('gnb')
      if (value !== '홈') next.delete('platform')
      next.delete('id')
      return next
    })

  const owners = useMemo(() => [...new Set(sheets.map((s) => s.ownerName))], [sheets])

  const filtered = sheets.filter((s) => {
    const text = `${s.name} ${s.ownerName}`.toLowerCase()
    return (
      text.includes(q.toLowerCase()) &&
      (!gnb || s.gnb === gnb) &&
      (!platform || s.platform === platform) &&
      (!owner || s.ownerName === owner)
    )
  })

  const selectedId = params.get('id') ?? filtered[0]?.id ?? null
  const selected = sheets.find((s) => s.id === selectedId) ?? null
  const promotionPending = promotions.some(
    (p) => p.sheetId === selectedId && p.status === 'pending',
  )

  const registerQuery = new URLSearchParams()
  if (gnb) registerQuery.set('gnb', gnb)
  if (platform) registerQuery.set('platform', platform)
  const registerUrl = `/sheets/new${registerQuery.size ? `?${registerQuery}` : ''}`

  const gnbText = (s: { gnb: string; platform?: SheetPlatform }) =>
    s.platform ? `${s.gnb} · ${platformLabel[s.platform]}` : s.gnb

  return (
    <>
      <TopBar />
      <div className="content flush sheetzone" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="panel-head" style={{ background: 'var(--surface)', flex: 'none' }}>
          <span className="label strong">
            편성/스케줄
            {gnb && ` › ${gnb}`}
            {platform && ` › ${platformLabel[platform]}`}
          </span>
          <span className="tag">비공식 · 링크 허브</span>
          <span className="mono muted" style={{ marginLeft: 'auto', fontSize: 10.5 }}>
            본부 전체 공개
          </span>
        </div>

        <div className="sheet-split">
          <div className="sheet-list">
            <div className="sheet-filters">
              <div className="search-input" style={{ flex: 1, minWidth: 160 }}>
                <span className="mono muted">⌕</span>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="이름 · 담당자 필터"
                  aria-label="편성표 이름 또는 담당자 필터"
                />
              </div>
              <select className="field" style={{ width: 120 }} value={gnb} onChange={(e) => setGnb(e.target.value)}>
                <option value="">GNB 전체</option>
                {gnbList.map((g) => (
                  <option key={g}>{g}</option>
                ))}
              </select>
              <select className="field" style={{ width: 110 }} value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">담당자 전체</option>
                {owners.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
              <button className="btn sm primary" onClick={() => navigate(registerUrl)}>
                + 등록
              </button>
            </div>

            <div className="sheet-grid-head">
              <span>편성표명 · 유형</span>
              <span>담당자</span>
              <span>GNB</span>
              <span>대상 기간</span>
              <span>확인일</span>
            </div>

            <div style={{ overflow: 'auto', flex: 1 }}>
              {filtered.map((s) => (
                <button
                  key={s.id}
                  className={`sheet-grid-row${s.id === selectedId ? ' on' : ''}`}
                  onClick={() =>
                    setParams((prev) => {
                      const next = new URLSearchParams(prev)
                      next.set('id', s.id)
                      return next
                    })
                  }
                >
                  <span className="name">
                    <span className={`tag${s.type === 'screen' ? ' solid' : ''}`} style={{ flex: 'none' }}>
                      {typeLabel[s.type]}
                    </span>
                    <span style={{ color: s.id === selectedId ? 'var(--text)' : undefined }}>{s.name}</span>
                  </span>
                  <span>{s.ownerName}</span>
                  <span>{gnbText(s)}</span>
                  <span>
                    {s.periodStart.slice(5)}–{s.periodEnd.slice(5)}
                  </span>
                  <span>{s.lastCheckedAt.slice(5)}</span>
                </button>
              ))}
              {filtered.length === 0 && (
                <div className="empty" style={{ background: 'var(--surface)' }}>
                  <div className="box" />
                  조건에 맞는 편성표가 없습니다
                  <button className="btn sm primary" onClick={() => navigate(registerUrl)}>
                    + 편성표 등록
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="sheet-detail">
            {selected ? (
              <>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, marginBottom: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ font: '700 14px var(--mono)' }}>{selected.name}</div>
                    <div className="mono muted" style={{ fontSize: 10.5, marginTop: 5 }}>
                      {selected.ownerName} · {gnbText(selected)} · {selected.periodStart.slice(5)}–
                      {selected.periodEnd.slice(5)} · {typeLabel[selected.type]}
                    </div>
                  </div>
                  <a className="btn sm" href={selected.url} target="_blank" rel="noreferrer">
                    원본 열기 ↗
                  </a>
                </div>

                {selected.embedBlocked ? (
                  <>
                    <div className="embed" style={{ background: 'none', borderStyle: 'dashed' }}>
                      미리보기를 불러올 수 없습니다
                      <br />
                      (공유 권한 · iframe 차단)
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                      <a className="btn sm" href={selected.url} target="_blank" rel="noreferrer">
                        원본 열기 ↗
                      </a>
                      <button className="btn sm">담당자에게 권한 요청</button>
                    </div>
                  </>
                ) : (
                  <div className="embed">
                    미리보기 영역
                    <br />
                    {selected.type === 'sheet' ? '구글 시트 iframe' : '담당자 개발 화면 iframe'}
                  </div>
                )}

                <p style={{ font: '12px/1.7 var(--sans)', color: 'var(--text-2)', marginTop: 12 }}>
                  {selected.description}
                </p>

                <div className="hairline" style={{ marginTop: 13, paddingTop: 11 }}>
                  <button
                    className="btn sm"
                    disabled={promotionPending}
                    onClick={() => requestPromotion(selected.id)}
                  >
                    {promotionPending ? '승격 요청 대기 중' : '↑ 정식 지식 문서로 승격 요청'}
                  </button>
                </div>
              </>
            ) : (
              <div className="empty">
                <div className="box" />
                좌측에서 편성표를 선택하세요
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
