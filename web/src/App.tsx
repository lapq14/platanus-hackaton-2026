import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import RoleGuard from './components/RoleGuard'
import ConsolaAuditor from './pages/ConsolaAuditor'
import Explorar from './pages/Explorar'
import Facturas from './pages/Facturas'
import FondosFundacion from './pages/FondosFundacion'
import Fundacion from './pages/Fundacion'
import Home from './pages/Home'
import MisRastros from './pages/MisRastros'
import PanelFundacion from './pages/PanelFundacion'
import PerfilFundacion from './pages/PerfilFundacion'
import Reclamar from './pages/Reclamar'
import Reembolso from './pages/Reembolso'
import Registro from './pages/Registro'

/** Scrolls to the top on navigation, or to the `#hash` element when there is one (e.g. /panel#sellar). */
function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (!hash) {
      window.scrollTo(0, 0)
      return
    }
    // The target may render after data loads: retry briefly.
    let tries = 0
    const t = setInterval(() => {
      const el = document.getElementById(hash.slice(1))
      if (el || ++tries > 20) {
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        clearInterval(t)
      }
    }, 100)
    return () => clearInterval(t)
  }, [pathname, hash])
  return null
}

// Every page brings its own header, so there is no shared layout route.
export default function App() {
  return (
    <>
      <ScrollManager />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/explorar" element={<Explorar />} />
        <Route path="/fundacion/:id" element={<Fundacion />} />
        <Route path="/mis-rastros" element={<MisRastros />} />
        <Route path="/mis-rastros/reembolso/:donationId" element={<Reembolso />} />
        <Route
          path="/panel"
          element={
            <RoleGuard role="ong">
              <PanelFundacion />
            </RoleGuard>
          }
        />
        <Route
          path="/panel/facturas"
          element={
            <RoleGuard role="ong">
              <Facturas />
            </RoleGuard>
          }
        />
        <Route
          path="/panel/fondos"
          element={
            <RoleGuard role="ong">
              <FondosFundacion />
            </RoleGuard>
          }
        />
        <Route
          path="/panel/perfil"
          element={
            <RoleGuard role="ong">
              <PerfilFundacion />
            </RoleGuard>
          }
        />
        <Route
          path="/auditor"
          element={
            <RoleGuard role="auditor">
              <ConsolaAuditor />
            </RoleGuard>
          }
        />
        <Route path="/registro" element={<Registro />} />
        <Route path="/reclamar" element={<Reclamar />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </>
  )
}
