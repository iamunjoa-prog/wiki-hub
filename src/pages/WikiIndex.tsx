import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { categories, categoryShort, docRank, subcategories } from '../data/docs'
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
  // 승인으로 뒤에 붙은 문서도 사이드바 순서 안에 들어가게 한 번 더 세운다
  const list = (active && activeSub ? byCategory.filter(subFilter) : byCategory)
    .map((d, i) => ({ d, i, rank: docRank(d) }))
    .sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.i - b.i)
    .map((x) => x.d)

  /** 행 태그·묶음 제목에 쓰는 서브메뉴 이름. 서브메뉴가 없는 카테고리(이용 안내)는 카테고리 이름 */
  const subLabel = (d: (typeof docs)[number]) => {
    const own = subcategories[d.category] ?? []
    if (own.length === 0) return categoryShort[d.category]
    return own.find((s) => s.id === d.subcategory)?.label ?? '기타'
  }
  const groupLabel = (d: (typeof docs)[number]) => {
    const own = subcategories[d.category] ?? []
    const cat = categories.find((c) => c.id === d.category)?.label ?? categoryShort[d.category]
    if (own.length === 0) return cat
    return active ? subLabel(d) : `${cat} › ${subLabel(d)}`
  }
  // 서브메뉴 칩을 고른 화면은 모두 같은 묶음이라 제목 줄을 생략한다
  const groups: { label: string; items: typeof list }[] = []
  for (const d of list) {
    const label = activeSub ? '' : groupLabel(d)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(d)
    else groups.push({ label, items: [d] })
  }

  // 사이드바와 같은 기준 — 문서가 0건인 칩은 뒤로 보내고 누를 수 없게 한다
  const categoryCount = (id: CategoryId) => docs.filter((d) => d.category === id).length
  const subCount = (id: string) =>
    id === '__unassigned__' ? unassigned.length : byCategory.filter((d) => d.subcategory === id).length
  // 처음 온 사람이 이용 안내를 찾아 내려가지 않게 — 이용 안내 첫 문서로 바로 가는 줄 (IA-9)
  const firstGuide = docs.find((d) => d.category === 'guide')
  const filledFirst = <T,>(items: T[], count: (item: T) => number) =>
    [...items].sort((a, b) => Number(count(b) > 0) - Number(count(a) > 0))

  return (
    <>
      <TopBar />
      <div className="content">
        <div className="page-head">
          <span className="page-title">위키 문서</span>
          <span className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>
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

        {!active && firstGuide && (
          <p className="wiki-first">
            처음이라면: <Link to={`/wiki/${firstGuide.id}`}>{firstGuide.title}</Link>
          </p>
        )}

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

        <div className="panel wiki-list">
          {groups.map((g) => (
            <div key={g.label || 'all'}>
              {g.label && (
                <div className="panel-head wiki-group">
                  <span className="label strong">{g.label}</span>
                  <span className="wiki-group-count">{g.items.length}</span>
                </div>
              )}
              {g.items.map((d) => (
                <button key={d.id} className="row wiki-row" onClick={() => navigate(`/wiki/${d.id}`)} title={d.title}>
                  <span className="tag">{subLabel(d)}</span>
                  <span className="grow">{d.title}</span>
                  <span className="wiki-row-code">{d.code}</span>
                  <span className="wiki-row-ver">v{d.version}</span>
                  <span className="wiki-row-by">{d.updatedBy}</span>
                  <span className="wiki-row-at">{d.updatedAt}</span>
                </button>
              ))}
            </div>
          ))}
          {list.length === 0 && <div className="empty">해당 카테고리에 문서가 없습니다</div>}
        </div>
      </div>
    </>
  )
}
