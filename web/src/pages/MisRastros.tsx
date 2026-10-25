import { useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import DonorHeader from '../components/DonorHeader'
import Modal from '../components/Modal'
import PageShell from '../components/PageShell'
import RefundCard from '../components/RefundCard'
import SignInPrompt from '../components/SignInPrompt'
import StatCard from '../components/StatCard'
import TramoIcon from '../components/TramoIcon'
import TramoTimeline, { type TimelineStep } from '../components/TramoTimeline'
import { PrimaryButton, SecondaryButton } from '../components/Buttons'
import { LEVEL_RELEASE, LEVEL_ROMAN, toLevel } from '../config/levels'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { useMyDonations } from '../hooks/useMyDonations'
import { explorerAddress, explorerTx } from '../lib/chain'
import { formatUSDT, formatUSDTCompact, shortHash } from '../lib/format'
import { signedInvoiceUrl } from '../lib/storage'
import type { Donation, Invoice } from '../types'

const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }

/** One-line status of a donation for the list. */
function statusLine(d: Donation): { text: string; color: string; weight: number } {
  const tranches = d.tranches ?? []
  if (d.status === 'refunded' || tranches.some((t) => t.state === 'broken')) {
    const refunded = d.refunds?.[0]?.amount ?? d.amount_refunded
    return { text: `Sello roto · ${formatUSDT(refunded)} devueltos`, color: '#B4235A', weight: 600 }
  }
  const pending = tranches.find((t) => t.state !== 'released')
  if (!pending) return { text: `Rastro completo · ${tranches.length} de ${tranches.length}`, color: '#1A7F52', weight: 600 }
  return { text: `Tramo ${pending.index} ${pending.state === 'in_review' ? 'en revisión' : 'en custodia'}`, color: '#5A5468', weight: 400 }
}

function buildSteps(d: Donation, invoices: Record<string, Invoice>): TimelineStep[] {
  const level = toLevel(d.foundation?.level ?? 1)
  const pct = d.initial_pct ?? LEVEL_RELEASE[level]
  return (d.tranches ?? []).map<TimelineStep>((t) => {
    const prefix = `Paso ${t.index} · `
    const inv = t.invoice_id ? invoices[t.invoice_id] : undefined
    if (t.index === 1) {
      return t.state === 'released'
        ? { state: t.state, title: `${prefix}entrega inicial`, amount: t.amount, description: `Liberado al donar (Nivel ${LEVEL_ROMAN[level]} = ${pct}%).`, hash: t.tx_hash ? { prefix: 'tx', value: t.tx_hash } : undefined }
        : { state: t.state, title: `${prefix}entrega inicial`, amount: t.amount, description: t.state === 'broken' ? 'No se liberó: tu donación fue reembolsada a tu saldo.' : 'La entrega inicial está en proceso.' }
    }
    switch (t.state) {
      case 'released':
        return {
          state: t.state,
          title: `${prefix}factura enviada`,
          amount: t.amount,
          description: inv ? `${inv.concept} · Factura ${inv.number} · RIF verificado.` : 'Factura sellada · RIF verificado.',
          // The on-chain release tx is what the donor can verify; fall back to the invoice hash for legacy rows.
          hash: t.tx_hash ? { prefix: 'tx', value: t.tx_hash } : inv?.file_hash ? { prefix: 'hash', value: inv.file_hash } : undefined,
        }
      case 'in_review':
        return { state: t.state, title: `${prefix}en revisión`, amount: t.amount, description: 'El agente auditor está revisando factura y RIF.' }
      case 'broken':
        return { state: t.state, title: `${prefix}sello roto`, amount: t.amount, description: 'No se liberó: tu donación fue reembolsada a tu saldo.' }
      case 'in_custody':
        return { state: t.state, title: `${prefix}en custodia`, amount: t.amount, description: `Se libera cuando el paso ${t.index - 1} se complete.` }
    }
  })
}

function InvoicesPanel({ donation, invoices, onClose }: { donation: Donation; invoices: Record<string, Invoice>; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null)
  const sealed = (donation.tranches ?? [])
    .map((t) => (t.invoice_id ? invoices[t.invoice_id] : undefined))
    .filter((i): i is Invoice => !!i && i.status === 'verified')

  const open = async (inv: Invoice) => {
    const path = inv.file_paths[0] ?? inv.file_path
    if (!path) {
      setError('Esta factura no tiene un documento adjunto todavía.')
      return
    }
    try {
      window.open(await signedInvoiceUrl(path), '_blank', 'noopener,noreferrer')
      setError(null)
    } catch {
      setError('No pudimos abrir el documento. Intenta de nuevo.')
    }
  }

  return (
    <Modal title="Facturas selladas" onClose={onClose} maxWidth={560}>
      {sealed.length === 0 ? (
        <p style={{ margin: 0, color: '#5A5468' }}>Aún no hay facturas selladas para esta donación.</p>
      ) : (
        sealed.map((inv) => (
          <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '12px 0', borderTop: '1px solid #ECE7F0' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
              <strong style={{ fontSize: '15px' }}>{inv.concept}</strong>
              <span style={{ ...MONO, fontSize: '12px', color: '#5A5468' }}>
                {inv.number} · {formatUSDT(inv.amount)}
              </span>
              {inv.file_hash && (
                <a href={explorerTx(inv.file_hash)} target="_blank" rel="noopener noreferrer" style={{ ...MONO, fontSize: '12px', textDecoration: 'none' }}>
                  hash {shortHash(inv.file_hash)} ↗
                </a>
              )}
            </div>
            <button
              type="button"
              onClick={() => void open(inv)}
              style={{ minHeight: '36px', padding: '0 12px', borderRadius: '10px', border: '1.5px solid #1B1530', background: '#FFFFFF', color: '#1B1530', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
            >
              Ver PDF
            </button>
          </div>
        ))
      )}
      {error && (
        <p role="alert" style={{ margin: 0, fontSize: '14px', color: '#8E1B47', fontWeight: 600 }}>
          {error}
        </p>
      )}
    </Modal>
  )
}

function Skeleton({ h }: { h: number }) {
  return <div aria-hidden="true" style={{ height: `${h}px`, borderRadius: '14px', background: '#ECE7F0' }} />
}

export default function MisRastros() {
  const { authenticated, ready } = usePrivy()
  const { email } = useCurrentUser()
  const { donations, invoices, loading, error } = useMyDonations()
  const [params, setParams] = useSearchParams()
  const [panelOpen, setPanelOpen] = useState(false)

  const selected = donations.find((d) => d.id === params.get('donacion')) ?? donations[0] ?? null

  // Refunded donations no longer count as delivered or in custody: the donor got 100% back.
  const allTranches = donations.filter((d) => d.status !== 'refunded').flatMap((d) => d.tranches ?? [])
  const sum = (states: string[]) => allTranches.filter((t) => states.includes(t.state)).reduce((s, t) => s + t.amount, 0)
  const delivered = sum(['released'])
  const custody = sum(['in_custody', 'in_review'])

  const selDelivered = selected ? (selected.tranches ?? []).filter((t) => t.state === 'released').reduce((s, t) => s + t.amount, 0) : 0
  const selCustody = selected ? (selected.tranches ?? []).filter((t) => t.state === 'in_custody' || t.state === 'in_review').reduce((s, t) => s + t.amount, 0) : 0
  const refund = selected?.refunds?.[0]

  const showSkeleton = authenticated && loading

  return (
    <PageShell minHeight={1000}>
      <DonorHeader active="mis-rastros" />
      {ready && !authenticated ? (
        <SignInPrompt message="Inicia sesión para seguir tus donaciones." />
      ) : (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '36px 24px 64px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: '16px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <h1 style={{ margin: 0, fontSize: '44px', fontWeight: 800, letterSpacing: '-1.5px' }}>Mis rastros</h1>
              <p style={{ margin: 0, fontSize: '17px', color: '#5A5468' }}>Sigue tu donación hasta el último recibo.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(150px, 1fr))', gap: '12px', alignItems: 'stretch' }}>
              <StatCard label="Entregado" value={formatUSDT(delivered)} padding="12px 18px" labelSize={12} valueSize={22} gap="0" />
              <StatCard label="En custodia" value={formatUSDT(custody)} variant="dashed" padding="12px 18px" labelSize={12} valueSize={22} gap="0" />
            </div>
          </div>

          {error && !donations.length && (
            <p role="alert" style={{ margin: 0, color: '#8E1B47', fontWeight: 600 }}>
              No pudimos cargar tus donaciones. Intenta de nuevo en unos segundos.
            </p>
          )}

          {showSkeleton ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <Skeleton h={76} />
                <Skeleton h={76} />
                <Skeleton h={76} />
              </div>
              <div style={{ flex: '999 1 560px', minWidth: 0 }}>
                <Skeleton h={420} />
              </div>
            </div>
          ) : !loading && donations.length === 0 && !error ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '56px 0', textAlign: 'center' }}>
              <div style={{ display: 'flex', gap: '12px' }}>
                <TramoIcon state="in_custody" />
                <TramoIcon state="in_custody" />
                <TramoIcon state="in_custody" />
              </div>
              <p style={{ margin: 0, fontSize: '18px', color: '#5A5468' }}>Aún no has dejado rastro.</p>
              <PrimaryButton to="/">Elegir una fundación</PrimaryButton>
            </div>
          ) : (
            selected && (
              <>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '24px', alignItems: 'flex-start' }}>
                  <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    {donations.map((d) => {
                      const on = d.id === selected.id
                      const st = statusLine(d)
                      return (
                        <button
                          key={d.id}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setParams({ donacion: d.id }, { replace: true })}
                          style={{
                            textAlign: 'left',
                            width: '100%',
                            fontFamily: 'inherit',
                            color: '#1B1530',
                            background: '#FFFFFF',
                            border: `1.5px solid ${on ? '#1B1530' : '#DAD4CF'}`,
                            boxShadow: on ? 'inset 0 0 0 0.5px #1B1530' : 'none',
                            borderRadius: '14px',
                            padding: '16px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '6px',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                            <strong style={{ fontSize: '16px' }}>{d.foundation?.name ?? 'Fundación'}</strong>
                            <span style={{ ...MONO, fontWeight: 600 }}>{formatUSDT(d.total_amount)}</span>
                          </div>
                          <span style={{ fontSize: '13px', color: st.color, fontWeight: st.weight }}>{st.text}</span>
                        </button>
                      )
                    })}
                  </div>
                  <section style={{ flex: '999 1 560px', minWidth: 0, background: '#FFFFFF', border: '1.5px solid #DAD4CF', borderRadius: '20px', padding: '28px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <span style={{ ...MONO, fontSize: '12px', letterSpacing: '1.2px', color: '#5A5468' }}>
                          DONASTE A {(selected.foundation?.name ?? 'FUNDACIÓN').toUpperCase()}
                        </span>
                        <span style={{ ...MONO, fontSize: '52px', fontWeight: 600, lineHeight: 1, letterSpacing: '-2px' }}>{formatUSDT(selected.total_amount)}</span>
                      </div>
                      <span style={{ fontSize: '15px', color: '#5A5468' }}>
                        <strong style={{ color: '#1B1530' }}>{formatUSDTCompact(selDelivered)}</strong> entregados ·{' '}
                        <strong style={{ color: '#1B1530' }}>{formatUSDTCompact(selCustody)}</strong> en custodia
                      </span>
                    </div>
                    <TramoTimeline steps={buildSteps(selected, invoices)} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', paddingTop: '20px', borderTop: '1.5px dashed #DAD4CF' }}>
                      <SecondaryButton onClick={() => setPanelOpen(true)} padding="0 20px">
                        Ver facturas selladas
                      </SecondaryButton>
                      {selected.foundation?.contract_address && (
                        <SecondaryButton href={explorerAddress(selected.foundation.contract_address)} padding="0 20px">
                          Ver contrato en Trush Network ↗
                        </SecondaryButton>
                      )}
                      {refund && (
                        <SecondaryButton to={`/mis-rastros/reembolso/${selected.id}`} padding="0 20px">
                          Ver detalle del reembolso
                        </SecondaryButton>
                      )}
                    </div>
                  </section>
                </div>
                {refund && (
                  <div style={{ maxWidth: '827px', display: 'flex' }}>
                    <RefundCard donation={selected} refund={refund} email={email} />
                  </div>
                )}
                <Link to="/explorar" style={{ alignSelf: 'flex-start', fontSize: '15px', textDecoration: 'none' }}>
                  Seguir explorando fundaciones →
                </Link>
              </>
            )
          )}
        </div>
      )}
      {panelOpen && selected && <InvoicesPanel donation={selected} invoices={invoices} onClose={() => setPanelOpen(false)} />}
    </PageShell>
  )
}
