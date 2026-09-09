import { useNavigate, useSearchParams } from 'react-router-dom'
import { TopBar } from '../components/AppShell'
import { categories, categoryShort } from '../data/docs'
import { useApp } from '../store/AppStore'
import type { CategoryId } from '../types'

export function WikiIndex() {
  const { docs } = useApp()
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const active = params.get('category') as CategoryId | null

  const list = active ? docs.filter((d) => d.category === active) : docs

  return (
    <>
      <TopBar />
      <div className="content">
        <div className="page-head">
          <span className="page-title">위키 문서</span>
          <span className="muted mono" style={{ fontSize: 11 }}>
            {list.length}건
          </span>
        </div>

        <div className="filter-bar">
          <button
            className={`btn sm${active ? '' : ' primary'}`}
            onClick={() => setParams({})}
          >
            전체 {docs.length}
          </button>
          {categories.map((c) => (
            <button
              key={c.id}
              className={`btn sm${active === c.id ? ' primary' : ''}`}
              onClick={() => setParams({ category: c.id })}
            >
              {c.label} {docs.filter((d) => d.category === c.id).length}
            </button>
          ))}
        </div>

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
