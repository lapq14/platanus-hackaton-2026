import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import FoundationDetail from './pages/FoundationDetail'
import MyDonations from './pages/MyDonations'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Home />} />
        <Route path="/fundacion/:id" element={<FoundationDetail />} />
        <Route path="/mis-donaciones" element={<MyDonations />} />
      </Route>
    </Routes>
  )
}
