export type UserRole = 'donor' | 'ong' | 'auditor'
/** `ong` in the app = foundation in the product copy. */
/** `active` = accepted/validated by the registration auditor; `rejected` = registration rejected (can be resubmitted). */
export type FoundationStatus = 'active' | 'pending' | 'frozen' | 'rejected'
export type DonationStatus = 'in_escrow' | 'partially_released' | 'completed' | 'refunded'
export type VerificationStatus = 'pending' | 'approved' | 'rejected'
/**
 * released   sent to the foundation (spendable: see `remaining`)
 * in_review  unlock condition met, transfer in progress
 * in_custody still held by the platform
 * broken     never released (refund)
 */
export type TrancheState = 'released' | 'in_review' | 'in_custody' | 'broken'
export type InvoiceStatus = 'in_review' | 'verified' | 'rejected'
/**
 * sin_historial    never took part in a fundraising: there is no information, NOT a bad sign
 * en_construccion  has history, no incidents, reputation below 70
 * confiable        reputation 70+ and no incidents
 * inconfiable      frozen, or at least one rejected / flagged invoice
 */
export type ReputationState = 'sin_historial' | 'en_construccion' | 'confiable' | 'inconfiable'

export interface User {
  id: string
  privy_id: string | null
  wallet_address: string
  email: string | null
  role: UserRole
  balance: number
  created_at: string
}

/** Public columns of `foundations` (official_email and the legal documents are private). */
export interface Foundation {
  id: string
  user_id: string | null
  name: string
  description: string | null
  category: string | null
  logo_url: string | null
  wallet_address: string
  /** 0-100. Level (1-5) and payout_percentage are derived from it by a database trigger. */
  reputation_score: number
  level: number
  payout_percentage: number
  status: FoundationStatus
  total_received: number
  created_at: string
  rif: string | null
  country: string | null
  city: string | null
  instagram_url: string | null
  tiktok_url: string | null
  x_url: string | null
  contract_address: string | null
  /** Auditor's reason when status = 'rejected' (only the owner can read it). */
  rejection_reason?: string | null
}

/** Row of the `foundation_stats` view (no donor identity). */
export interface FoundationStats {
  foundation_id: string
  sealed_invoices_count: number
  flagged_invoices_count: number
  rejected_invoices_count: number
  /** Open spends that passed their 7-day evidence deadline without backing. */
  overdue_invoices_count?: number
  donations_count: number
  /** Money already sent to the foundation. */
  released_total: number
  /** Money still held by the platform. */
  custody_total: number
  /** Money spent with verified invoices. */
  spent_total: number
  /** Sent to the foundation and not spent yet: the most it can report as spend. */
  available_balance: number
  affected_donors: number
  reputation_state: ReputationState
}

/** Piece of a tranche consumed by a verified spend. */
export interface TrancheUse {
  id: string
  tranche_id: string
  invoice_id: string
  amount: number
  created_at: string
}

export interface Tranche {
  id: string
  donation_id: string
  index: number
  amount: number
  state: TrancheState
  /** Spendable balance (only released tranches have one). */
  remaining: number
  /** The invoice whose verification unlocked this tranche (null for tranche 1). */
  invoice_id: string | null
  tx_hash: string | null
  released_at: string | null
  uses?: TrancheUse[]
}

export interface AgentCheck {
  id: string
  label: string
  passed: boolean
  /** Hidden in the public views. */
  detail?: string
}

export interface Invoice {
  id: string
  foundation_id: string
  number: string
  concept: string
  amount: number
  supplier_rif: string
  supplier_name?: string | null
  /** Legacy: the foundation no longer picks a tranche. */
  tranche_index?: number | null
  /** How many documents the invoice has (paths stay on the server). */
  document_count: number
  file_hash: string | null
  file_hashes: string[]
  /** On-chain transfer that unlocked tranches for this invoice (null until sent or when nothing unlocked). */
  release_tx_hash?: string | null
  /** Part of the amount attributed to donor contributions. */
  allocated_amount?: number
  status: InvoiceStatus
  agent_checks: AgentCheck[]
  review_note: string | null
  uploaded_at: string
  reviewed_at: string | null
  /** Failed verification attempts (the spend stays open between them). */
  attempts?: number
  last_attempt_at?: string | null
  /** Deadline to back the spend with valid documents; null for spends that predate the rule. */
  evidence_due_at?: string | null
  /** Set when the spend stayed open past its deadline: the foundation is flagged as untrustworthy. */
  suspicious_at?: string | null
}

export interface Refund {
  id: string
  donation_id: string
  invoice_id: string | null
  amount: number
  tx_hash: string | null
  reason: string | null
  email_sent_at: string | null
  created_at: string
}

export interface Donation {
  id: string
  donor_id: string | null
  foundation_id: string
  total_amount: number
  amount_released: number
  amount_refunded: number
  currency: string
  status: DonationStatus
  initial_pct: number | null
  tranche_count?: number
  deposit_tx_hash: string | null
  release_tx_hash: string | null
  created_at: string
  foundation?: Foundation
  tranches?: Tranche[]
  refunds?: Refund[]
  /** Alias shown to the receiving foundation instead of the donor's identity. */
  donor_label?: string
}

export interface Verification {
  id: string
  donation_id: string
  foundation_id: string
  invoice_url: string
  provider_rif: string
  provider_name: string | null
  amount_spent: number | null
  status: VerificationStatus
  auditor_notes: string | null
  ai_confidence: number | null
  release_tx_hash: string | null
  refund_tx_hash: string | null
  onchain_tx_hash: string | null
  created_at: string
  reviewed_at: string | null
}

// ---- Public traceability (foundation-trace Edge Function) ----------------------------------------------------

/** A piece of a verified spend and the contribution that financed it (pseudonymous). */
export interface FundedBy {
  contribution: string
  donated_at: string
  tranche_index: number
  amount: number
}

export interface TraceInvoice extends Invoice {
  funded_by: FundedBy[]
}

export interface TraceTranche {
  index: number
  amount: number
  state: TrancheState
  remaining: number
  released_at: string | null
  tx_hash: string | null
  uses: { invoice_id: string; number: string | null; concept: string | null; amount: number }[]
}

export interface TraceContribution {
  ref: string
  donated_at: string
  total: number
  status: DonationStatus
  initial_pct: number | null
  tranche_count: number
  tranches: TraceTranche[]
}

export interface FoundationTrace {
  foundation: Foundation
  stats: FoundationStats | null
  invoices: TraceInvoice[]
  contributions: TraceContribution[]
}

// ---- Foundation owner tools (foundation-me / foundation-funds / foundation-invoices Edge Functions) ---------------

export type AppealStatus = 'received' | 'in_review' | 'accepted' | 'rejected'

export interface Appeal {
  id: string
  reason: string
  status: AppealStatus
  created_at: string
  evidence_count: number
}

/** Private view of the owner's own foundation (adds the official e-mail and whether a legal document is on file). */
export interface OwnFoundation extends Foundation {
  official_email: string | null
  has_legal_doc: boolean
  rejection_reason: string | null
}

export interface OwnProfile {
  foundation: OwnFoundation
  stats: FoundationStats | null
  appeals: Appeal[]
  can_appeal: boolean
}

export interface OwnInvoice extends Invoice {
  has_origin_doc: boolean
  has_destination_doc: boolean
}

export interface FundsMilestone {
  contribution: string
  unlock_tranche: number
  unlock_amount: number
  /** Lower bound of what the foundation still has to spend for this unlock to happen. */
  spend_needed: number
  used_pct: number
}

export interface FundsContribution {
  ref: string
  donor_label: string
  donated_at: string
  total: number
  status: DonationStatus
  initial_pct: number | null
  tranche_count: number
  tranches: (Omit<TraceTranche, 'uses'> & { uses: { invoice_id: string; number: string | null; concept: string | null; amount: number; date: string }[] })[]
}

export interface FundsView {
  summary: Partial<FoundationStats> & { received_total: number; contributions_count: number }
  milestones: FundsMilestone[]
  contributions: FundsContribution[]
}
