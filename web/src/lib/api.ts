import { env } from './env'
import type { AgentCheck, Donation, Foundation, FoundationTrace, FundsView, Invoice, OwnInvoice, OwnProfile, User } from '../types'

/** Quick top-up amounts (USD) offered in the top-up modal. */
export const TOPUP_PRESETS = [50, 100, 500] as const

/** Maximum simulated balance per user (USD); enforced by `wallet_top_up` (server side). */
export const BALANCE_CAP = 10000

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

interface ErrorBody {
  error?: string
  message?: string
}

/** Calls an Edge Function. `token` is the Privy access token; pass null for public endpoints. */
export async function callFn<T>(name: string, token: string | null, body: object): Promise<T> {
  const res = await fetch(`${env.supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: env.supabasePublishableKey,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const data: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const err = (data ?? {}) as ErrorBody
    throw new ApiError(res.status, err.error ?? 'unknown_error', err.message ?? `Error ${res.status}`)
  }
  return data as T
}

export interface ReleaseInfo {
  status: 'released' | 'pending'
  tx_hash?: string
  released?: number
  error?: string
}

export interface DonateResult {
  donation: Donation
  balance: number
  release: ReleaseInfo
}

export const syncUser = (token: string, walletAddress: string, email: string | null) =>
  callFn<{ user: User }>('sync-user', token, { wallet_address: walletAddress, email })

export const topUp = (token: string, amount: number) => callFn<{ balance: number }>('wallet-topup', token, { amount })

export const donate = (token: string, foundationId: string, amount: number) =>
  callFn<DonateResult>('donate', token, { foundation_id: foundationId, amount })

export const releaseInitial = (token: string, donationId: string) =>
  callFn<ReleaseInfo>('release-initial', token, { donation_id: donationId })

/** `invoices` are the invoices referenced by the donor's tranche uses and refunds (only for scope 'donor'). */
export const listDonations = (token: string, scope: 'donor' | 'foundation') =>
  callFn<{ donations: Donation[]; invoices?: Invoice[] }>('my-donations', token, { scope })

/** Public: the full traceability of a foundation's funds. No login, no donor identity. */
export const foundationTrace = (foundationId: string) => callFn<FoundationTrace>('foundation-trace', null, { foundation_id: foundationId })

/** 60 s signed URL of a document. Verified invoice documents are public; the rest need the owner's or auditor's token. */
export const documentUrl = (invoiceId: string, kind: 'invoice' | 'origin' | 'destination', index: number, token: string | null) =>
  callFn<{ url: string }>('document-url', token, { invoice_id: invoiceId, kind, index })

export interface ReportSpendInput {
  /** 3 to 80 characters. Omit it and the verification agent extracts it from the invoice. */
  concept?: string
  amount: number
  supplier_rif: string
  file_paths: string[]
  file_hash: string | null
  file_hashes: string[]
}

/** Reports a spend. The server validates it against the foundation's available balance. */
export const reportSpend = (token: string, input: ReportSpendInput) =>
  callFn<{ invoice: { id: string; number: string } }>('report-spend', token, input)

export interface RegisterFoundationInput {
  name: string
  description?: string
  category?: string
  rif?: string
  country?: string
  city?: string
  official_email?: string
  /** Payout wallet (defaults to the user's wallet when omitted). */
  wallet_address?: string
  logo_url?: string
  instagram_url?: string
  tiktok_url?: string
  x_url?: string
  legal_doc_path?: string
  legal_doc_hash?: string
}

export const registerFoundation = (token: string, input: RegisterFoundationInput) =>
  callFn<{ foundation: Foundation }>('register-foundation', token, input)

export interface ValidateRegistrationInput {
  /** Intake path (bucket `rif-docs`) of a freshly uploaded RIF document; omit to re-run on the stored one. */
  rif_doc_path?: string
  /** Optional corrections, applied only while the registration is pending/rejected. */
  rif?: string
  name?: string
}

export interface ValidateRegistrationResult {
  /** `active` = accepted; `rejected` = the auditor rejected it; `pending` is never returned (errors are thrown). */
  status: 'active' | 'rejected'
  checks: AgentCheck[]
  reason: string | null
  email: 'sent' | 'failed' | 'skipped' | 'none'
}

/** Runs the AI auditor on the caller's RIF document. Throws ApiError (502/504 = model failed, still pending). */
export const validateRegistration = (token: string, input: ValidateRegistrationInput) =>
  callFn<ValidateRegistrationResult>('validate-registration', token, input)

/** What happened to the tranches of a verified spend: paid, nothing to pay, or the on-chain send must be retried. */
export type SpendReleaseInfo =
  | { status: 'released'; tx_hash?: string; released_count: number; released_usd: number }
  | { status: 'none'; released_count: 0; released_usd: 0 }
  | { status: 'pending'; error: string; message: string }

/** Facts the agent read from the invoice files (empty strings / 0 when it could not read them). */
export interface ExtractedInvoice {
  number: string
  issue_date: string
  supplier_name: string
  supplier_rif: string
  total_usd: number
  concept: string
  items_summary: string
}

export interface VerifySpendResult {
  /** `needs_changes`: a check failed but attempts are left; the spend stays open so the documents can be corrected. */
  status: 'verified' | 'rejected' | 'needs_changes'
  checks: AgentCheck[]
  review_note: string
  /** Absent only on the release-only retry of an already verified spend (no model call). */
  invoice?: ExtractedInvoice
  /** Present when status = 'verified'. */
  release?: SpendReleaseInfo
  /** Present when status = 'verified': the part of the spend attributed to donor contributions. */
  allocated_usd?: number
  /** Present when status = 'rejected': the foundation was frozen and the donors refunded 100%. */
  refund?: { refunds: number; refunded_usd: number; foundation_status: 'frozen' }
  /** Present when status = 'needs_changes'. */
  attempts?: number
  max_attempts?: number
  evidence_due_at?: string | null
}

export interface VerifySpendInput {
  invoice_id: string
  /** Paths issued by upload-url. Omit a document to keep the one stored from the previous attempt. */
  origin_path?: string
  destination_path?: string
  invoice_paths?: string[]
  file_hash?: string | null
  file_hashes?: string[]
}

/** Runs the AI + registry verification of the spend documents (origin proof, destination business doc, invoice files). */
export const verifySpend = (token: string, input: VerifySpendInput) => callFn<VerifySpendResult>('verify-spend', token, input)

// ---- Foundation owner tools ----------------------------------------------------------------------------------

export type UploadKind = 'invoice' | 'spend_origin' | 'spend_destination' | 'appeal' | 'logo'

/** Asks the server for a signed upload URL under the caller's foundation folder. */
export const uploadUrl = (token: string, kind: UploadKind, ext: string) =>
  callFn<{ bucket: string; path: string; token: string }>('upload-url', token, { kind, ext })

export const foundationMe = (token: string) => callFn<OwnProfile>('foundation-me', token, {})

export const foundationFunds = (token: string) => callFn<FundsView>('foundation-funds', token, {})

export const foundationInvoices = (token: string) => callFn<{ invoices: OwnInvoice[]; max_attempts: number }>('foundation-invoices', token, {})

export interface UpdateProfileInput {
  description?: string
  category?: string
  country?: string
  city?: string
  instagram_url?: string
  tiktok_url?: string
  x_url?: string
  logo_path?: string
  wallet_address?: string
}

export const updateProfile = (token: string, input: UpdateProfileInput) => callFn<{ foundation: Foundation }>('update-profile', token, input)

export const submitAppeal = (token: string, reason: string, evidencePaths: string[]) =>
  callFn<{ appeal: { id: string; status: string; created_at: string }; message: string }>('submit-appeal', token, { reason, evidence_paths: evidencePaths })

export const claimFoundation = (token: string, code: string) => callFn<{ foundation_id: string; name: string }>('claim-foundation', token, { code })
