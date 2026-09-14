import { Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Approvals } from './pages/Approvals'
import { CampaignApp } from './pages/CampaignApp'
import { CampaignHandoff } from './pages/CampaignHandoff'
import { Dashboard } from './pages/Dashboard'
import { MyRequests } from './pages/MyRequests'
import { ProposeEdit } from './pages/ProposeEdit'
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
        <Route path="/sheets/new" element={<SheetRegister />} />
        <Route path="/sheets/campaign" element={<CampaignApp />} />
        <Route path="/requests" element={<MyRequests />} />
        <Route path="/approvals" element={<Approvals />} />
        <Route path="/handoff" element={<CampaignHandoff />} />
      </Route>
    </Routes>
  )
}
