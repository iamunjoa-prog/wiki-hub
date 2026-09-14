import { TopBar } from '../components/AppShell'
import { CAMPAIGN_APP_URL } from '../data/sheets'

/** 편성/스케줄 › 캠페인 — 캠페인 웹앱을 본문 영역 전체에 띄운다 */
export function CampaignApp() {
  return (
    <>
      <TopBar>
        {CAMPAIGN_APP_URL && (
          <a className="btn sm" style={{ marginLeft: 'auto' }} href={CAMPAIGN_APP_URL} target="_blank" rel="noreferrer">
            새 창으로 열기 ↗
          </a>
        )}
      </TopBar>
      <div className="content flush app-frame-wrap">
        {CAMPAIGN_APP_URL ? (
          <iframe className="app-frame" src={CAMPAIGN_APP_URL} title="캠페인 웹앱" />
        ) : (
          <div className="empty" style={{ flex: 1, justifyContent: 'center' }}>
            <div className="box" />
            캠페인 웹앱 링크 연결 예정
            <span style={{ fontSize: 12.5 }}>링크가 등록되면 이 메뉴에서 바로 열립니다</span>
          </div>
        )}
      </div>
    </>
  )
}
