import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { TopBar } from '../components/AppShell'
import { categories, categoryShort, subcategories } from '../data/docs'
import { requestNewDoc, type NewDocResult } from '../lib/createDoc'
import { useApp } from '../store/AppStore'
import type { CategoryId, ProductScope } from '../types'

/** 코드가 숫자로 안 끝나는 서브메뉴(ACS·CBS·Swing 등)는 다음 번호를 자동으로 못 매긴다 */
const NO_AUTO_CODE = new Set(['system'])

export function NewDoc() {
  const { docs, session } = useApp()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const initialCategory = (params.get('category') as CategoryId | null) ?? categories[0].id
  const initialSub = params.get('sub')

  const [category, setCategory] = useState<CategoryId>(
    categories.some((c) => c.id === initialCategory) ? initialCategory : categories[0].id,
  )
  const subs = useMemo(
    () => subcategories[category].filter((s) => !NO_AUTO_CODE.has(s.id)),
    [category],
  )
  const [subcategory, setSubcategory] = useState<string | null>(
    subs.some((s) => s.id === initialSub) ? initialSub : null,
  )
  const [title, setTitle] = useState('')
  const [scope, setScope] = useState<ProductScope | '공통'>('공통')
  const [body, setBody] = useState('')
  const [tab, setTab] = useState<'edit' | 'preview'>('edit')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<NewDocResult | null>(null)

  const onCategoryChange = (next: CategoryId) => {
    setCategory(next)
    const nextSubs = subcategories[next].filter((s) => !NO_AUTO_CODE.has(s.id))
    setSubcategory(nextSubs[0]?.id ?? null)
  }

  const submit = async () => {
    if (!title.trim() || !body.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      const res = await requestNewDoc({ category, subcategory, title: title.trim(), scope, body }, docs, session.name)
      setResult(res)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (result) {
    return (
      <>
        <TopBar />
        <div className="content">
          <div className="page-head">
            <span className="page-title">새 문서 요청 완료</span>
          </div>
          <div className="panel">
            <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <span>
                <b>{result.code}</b> 문서로 PR을 만들었습니다. 팀장이 확인하고 머지하면 다음 배포에서 위키에 반영됩니다.
              </span>
              <div className="form-actions">
                <button className="btn primary" onClick={() => window.open(result.prUrl, '_blank', 'noopener,noreferrer')}>
                  PR 열어보기 →
                </button>
                <button className="btn" onClick={() => navigate('/wiki')}>
                  위키로 돌아가기
                </button>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <TopBar />
      <div className="content">
        <div className="page-head">
          <span className="page-title">새 문서</span>
        </div>

        <div className="panel form-card">
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="form-grid">
              <div className="form-row">
                <span className="label strong">카테고리 *</span>
                <select className="field" value={category} onChange={(e) => onCategoryChange(e.target.value as CategoryId)}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              {subs.length > 0 && (
                <div className="form-row">
                  <span className="label strong">서브메뉴 *</span>
                  <select className="field" value={subcategory ?? ''} onChange={(e) => setSubcategory(e.target.value)}>
                    {subs.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="form-row">
                <span className="label strong">적용 상품</span>
                <select className="field" value={scope} onChange={(e) => setScope(e.target.value as ProductScope | '공통')}>
                  <option value="공통">공통</option>
                  <option value="PPM">PPM(월정액)</option>
                  <option value="PPV">PPV(단건)</option>
                </select>
              </div>
              <div className="form-row">
                <span className="label strong">작성자</span>
                <input className="field" value={`${session.name} · ${session.team}`} readOnly />
              </div>
            </div>

            <div className="form-row">
              <span className="label strong">제목 *</span>
              <input
                className="field"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="예: 오늘의 픽 배너"
              />
            </div>

            <div className="form-row">
              <span className="label strong">본문 * (마크다운)</span>
              <div className="panel-head" style={{ padding: 0, marginBottom: 6 }}>
                <button className={`btn sm${tab === 'edit' ? ' primary' : ''}`} onClick={() => setTab('edit')}>
                  편집
                </button>
                <button className={`btn sm${tab === 'preview' ? ' primary' : ''}`} onClick={() => setTab('preview')}>
                  미리보기
                </button>
              </div>
              {tab === 'edit' ? (
                <textarea
                  className="field"
                  style={{ minHeight: 320 }}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="문서 본문을 마크다운으로 적어 주세요"
                  aria-label="마크다운 편집"
                />
              ) : (
                <div className="md" style={{ minHeight: 320 }}>
                  {body.trim() ? (
                    <ReactMarkdown remarkPlugins={[[remarkGfm, { singleTilde: false }]]}>{body}</ReactMarkdown>
                  ) : (
                    <span className="muted">본문을 입력하면 여기 미리보기가 뜹니다</span>
                  )}
                </div>
              )}
            </div>

            <div className="hint">
              문서 코드는 같은 서브메뉴의 다음 번호로 자동으로 매겨집니다. 제출하면 바로 위키에 반영되지 않고,
              GitHub에 PR이 만들어지며 팀장이 머지해야 반영됩니다.
            </div>

            {error && <div className="err">{error}</div>}

            <div className="form-actions">
              <button className="btn primary" disabled={!title.trim() || !body.trim() || busy} onClick={submit}>
                {busy ? 'PR 만드는 중…' : `PR로 제출 · ${categoryShort[category]}`}
              </button>
              <button className="btn" onClick={() => navigate(-1)} disabled={busy}>
                취소
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
