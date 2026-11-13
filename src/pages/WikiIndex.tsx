import { useNavigate, useSearchParams } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { categories, categoryShort, subcategories } from '../data/docs'
import { useApp } from '../store/AppStore'
import type { CategoryId } from '../types'

export function WikiIndex() {
  const { docs } = useApp()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const active = params.get('category') as CategoryId | null
  const activeSub = params.get('sub')

  const byCategory = active ? docs.filter((d) => d.category === active) : docs
  const subs = active ? subcategories[active] : []
  // 서브메뉴가 있는 카테고리인데 소속이 없는 문서는 '기타'로 묶어 놓치지 않는다
  const unassigned = subs.length > 0 ? byCategory.filter((d) => !subs.some((s) => s.id === d.subcategory)) : []
  const subsWithOthers = unassigned.length > 0 ? [...subs, { id: '__unassigned__', label: '기타' }] : subs
  const subFilter = (d: (typeof docs)[number]) =>
    activeSub === '__unassigned__' ? !subs.some((s) => s.id === d.subcategory) : d.subcategory === activeSub
  const list = active && activeSub ? byCategory.filter(subFilter) : byCategory

  // 사이드바와 같은 기준 — 문서가 0건인 칩은 뒤로 보내고 누를 수 없게 한다
  const categoryCount = (id: CategoryId) => docs.filter((d) => d.category === id).length
  const subCount = (id: string) =>
    id === '__unassigned__' ? unassigned.length : byCategory.filter((d) => d.subcategory === id).length
  const filledFirst = <T,>(items: T[], count: (item: T) => number) =>
    [...items].sort((a, b) => Number(count(b) > 0) - Number(count(a) > 0))

  return (
    <>
      <TopBar />
      <div className="content">
        <div className="page-head">
          <span className="page-title">위키 문서</span>
          <span className="muted mono" style={{ fontSize: 11 }}>
            {list.length}건
          </span>
          <button
            className="btn sm primary"
            style={{ marginLeft: 'auto' }}
            onClick={() => {
              const q = new URLSearchParams()
              if (active) q.set('category', active)
              if (activeSub) q.set('sub', activeSub)
              navigate(`/wiki/new${q.toString() ? `?${q}` : ''}`)
            }}
          >
            + 새 문서
          </button>
        </div>

        <div className="filter-bar">
          <button
            className={`btn sm${active ? '' : ' primary'}`}
            onClick={() => setParams({})}
          >
            전체 {docs.length}
          </button>
          {filledFirst(categories, (c) => categoryCount(c.id)).map((c) => (
            <button
              key={c.id}
              className={`btn sm${active === c.id ? ' primary' : ''}`}
              disabled={categoryCount(c.id) === 0}
              title={categoryCount(c.id) === 0 ? '아직 문서가 없습니다' : undefined}
              onClick={() => setParams({ category: c.id })}
            >
              {c.label} {categoryCount(c.id)}
            </button>
          ))}
        </div>

        {active && subsWithOthers.length > 0 && (
          <div className="filter-bar">
            <button
              className={`btn sm${activeSub ? '' : ' primary'}`}
              onClick={() => setParams({ category: active })}
            >
              전체 {byCategory.length}
            </button>
            {filledFirst(subsWithOthers, (s) => subCount(s.id)).map((s) => (
              <button
                key={s.id}
                className={`btn sm${activeSub === s.id ? ' primary' : ''}`}
                disabled={subCount(s.id) === 0}
                title={subCount(s.id) === 0 ? '아직 문서가 없습니다' : undefined}
                onClick={() => setParams({ category: active, sub: s.id })}
              >
                {s.label} {subCount(s.id)}
              </button>
            ))}
          </div>
        )}

        <div className="panel">
          {list.map((d) => (
            <button key={d.id} className="row" onClick={() => navigate(`/wiki/${d.id}`)}>
              <span className="tag">{categoryShort[d.category]}</span>
              <span className="grow">{d.title}</span>
              <span className="muted">{d.code}</span>
              <span className="muted">v{d.version}</span>
              <span className="muted">{d.updatedBy}</span>
              <span className="muted">{d.updatedAt}</span>
            </button>
          ))}
          {list.length === 0 && <div className="empty">해당 카테고리에 문서가 없습니다</div>}
        </div>
      </div>
    </>
  )
}
