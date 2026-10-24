import { env } from './env'
import type { Donation, Foundation, User } from '../types'

/** Quick top-up amounts (USD) offered in the top-up modal. */
export const TOPUP_PRESETS = [50, 100, 500] as const

/** Maximum simulated balance per user (USD); enforced by the database. */
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

export async function callFn<T>(name: string, token: string, body: object): Promise<T> {
  const res = await fetch(`${env.supabaseUrl}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      apikey: env.supabasePublishableKey,
      Authorization: `Bearer ${token}`,
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

export interface RegisterFoundationInput {
  name: string
  description?: string
  category?: string
}

export const registerFoundation = (token: string, input: RegisterFoundationInput) =>
  callFn<{ foundation: Foundation }>('register-foundation', token, input)
