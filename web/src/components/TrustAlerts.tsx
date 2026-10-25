import { formatUSDT } from '../lib/format'
import type { Foundation, FoundationStats, TraceInvoice } from '../types'

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** One alert per incident, in the same terms the database uses to decide that a foundation is untrustworthy. */
function incidentsOf(foundation: Foundation, stats: FoundationStats, invoices: TraceInvoice[] | undefined): string[] {
  const alerts: string[] = []
  if (foundation.status === 'frozen') alerts.push('La fundación está congelada por una auditoría y no recibe donaciones.')

  if (invoices) {
    for (const inv of invoices) {
      const failed = inv.agent_checks.filter((c) => !c.passed).map((c) => c.label)
      if (inv.status === 'rejected') {
        alerts.push(`Gasto rechazado: ${inv.concept}, factura ${inv.number} (${formatUSDT(inv.amount)}).`)
      } else if (inv.status === 'in_review' && inv.suspicious_at) {
        alerts.push(`Gasto sin respaldo después de 7 días: ${inv.concept}, factura ${inv.number} (${formatUSDT(inv.amount)}).`)
      } else if (inv.status === 'verified' && failed.length > 0) {
        alerts.push(`Observaciones en ${inv.concept}, factura ${inv.number} (${formatUSDT(inv.amount)}). No se cumplió: ${failed.join('; ')}.`)
      }
    }
    return alerts
  }

  // The detail has not loaded yet: fall back to the counters of the stats view.
  const rejected = stats.rejected_invoices_count
  const flagged = stats.flagged_invoices_count
  if (rejected > 0) alerts.push(`${rejected} ${plural(rejected, 'gasto rechazado', 'gastos rechazados')} por el agente auditor.`)
  const overdue = stats.overdue_invoices_count ?? 0
  if (overdue > 0) alerts.push(`${overdue} ${plural(overdue, 'gasto abierto', 'gastos abiertos')} sin respaldo después de 7 días.`)
  if (flagged > 0) alerts.push(`${flagged} ${plural(flagged, 'factura verificada', 'facturas verificadas')} con observaciones del agente.`)
  return alerts
}

/**
 * Alerts of an untrustworthy foundation. A foundation is "inconfiable" when it is frozen, has a rejected invoice, or has
 * a verified invoice with observations, so every one of those is an alert. Renders nothing for any other state:
 * a foundation without history is not an alert.
 */
export default function TrustAlerts({ foundation, stats, invoices }: { foundation: Foundation; stats: FoundationStats; invoices?: TraceInvoice[] }) {
  if (stats.reputation_state !== 'inconfiable') return null

  const incidents = incidentsOf(foundation, stats, invoices)
  const total = incidents.length

  return (
    <div role="alert" style={{ border: '1.5px solid #B4235A', background: '#F8E9EF', borderRadius: '14px', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#B4235A" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true" style={{ flexShrink: 0 }}>
          <path d="M12 3 2.5 20h19z" strokeLinejoin="round" />
          <path d="M12 10v4" />
          <path d="M12 17h.01" />
        </svg>
        <strong style={{ fontSize: '17px', color: '#8E1B47' }}>
          {total} {plural(total, 'alerta de confianza', 'alertas de confianza')}
        </strong>
      </div>
      <ul style={{ margin: 0, paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '4px', fontSize: '14px', lineHeight: 1.45, color: '#1B1530' }}>
        {incidents.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      <p style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#8E1B47' }}>
        Por estas alertas su nivel bajó a 1 y su reputación a {foundation.reputation_score}%.
      </p>
      <a href="#rastro" style={{ fontSize: '14px', fontWeight: 600, color: '#8E1B47' }}>
        Revisa el rastro público antes de donar ↓
      </a>
    </div>
  )
}
