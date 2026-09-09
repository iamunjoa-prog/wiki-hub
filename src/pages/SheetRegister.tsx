import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { gnbList } from '../data/sheets'
import { useApp } from '../store/AppStore'
import type { SheetType } from '../types'

export function SheetRegister() {
  const { addSheet, session } = useApp()
  const navigate = useNavigate()

  const [type, setType] = useState<SheetType>('sheet')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const [gnb, setGnb] = useState(gnbList[0])
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')

  const submit = () => {
    if (!url.trim()) return setError('URL은 필수입니다')
    if (!/^https?:\/\//.test(url.trim())) return setError('http(s):// 로 시작하는 URL을 입력하세요')
    if (!name.trim()) return setError('편성표명을 입력하세요')
    setError('')
    addSheet({
      name: name.trim(),
      type,
      url: url.trim(),
      gnb,
      periodStart: periodStart || '-',
      periodEnd: periodEnd || '-',
      description: description.trim(),
    })
    navigate('/sheets')
  }

  return (
    <>
      <TopBar />
      <div className="content sheetzone">
        <div className="page-head">
          <span className="page-title">편성표 등록</span>
          <span className="tag">비공식 영역</span>
        </div>

        <div className="panel form-card">
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-row">
              <span className="label strong">등록 유형</span>
              <div className="seg">
                <button
                  className={`btn sm${type === 'sheet' ? ' primary' : ''}`}
                  onClick={() => setType('sheet')}
                >
                  구글 시트
                </button>
                <button
                  className={`btn sm${type === 'screen' ? ' primary' : ''}`}
                  onClick={() => setType('screen')}
                >
                  담당자 전용 화면
                </button>
              </div>
            </div>

            <div className="form-row">
              <span className="label strong">시트 / 화면 URL *</span>
              <input
                className="field"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder={type === 'sheet' ? 'https://docs.google.com/…' : 'https://intra.example.com/…'}
              />
            </div>

            <div className="form-grid">
              <div className="form-row">
                <span className="label strong">편성표명 *</span>
                <input className="field" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="form-row">
                <span className="label strong">등록자</span>
                <input className="field" value={`${session.name} · ${session.team}`} readOnly />
              </div>
              <div className="form-row">
                <span className="label strong">대상 GNB</span>
                <select className="field" value={gnb} onChange={(e) => setGnb(e.target.value)}>
                  {gnbList.map((g) => (
                    <option key={g}>{g}</option>
                  ))}
                </select>
              </div>
              <div className="form-row">
                <span className="label strong">대상 기간</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="field"
                    type="date"
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                  />
                  <input
                    className="field"
                    type="date"
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="form-row">
              <span className="label strong">한 줄 설명</span>
              <input
                className="field"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="어떤 편성을 담은 표인지 한 줄로"
              />
            </div>

            <div className="hint">
              구글 시트는 공유 권한을 “본부 전체 보기 가능”으로 · 전용 화면은 사내망에서 iframe 허용된 URL이어야
              합니다
            </div>

            {error && <div className="err">{error}</div>}

            <div className="form-actions">
              <button className="btn primary" onClick={submit}>
                등록
              </button>
              <button className="btn" onClick={() => navigate('/sheets')}>
                취소
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
