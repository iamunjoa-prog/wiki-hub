import { TopBar } from '../components/AppShell'

/** "내 대화 기록" — 화면은 다음 커밋에서 채운다 */
export function MyChatLog() {
  return (
    <>
      <TopBar />
      <div className="content flush">
        <div className="panel-head">
          <span className="label strong">내 대화 기록</span>
        </div>
      </div>
    </>
  )
}
