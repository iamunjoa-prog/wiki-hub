import { Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { schedulePlaceholders } from './data/scheduleNav'
import { Approvals } from './pages/Approvals'
import { BigBannerSchedule } from './pages/BigBannerSchedule'
import { BtvSchedule } from './pages/BtvSchedule'
import { CampaignApp } from './pages/CampaignApp'
import { CampaignHandoff } from './pages/CampaignHandoff'
import { Dashboard } from './pages/Dashboard'
import { MyRequests } from './pages/MyRequests'
import { ProposeEdit } from './pages/ProposeEdit'
import { ScheduleSoon } from './pages/ScheduleSoon'
import { SearchResults } from './pages/SearchResults'
import { SheetRegister } from './pages/SheetRegister'
import { Sheets } from './pages/Sheets'
import { WikiDoc } from './pages/WikiDoc'
import { WikiIndex } from './pages/WikiIndex'

export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/wiki" element={<WikiIndex />} />
        <Route path="/wiki/:docId" element={<WikiDoc />} />
        <Route path="/wiki/:docId/propose" element={<ProposeEdit />} />
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
        <Route path="/requests" element={<MyRequests />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/handoff" element={<CampaignHandoff />} />
      </Route>
    </Routes>
  )
}
