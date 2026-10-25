import type { Invoice } from '../types'

/**
 * Auditor actions. INTERFACE ONLY: nothing is executed yet; the console shows a
 * "pendiente de integrar" notice after the user confirms. Both functions are isolated on purpose so the
 * audit-agent phase can replace their bodies without touching the UI.
 */
export interface ActionResult {
  /** True while the real execution is not wired. */
  pending: true
}

/**
 * TODO fase agente: "Completar y liberar".
 *  1. contract.releaseTranche(donationId, invoiceHash) for every affected donation.
 *  2. invoices.status = 'verified', reviewed_at, reviewer_id.
 *  3. affected tranches -> 'released' with tx_hash / released_at.
 *  4. foundations.reputation_score++ (the DB trigger recalculates level and payout_percentage).
 *  5. insert an audit_events row (actor, action, entity, tx_hash).
 */
export async function approveInvoice(_invoice: Invoice): Promise<ActionResult> {
  return { pending: true }
}

/**
 * TODO fase agente: "Reportar y reembolsar".
 *  1. contract.freezeAndRefund(foundationId).
 *  2. invoices.status = 'rejected' + review_note = reason.
 *  3. foundations.status = 'frozen'.
 *  4. pending tranches -> 'broken'; insert refunds rows (this triggers the refund e-mail function).
 *  5. insert audit_events rows.
 */
export async function reportInvoice(_invoice: Invoice, _reason: string): Promise<ActionResult> {
  return { pending: true }
}
