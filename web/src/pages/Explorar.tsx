import type { CSSProperties } from 'react'
import CatalogSection from '../components/CatalogSection'
import DonorHeader from '../components/DonorHeader'
import PageShell from '../components/PageShell'
import { PrimaryButton, SecondaryButton } from '../components/Buttons'
import TramoIcon from '../components/TramoIcon'
import { LEVEL_RELEASE, LEVEL_ROMAN, splitDonation } from '../config/levels'
import { formatUSDT } from '../lib/format'

const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }
const EXAMPLE_AMOUNT = 50
const EXAMPLE_LEVEL = 3 as const

/** Illustrative "how a $50 donation travels" card. Amounts come from LEVEL_RELEASE so they always match the real rule. */
function TravelCard() {
  const pct = LEVEL_RELEASE[EXAMPLE_LEVEL]
  const amounts = splitDonation(EXAMPLE_AMOUNT, pct)
  const cols: { label: string; ref?: string }[] = [
    { label: 'Liberado al donar', ref: 'tx 0x7a3f…' },
    { label: 'Factura sellada', ref: 'hash 0x2d08…' },
    { label: 'En revisión' },
    { label: 'En custodia' },
  ]
  return (
    <div style={{ flex: '1 1 460px', background: '#FFFFFF', border: '1.5px solid #1B1530', borderRadius: '20px', padding: '28px', display: 'flex', flexDirection: 'column', gap: '22px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '8px' }}>
        <span style={{ fontSize: '17px', fontWeight: 700 }}>Así viaja un aporte de ${EXAMPLE_AMOUNT}</span>
        <span style={{ ...MONO, fontSize: '12px', color: '#5A5468' }}>
          NIVEL {LEVEL_ROMAN[EXAMPLE_LEVEL]} · {pct}% INICIAL
        </span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <TramoIcon state="released" />
        <div style={{ flex: 1, height: '3px', background: '#1B1530', margin: '0 6px' }} />
        <TramoIcon state="released" />
        <div style={{ flex: 1, height: 0, borderTop: '3px dashed #8A8296', margin: '0 6px' }} />
        <TramoIcon state="in_review" />
        <div style={{ flex: 1, height: 0, borderTop: '3px dashed #8A8296', margin: '0 6px' }} />
        <TramoIcon state="in_custody" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '10px' }}>
        {cols.map((c, i) => (
          <div key={c.label} style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <span style={{ ...MONO, fontSize: '17px', fontWeight: 600 }}>{formatUSDT(amounts[i])}</span>
            <span style={{ fontSize: '13px', color: '#5A5468' }}>{c.label}</span>
            {c.ref && <span style={{ ...MONO, fontSize: '11px', color: '#3B3FB6' }}>{c.ref}</span>}
          </div>
        ))}
      </div>
      <p style={{ margin: 0, paddingTop: '16px', borderTop: '1.5px dashed #DAD4CF', fontSize: '15px', fontWeight: 600 }}>
        Sin factura, no hay siguiente paso.
      </p>
    </div>
  )
}

export default function Explorar() {
  return (
    <PageShell minHeight={1180}>
      <DonorHeader active="explorar" />
      <section style={{ maxWidth: '1200px', margin: '0 auto', padding: '56px 24px 40px', display: 'flex', flexWrap: 'wrap', gap: '40px', alignItems: 'center' }}>
        <div style={{ flex: '1 1 460px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <span style={{ ...MONO, fontSize: '12px', letterSpacing: '2px', color: '#5A5468' }}>DONACIONES EN CUSTODIA · TRUSH NETWORK</span>
          <h1 style={{ margin: 0, fontSize: 'clamp(44px, 6vw, 76px)', lineHeight: 0.92, fontWeight: 800, letterSpacing: '-3px' }}>
            Cada aporte
            <br />
            deja <span style={{ color: '#B4235A' }}>rastro.</span>
          </h1>
          <p style={{ margin: 0, fontSize: '19px', lineHeight: 1.5, color: '#5A5468', maxWidth: '500px' }}>
            Donaciones en custodia que se liberan por tramos, sellados con facturas reales y registrados en cadena. Si algo no cuadra, tu dinero vuelve.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            <PrimaryButton href="#fundaciones">Elegir una fundación</PrimaryButton>
            <SecondaryButton href="#">Cómo se libera el dinero</SecondaryButton>
          </div>
        </div>
        <TravelCard />
      </section>
      <CatalogSection variant="explorar" />
    </PageShell>
  )
}
