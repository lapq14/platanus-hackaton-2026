export type UserRole = 'donor' | 'ong' | 'auditor'
export type FoundationStatus = 'active' | 'suspended' | 'under_review'
export type DonationStatus = 'in_escrow' | 'partially_released' | 'completed' | 'refunded'
export type VerificationStatus = 'pending' | 'approved' | 'rejected'

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
  reputation_score: number
  payout_percentage: number
  status: FoundationStatus
  total_received: number
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
  deposit_tx_hash: string | null
  release_tx_hash: string | null
  created_at: string
  foundation?: Foundation
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
