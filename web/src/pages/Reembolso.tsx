import { useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'
import DonorHeader from '../components/DonorHeader'
import InvoiceReportModal from '../components/InvoiceReportModal'
import PageShell, { Notice } from '../components/PageShell'
import RefundCard from '../components/RefundCard'
import SignInPrompt from '../components/SignInPrompt'
import TramoIcon from '../components/TramoIcon'
import { PrimaryButton, SecondaryButton } from '../components/Buttons'
import { useCurrentUser } from '../hooks/useCurrentUser'
import { useMyDonations } from '../hooks/useMyDonations'

export default function Reembolso() {
  const { donationId } = useParams()
  const { ready, authenticated } = usePrivy()
  const { email } = useCurrentUser()
  const { donations, invoices, loading, error } = useMyDonations()
  const [report, setReport] = useState(false)

  if (ready && !authenticated) {
    return (
      <PageShell minHeight={900}>
        <DonorHeader active="mis-rastros" />
        <SignInPrompt message="Inicia sesión para ver tu reembolso." />
      </PageShell>
    )
  }
  if (loading) {
    return (
      <PageShell minHeight={900}>
        <DonorHeader active="mis-rastros" />
        <Notice>Cargando tu reembolso…</Notice>
      </PageShell>
    )
  }
  const donation = donations.find((d) => d.id === donationId)
  const refund = donation?.refunds?.[0]
  if (error && !donation) {
    return (
      <PageShell minHeight={900}>
        <DonorHeader active="mis-rastros" />
        <Notice title="No pudimos cargar tu reembolso">Intenta de nuevo en unos segundos.</Notice>
      </PageShell>
    )
  }
  // A donation without a refund has nothing to show here.
  if (!donation || !refund) return <Navigate to={donationId ? `/mis-rastros?donacion=${donationId}` : '/mis-rastros'} replace />

  const invoice = refund.invoice_id ? invoices[refund.invoice_id] : undefined
  const foundationName = donation.foundation?.name ?? 'la fundación'
  const reason = refund.reason ?? invoice?.review_note ?? 'El agente auditor encontró una inconsistencia en la factura.'

  return (
    <PageShell minHeight={900}>
      <DonorHeader active="mis-rastros" />
      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 24px 64px', display: 'flex', flexWrap: 'wrap', gap: '40px', alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 420px', display: 'flex', flexDirection: 'column', gap: '18px' }}>
          <TramoIcon state="broken" size={88} />
          <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', letterSpacing: '1.2px', color: '#B4235A', fontWeight: 600 }}>
            SELLO ROTO · {foundationName.toUpperCase()}
          </span>
          <h1 style={{ margin: 0, fontSize: 'clamp(40px, 5vw, 64px)', lineHeight: 0.95, fontWeight: 800, letterSpacing: '-2.5px' }}>
            Tu dinero
            <br />
            vuelve a ti.
          </h1>
          <p style={{ margin: 0, fontSize: '18px', lineHeight: 1.5, color: '#5A5468', maxWidth: '480px' }}>
            El agente auditor encontró un problema: {reason} La fundación quedó congelada y tu saldo en custodia regresó a tu billetera.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
            <PrimaryButton to="/" minHeight={52} padding="0 22px">
              Donar a otra fundación
            </PrimaryButton>
            {invoice && (
              <SecondaryButton onClick={() => setReport(true)} minHeight={52} padding="0 22px">
                Ver informe de auditoría
              </SecondaryButton>
            )}
          </div>
        </div>
        <RefundCard donation={donation} refund={refund} email={email} />
      </div>
      {report && invoice && <InvoiceReportModal invoice={invoice} onClose={() => setReport(false)} />}
    </PageShell>
  )
}
