import { TopBar } from '../components/AppShell'
import { scheduleTrail } from '../data/scheduleNav'

/**
 * 편성/스케줄 — 아직 화면이 없는 메뉴의 자리표시.
 *
 * 메뉴만 있고 눌러도 아무 일이 없으면 담당자는 고장으로 읽는다.
 * 어느 메뉴를 눌렀는지와 지금 어떤 상태인지만 분명히 보여 준다.
 */
export function ScheduleSoon({ label, path, state }: { label: string; path: string; state: string }) {
  const trail = scheduleTrail(path) ?? ['편성/스케줄', label]

  return (
    <>
      <TopBar />
      <div className="content">
        <div className="panel schedule-soon">
          <span className="label strong">{trail.join(' › ')}</span>
          <h1>{label}</h1>
          <p className="tag solid">{state}</p>
          <p className="muted">
            이 메뉴의 편성 화면은 아직 없습니다. 준비되는 대로 이 자리에 붙습니다.
          </p>
        </div>
      </div>
    </>
  )
}
