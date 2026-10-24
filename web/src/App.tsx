import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import FoundationDetail from './pages/FoundationDetail'
import MyDonations from './pages/MyDonations'
import Welcome from './pages/Welcome'
import OrgRegister from './pages/OrgRegister'
import OrgDashboard from './pages/OrgDashboard'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Welcome />} />
        <Route path="/fundaciones" element={<Home />} />
        <Route path="/organizacion" element={<OrgDashboard />} />
        <Route path="/organizacion/registro" element={<OrgRegister />} />
        <Route path="/fundacion/:id" element={<FoundationDetail />} />
        <Route path="/mis-donaciones" element={<MyDonations />} />
      </Route>
    </Routes>
  )
}
