import { useState, type CSSProperties } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import DocumentViewer from '../components/DocumentViewer'
import DonorHeader from '../components/DonorHeader'
import Modal from '../components/Modal'
import PageShell from '../components/PageShell'
import RefundCard from '../components/RefundCard'
import SignInPrompt from '../components/SignInPrompt'
import StatCard from '../components/StatCard'
import TramoIcon from '../components/TramoIcon'
import TramoTimeline, { type StepUse, type TimelineStep } from '../components/TramoTimeline'
import { PrimaryButton, SecondaryButton } from '../components/Buttons'
import { LEVEL_RELEASE, UNLOCK_THRESHOLD_PCT, toLevel } from '../config/levels'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { useMyDonations } from '../hooks/useMyDonations'
import { explorerAddress } from '../lib/chain'
import { formatDate, formatUSDT, formatUSDTCompact, shortHash } from '../lib/format'
import type { Donation, Invoice, Tranche } from '../types'

const MONO: CSSProperties = { fontFamily: "'IBM Plex Mono', monospace" }

const tranchesOf = (d: Donation): Tranche[] => d.tranches ?? []
const usedOf = (t: Tranche): number => (t.uses ?? []).reduce((s, u) => s + u.amount, 0)

/** One-line status of a donation for the list. */
function statusLine(d: Donation): { text: string; color: string; weight: number } {
  const tranches = tranchesOf(d)
  if (d.status === 'refunded' || tranches.some((t) => t.state === 'broken')) {
    const refunded = d.refunds?.[0]?.amount ?? d.amount_refunded
    return { text: `Sello roto · ${formatUSDT(refunded)} devueltos`, color: '#B4235A', weight: 600 }
  }
  const pending = tranches.find((t) => t.state !== 'released')
  if (!pending) return { text: `Todos los tramos entregados · ${tranches.length} de ${tranches.length}`, color: '#1A7F52', weight: 600 }
  return {
    text: pending.state === 'in_review' ? `Tramo ${pending.index} desbloqueándose` : `Tramo ${pending.index} en custodia`,
    color: '#5A5468',
    weight: 400,
  }
}

/** "Insumos médicos · Factura N° 000204 · Farmacia San Rafael" */
function useLabel(inv: Invoice | undefined): string {
  if (!inv) return 'Gasto verificado'
  return `${inv.concept} · Factura ${inv.number}${inv.supplier_name ? ` · ${inv.supplier_name}` : ''}`
}

function buildSteps(d: Donation, invoices: Record<string, Invoice>): TimelineStep[] {
  const tranches = tranchesOf(d)
  const level = toLevel(d.foundation?.level ?? 1)
  const pct = d.initial_pct ?? LEVEL_RELEASE[level]
  return tranches.map<TimelineStep>((t, pos) => {
    const prefix = `Tramo ${t.index} de ${tranches.length} · `
    switch (t.state) {
      case 'released': {
        const unlockInv = t.invoice_id ? invoices[t.invoice_id] : undefined
        const used = usedOf(t)
        const uses: StepUse[] = [...(t.uses ?? [])]
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .map((u) => ({ label: useLabel(invoices[u.invoice_id]), amount: u.amount, date: formatDate(u.created_at) }))
        const origin =
          t.index === 1
            ? `Entregado a la fundación al donar (${pct}% de tu aporte).`
            : unlockInv
              ? `Desbloqueado al verificarse «${unlockInv.concept}».`
              : 'Desbloqueado al verificarse un gasto.'
        const balance = t.remaining > 0 ? ` Disponible para gastar: ${formatUSDT(t.remaining)}.` : ' Usado por completo.'
        const next = tranches[pos + 1]
        const usedPct = t.amount > 0 ? (used / t.amount) * 100 : 0
        return {
          state: t.state,
          title: `${prefix}entregado`,
          amount: t.amount,
          description: origin + balance,
          date: t.released_at ? formatDate(t.released_at) : undefined,
          hash: t.tx_hash ?? undefined,
          uses,
          progress:
            next && next.state !== 'released' && next.state !== 'broken'
              ? {
                  usedPct,
                  thresholdPct: UNLOCK_THRESHOLD_PCT,
                  caption:
                    next.state === 'in_review'
                      ? `Se alcanzó el ${UNLOCK_THRESHOLD_PCT}% usado: el tramo ${next.index} se está desbloqueando.`
                      : `Usado ${Math.round(usedPct)}%. Al llegar al ${UNLOCK_THRESHOLD_PCT}% se desbloquea el tramo ${next.index}.`,
                }
              : undefined,
        }
      }
      case 'in_review':
        return { state: t.state, title: `${prefix}desbloqueándose`, amount: t.amount, description: 'Se cumplió la condición de uso. La transferencia a la fundación está en proceso.' }
      case 'broken':
        return { state: t.state, title: `${prefix}sello roto`, amount: t.amount, description: 'No se liberó: tu donación fue reembolsada a tu saldo.' }
      case 'in_custody':
        return {
          state: t.state,
          title: `${prefix}en custodia`,
          amount: t.amount,
          description: t.index > 1 ? `Se libera cuando el tramo ${t.index - 1} se use al ${UNLOCK_THRESHOLD_PCT}%.` : 'La entrega inicial está en proceso.',
        }
    }
  })
}

/** Verified expenses that were paid with this donation, with the part that came from it. */
function InvoicesPanel({ donation, invoices, onClose }: { donation: Donation; invoices: Record<string, Invoice>; onClose: () => void }) {
  const [viewing, setViewing] = useState<Invoice | null>(null)
  const byInvoice = new Map<string, number>()
  for (const t of tranchesOf(donation)) for (const u of t.uses ?? []) byInvoice.set(u.invoice_id, (byInvoice.get(u.invoice_id) ?? 0) + u.amount)
  const rows = [...byInvoice.entries()]
    .map(([id, mine]) => ({ inv: invoices[id], mine }))
    .filter((r): r is { inv: Invoice; mine: number } => !!r.inv && r.inv.status === 'verified')

  return (
    <>
      <Modal title="Facturas que usaron tu aporte" onClose={onClose} maxWidth={600}>
        {rows.length === 0 ? (
          <p style={{ margin: 0, color: '#5A5468' }}>Aún no se usó dinero de esta donación en gastos verificados.</p>
        ) : (
          rows.map(({ inv, mine }) => (
            <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', padding: '12px 0', borderTop: '1px solid #ECE7F0' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: 0 }}>
                <strong style={{ fontSize: '15px' }}>{inv.concept}</strong>
                <span style={{ ...MONO, fontSize: '12px', color: '#5A5468' }}>
                  {inv.number} · {inv.supplier_name ?? inv.supplier_rif} · {formatUSDT(inv.amount)}
                </span>
                <span style={{ fontSize: '13px' }}>
                  De tu donación se usaron <strong>{formatUSDT(mine)}</strong>
                </span>
                {inv.file_hash && (
                  <span title="Huella SHA-256 del documento" style={{ ...MONO, fontSize: '12px', color: '#5A5468' }}>
                    huella {shortHash(inv.file_hash)}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setViewing(inv)}
                style={{ minHeight: '36px', padding: '0 12px', borderRadius: '10px', border: '1.5px solid #1B1530', background: '#FFFFFF', color: '#1B1530', fontFamily: 'inherit', fontSize: '13px', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}
              >
                Ver documentos
              </button>
            </div>
          ))
        )}
      </Modal>
      {viewing && <DocumentViewer invoice={viewing} onClose={() => setViewing(null)} />}
    </>
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
  const live = donations.filter((d) => d.status !== 'refunded').flatMap(tranchesOf)
  const sumAmount = (states: string[]) => live.filter((t) => states.includes(t.state)).reduce((s, t) => s + t.amount, 0)
  const delivered = sumAmount(['released'])
  const custody = sumAmount(['in_custody', 'in_review'])
  const used = live.reduce((s, t) => s + usedOf(t), 0)

  const selTranches = selected ? tranchesOf(selected) : []
  const selDelivered = selTranches.filter((t) => t.state === 'released').reduce((s, t) => s + t.amount, 0)
  const selCustody = selTranches.filter((t) => t.state === 'in_custody' || t.state === 'in_review').reduce((s, t) => s + t.amount, 0)
  const selUsed = selTranches.reduce((s, t) => s + usedOf(t), 0)
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
              <p style={{ margin: 0, fontSize: '17px', color: '#5A5468' }}>Sigue tu donación hasta saber en qué se usó cada parte.</p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(130px, 1fr))', gap: '12px', alignItems: 'stretch' }}>
              <StatCard label="Entregado" value={formatUSDT(delivered)} padding="12px 18px" labelSize={12} valueSize={22} gap="0" />
              <StatCard label="Ya usado" value={formatUSDT(used)} padding="12px 18px" labelSize={12} valueSize={22} gap="0" />
              <StatCard label="En custodia" value={formatUSDT(custody)} variant="dashed" padding="12px 18px" labelSize={12} valueSize={22} gap="0" />
            </div>
          </div>

          {error && !donations.length && (
            <p role="alert" style={{ margin: 0, color: '#8E1B47', fontWeight: 600 }}>
              {error}
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
                          <span style={{ fontSize: '12px', color: '#5A5468' }}>{formatDate(d.created_at)}</span>
                          <span style={{ fontSize: '13px', color: st.color, fontWeight: st.weight }}>{st.text}</span>
                        </button>
                      )
                    })}
                  </div>
                  <section style={{ flex: '999 1 560px', minWidth: 0, background: '#FFFFFF', border: '1.5px solid #DAD4CF', borderRadius: '20px', padding: '28px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: '12px' }}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        <span style={{ ...MONO, fontSize: '12px', letterSpacing: '1.2px', color: '#5A5468' }}>
                          DONASTE A {(selected.foundation?.name ?? 'FUNDACIÓN').toUpperCase()} · {formatDate(selected.created_at).toUpperCase()}
                        </span>
                        <span style={{ ...MONO, fontSize: '52px', fontWeight: 600, lineHeight: 1, letterSpacing: '-2px' }}>{formatUSDT(selected.total_amount)}</span>
                      </div>
                      <span style={{ fontSize: '15px', color: '#5A5468', textAlign: 'right' }}>
                        <strong style={{ color: '#1B1530' }}>{formatUSDTCompact(selDelivered)}</strong> entregados ·{' '}
                        <strong style={{ color: '#1B1530' }}>{formatUSDTCompact(selUsed)}</strong> ya usados ·{' '}
                        <strong style={{ color: '#1B1530' }}>{formatUSDTCompact(selCustody)}</strong> en custodia
                      </span>
                    </div>
                    <TramoTimeline steps={buildSteps(selected, invoices)} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', paddingTop: '20px', borderTop: '1.5px dashed #DAD4CF' }}>
                      <SecondaryButton onClick={() => setPanelOpen(true)} padding="0 20px">
                        Ver facturas de mi aporte
                      </SecondaryButton>
                      <SecondaryButton to={`/fundacion/${selected.foundation_id}#rastro`} padding="0 20px">
                        Ver el rastro público de la fundación
                      </SecondaryButton>
                      {selected.foundation?.contract_address && (
                        <SecondaryButton href={explorerAddress(selected.foundation.contract_address)} padding="0 20px">
                          Ver contrato ↗
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
