import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import DonorHeader from '../components/DonorHeader'
import LevelRows from '../components/LevelRows'
import PageShell from '../components/PageShell'

/**
 * Intro hero. The choreography lives entirely in CSS (src/index.css): timings, geometry, font
 * (Bricolage Grotesque 800), letter-spacing and line-height are FINAL: do not change them.
 */
function Hero() {
  const [fontsReady, setFontsReady] = useState(false)

  // Wait for the fonts so the ring lands exactly on the "o" (no font swap jump).
  useEffect(() => {
    let cancelled = false
    void document.fonts.ready.then(() => {
      if (!cancelled) setFontsReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [])

  if (!fontsReady) return <section style={{ minHeight: '583px' }} aria-hidden="true" />

  return (
    <section
      style={{ minHeight: '583px', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 0 56px', position: 'relative', overflow: 'hidden' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '48px' }}>
        <div className="grow">
          <h1
            className="rise"
            style={{ margin: 0, fontSize: 'clamp(56px, 9vw, 132px)', lineHeight: 0.92, fontWeight: 800, letterSpacing: '-0.04em', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}
          >
            <span className="gone" style={{ display: 'block', whiteSpace: 'nowrap' }}>
              Cada aporte
            </span>
            <span style={{ display: 'block', whiteSpace: 'nowrap' }}>
              <span className="gone">deja </span>
              <span className="word" style={{ color: '#B4235A' }}>
                rastr
                <span style={{ position: 'relative', display: 'inline-block' }}>
                  <span className="o-letter">o</span>
                  <svg
                    className="mark"
                    viewBox="-1200 -1200 2400 2400"
                    aria-hidden="true"
                    style={{ position: 'absolute', left: '0.3285em', top: '0.526em', width: '2.4em', height: '2.4em', transform: 'translate(-50%, -50%)', overflow: 'visible' }}
                  >
                    <line className="ln ln1" pathLength="1" x1="230.6" y1="-140.5" x2="453.7" y2="-276.4" stroke="#1B1530" strokeWidth="49.8" strokeLinecap="round" />
                    <line className="ln ln2" pathLength="1" x1="619.3" y1="-349.9" x2="817.6" y2="-408.5" stroke="#1B1530" strokeWidth="49.8" strokeLinecap="round" />
                    <line className="ln3" x1="940.0" y1="-503.2" x2="1047.9" y2="-683.0" stroke="#8A8296" strokeWidth="49.8" strokeDasharray="50 58" strokeLinecap="round" />
                    <circle className="ring" pathLength="1" transform="rotate(-90)" cx="0" cy="0" r="205.0" fill="none" stroke="#B4235A" strokeWidth="130" />
                    <circle className="pop core" cx="0" cy="0" r="66.5" fill="#B4235A" />
                    <circle className="pop n1" cx="531.7" cy="-324.0" r="91.4" fill="#1A7F52" />
                    <circle className="pop n2" cx="897.2" cy="-432.0" r="83.1" fill="#E8A317" />
                    <circle className="pop n3" cx="1096.6" cy="-764.3" r="56.5" fill="none" stroke="#8A8296" strokeWidth="36.6" strokeDasharray="28 25" />
                  </svg>
                </span>
              </span>
              <span className="gone">.</span>
            </span>
          </h1>
        </div>
        <div className="after" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '22px', textAlign: 'center', padding: '0 24px' }}>
          <p style={{ margin: 0, fontSize: 'clamp(16px, 1.6vw, 20px)', lineHeight: 1.5, color: '#5A5468', maxWidth: '520px' }}>
            Donaciones en custodia que se liberan por tramos, sellados con facturas reales y registrados en cadena.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', justifyContent: 'center' }}>
            <a
              href="#fundaciones"
              style={{ minHeight: '52px', padding: '0 26px', borderRadius: '12px', background: '#B4235A', color: '#FFFFFF', fontWeight: 700, fontSize: '16px', display: 'flex', alignItems: 'center', textDecoration: 'none' }}
            >
              Ver fundaciones
            </a>
            <Link
              to="/registro"
              style={{ minHeight: '52px', padding: '0 26px', borderRadius: '12px', border: '1.5px solid #1B1530', color: '#1B1530', fontWeight: 600, fontSize: '16px', display: 'flex', alignItems: 'center', textDecoration: 'none' }}
            >
              Soy fundación
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}

export default function Home() {
  return (
    <PageShell minHeight={0}>
      <DonorHeader active="home" />
      <Hero />
      <LevelRows />
    </PageShell>
  )
}
