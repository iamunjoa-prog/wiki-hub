import { TopBar } from '../components/AppShell'

/** 관리자 "대화 기록" — 화면은 다음 커밋에서 채운다 */
export function ChatLog() {
  return (
    <>
      <TopBar />
      <div className="content flush">
        <div className="panel-head">
          <span className="label strong">대화 기록</span>
          <span className="tag solid">관리자 전용</span>
        </div>
      </div>
    </>
  )
}
