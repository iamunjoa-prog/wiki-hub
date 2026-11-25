import { Navigate, Route, Routes, useParams } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { schedulePlaceholders } from './data/scheduleNav'
import { Accounts } from './pages/Accounts'
import { Approvals } from './pages/Approvals'
import { BigBannerSchedule } from './pages/BigBannerSchedule'
import { BtvSchedule } from './pages/BtvSchedule'
import { CampaignApp } from './pages/CampaignApp'
import { CampaignHandoff } from './pages/CampaignHandoff'
import { ChatLog } from './pages/ChatLog'
import { Dashboard } from './pages/Dashboard'
import { JiraSchedule } from './pages/JiraSchedule'
import { MyChatLog } from './pages/MyChatLog'
import { MyRequests } from './pages/MyRequests'
import { NewDoc } from './pages/NewDoc'
import { ScheduleSoon } from './pages/ScheduleSoon'
import { SearchResults } from './pages/SearchResults'
import { SheetRegister } from './pages/SheetRegister'
import { Sheets } from './pages/Sheets'
import { Systems } from './pages/Systems'
import { WikiDoc } from './pages/WikiDoc'
import { WikiIndex } from './pages/WikiIndex'

/** 옛 수정 제안 주소 — 문서 보기 안 편집 모드로 넘겨준다. 북마크·내 요청의 [수정해서 다시 제안]이 깨지지 않게 */
function ProposeRedirect() {
  const { docId } = useParams()
  return <Navigate to={`/wiki/${docId}?edit=all`} replace />
}

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/wiki" element={<WikiIndex />} />
        <Route path="/wiki/new" element={<NewDoc />} />
        <Route path="/wiki/:docId" element={<WikiDoc />} />
        <Route path="/wiki/:docId/propose" element={<ProposeRedirect />} />
        <Route path="/search" element={<SearchResults />} />
        <Route path="/sheets" element={<Sheets />} />
        <Route path="/sheets/btv" element={<BtvSchedule />} />
        <Route path="/sheets/mobile/big-banner" element={<BigBannerSchedule />} />
        <Route path="/sheets/new" element={<SheetRegister />} />
        <Route path="/sheets/campaign" element={<CampaignApp />} />
        {/* 아직 화면이 없는 편성 메뉴 — 트리 정의에서 그대로 라우트를 만든다 */}
        {schedulePlaceholders.map((l) => (
          <Route
            key={l.path}
            path={l.path}
            element={<ScheduleSoon label={l.label} path={l.path} state={l.soon!} />}
          />
        ))}
        <Route path="/systems" element={<Systems />} />
        <Route path="/jira-schedule" element={<JiraSchedule />} />
        <Route path="/requests" element={<MyRequests />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/my-chat-log" element={<MyChatLog />} />
        <Route path="/chat-log" element={<ChatLog />} />
        <Route path="/handoff" element={<CampaignHandoff />} />
      </Route>
    </Routes>
  )
}
