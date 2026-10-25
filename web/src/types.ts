export type UserRole = 'donor' | 'ong' | 'auditor'
/** `ong` in the app = foundation in the product copy. */
/** `active` = accepted/validated by the registration auditor; `rejected` = registration rejected (can be resubmitted). */
export type FoundationStatus = 'active' | 'pending' | 'frozen' | 'rejected'
export type DonationStatus = 'in_escrow' | 'partially_released' | 'completed' | 'refunded'
export type VerificationStatus = 'pending' | 'approved' | 'rejected'
export type TrancheState = 'released' | 'in_review' | 'in_custody' | 'broken'
export type InvoiceStatus = 'in_review' | 'verified' | 'rejected'

export interface User {
  id: string
  privy_id: string | null
  wallet_address: string
  email: string | null
  role: UserRole
  balance: number
  created_at: string
}

export interface Foundation {
  id: string
  user_id: string | null
  name: string
  description: string | null
  category: string | null
  logo_url: string | null
  wallet_address: string
  /** 0-100. Level (1-4) and payout_percentage are derived from it by a database trigger. */
  reputation_score: number
  level: number
  payout_percentage: number
  status: FoundationStatus
  total_received: number
  created_at: string
  rif: string | null
  country: string | null
  city: string | null
  official_email: string | null
  instagram_url: string | null
  tiktok_url: string | null
  x_url: string | null
  contract_address: string | null
  legal_doc_path: string | null
  legal_doc_hash: string | null
  /** Auditor's reason when status = 'rejected'. */
  rejection_reason?: string | null
}

/** Row of the `foundation_stats` view (no donor identity). */
export interface FoundationStats {
  foundation_id: string
  sealed_invoices_count: number
  flagged_invoices_count: number
  released_total: number
  custody_total: number
  next_tranche_total: number
  next_tranche_index: number | null
  affected_donors: number
}

export interface Tranche {
  id: string
  donation_id: string
  index: number
  amount: number
  state: TrancheState
  invoice_id: string | null
  tx_hash: string | null
  released_at: string | null
}

export interface AgentCheck {
  id: string
  label: string
  passed: boolean
  detail: string
}

export interface Invoice {
  id: string
  foundation_id: string
  number: string
  concept: string
  amount: number
  supplier_rif: string
  tranche_index: number | null
  file_path: string | null
  file_paths: string[]
  file_hash: string | null
  file_hashes: string[]
  /** On-chain transfer that released the invoice's tranches (null until the release is sent). */
  release_tx_hash?: string | null
  status: InvoiceStatus
  agent_checks: AgentCheck[]
  review_note: string | null
  reviewer_id: string | null
  uploaded_at: string
  reviewed_at: string | null
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
