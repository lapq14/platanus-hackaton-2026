// Utilidades compartidas por las Edge Functions de Rastro.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createPublicClient, createWalletClient, defineChain, http } from 'npm:viem@2'
import { privateKeyToAccount } from 'npm:viem@2/accounts'
import { importSPKI, jwtVerify } from 'npm:jose@5'

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

export function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Falta la variable de entorno ${name}`)
  return v
}

/** Cliente con service role: salta RLS. Solo usar en el servidor. */
export const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

export const chain = defineChain({
  id: Number(Deno.env.get('CHAIN_ID') ?? 84532),
  name: 'Rastro chain',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [Deno.env.get('CHAIN_RPC') ?? 'https://sepolia.base.org'] } },
})

export const publicClient = createPublicClient({ chain, transport: http() })

/**
 * Chain mode. Simulated is the DEFAULT: releases skip the on-chain send and use a generated hash, so the whole
 * flow works without ETH. Real Base Sepolia transactions are sent only when CHAIN_MODE === 'real'.
 */
export const isSimulated = () => Deno.env.get('CHAIN_MODE') !== 'real'

/** Simulated hashes start with 0x + ASCII "simul". Mirrored by web/src/lib/simulated.ts. */
export const SIMULATED_HASH_PREFIX = '0x73696d756c'

export const isSimulatedHash = (hash: string) => hash.toLowerCase().startsWith(SIMULATED_HASH_PREFIX)

/** 32-byte (0x + 64 hex) hash: the simulated marker followed by cryptographically random bytes. */
function generateSimulatedHash(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(27))
  const rest = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${SIMULATED_HASH_PREFIX}${rest}`
}

/**
 * Single send path for every platform -> foundation release. Real mode signs and broadcasts from the escrow wallet;
 * simulated mode returns a generated hash without touching the key or the RPC.
 */
async function sendRelease(to: string, wei: bigint): Promise<string> {
  if (isSimulated()) return generateSimulatedHash()
  const { client } = escrowWallet()
  return await client.sendTransaction({ to: to as `0x${string}`, value: wei })
}

/** Receipt wait: nothing to wait for on a simulated hash (it never reached a chain). */
async function waitReceipt(hash: string, label: string) {
  if (isSimulatedHash(hash)) return null
  return await publicClient.waitForTransactionReceipt({ hash: hash as `0x${string}`, timeout: 60_000 }).catch((e) => {
    console.warn(label, e instanceof Error ? e.message : e)
    return null
  })
}

/** Wallet de custodia: firma liberaciones y reembolsos. */
export function escrowWallet() {
  const account = privateKeyToAccount(env('ESCROW_PRIVATE_KEY') as `0x${string}`)
  return { account, client: createWalletClient({ account, chain, transport: http() }) }
}

// ---------------------------------------------------------------------------------------------
// Simulated donor balance: errors, Privy auth, USD -> wei, shared release logic.
// ---------------------------------------------------------------------------------------------

/** Simulated rate: 1 USD of balance = 0.000001 ETH released on-chain. */
export const USD_TO_ETH = 0.000001

/** 1 USD cent = 1e-8 ETH = 1e10 wei. Whole-cent integer math avoids float drift. */
export const usdToWei = (usd: number) => BigInt(Math.round(usd * 100)) * 10_000_000_000n

export const round2 = (n: number) => Math.round(n * 100) / 100

export const MAX_USD = 10_000

export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/** Postgres `raise exception '<code>'` messages mapped to the HTTP contract: [status, code, message]. */
const DB_ERRORS: Record<string, [number, string, string]> = {
  invalid_amount: [400, 'invalid_amount', 'Monto inválido'],
  cap_exceeded: [400, 'cap_exceeded', 'El saldo no puede superar 10.000 USD'],
  insufficient_funds: [402, 'insufficient_funds', 'Fondos insuficientes'],
  foundation_not_found: [404, 'foundation_not_found', 'Fundación no encontrada'],
  foundation_suspended: [403, 'foundation_suspended', 'Fundación suspendida'],
  user_not_found: [404, 'user_not_synced', 'Usuario no sincronizado'],
  release_hash_mismatch: [409, 'release_hash_mismatch', 'El hash de liberación no coincide'],
  invoice_not_found: [404, 'invoice_not_found', 'Factura no encontrada'],
  invoice_not_pending: [409, 'invoice_not_pending', 'La factura ya fue resuelta'],
  donation_refunded: [409, 'donation_refunded', 'La donación ya fue reembolsada'],
  insufficient_balance: [409, 'insufficient_balance', 'El gasto supera el saldo disponible de la fundación'],
  already_allocated: [409, 'already_allocated', 'Este gasto ya fue asignado a los aportes'],
  invalid_verdict: [500, 'internal_error', 'Error interno del servidor'],
}

/** Converts a Supabase/PostgREST error into an HttpError (known codes) or a generic 500. */
export function dbError(error: { message: string }): HttpError {
  const known = DB_ERRORS[error.message]
  if (known) return new HttpError(known[0], known[1], known[2])
  console.error('db error', error.message)
  return new HttpError(500, 'internal_error', 'Error interno del servidor')
}

/** Every error path answers `{ error: <code>, message }`. */
export function fail(e: unknown) {
  if (e instanceof HttpError) return json({ error: e.code, message: e.message }, e.status)
  // Never echo raw error text (may contain RPC URLs or SQL details): log server-side only.
  console.error(e)
  return json({ error: 'internal_error', message: 'Error interno del servidor' }, 500)
}

let privyKey: CryptoKey | null = null

/**
 * Normalizes whatever the dashboard/env stored into a PEM that jose accepts:
 * literal "\n" sequences, CRLF, surrounding quotes, collapsed newlines, or a bare base64 body.
 */
function normalizeSpkiPem(raw: string): string {
  const body = raw
    .replace(/\\n/g, '\n')
    .replace(/\r/g, '')
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '')
    .replace(/\s+/g, '')
  if (!body) throw new Error('PRIVY_VERIFICATION_KEY is empty')
  const lines = body.match(/.{1,64}/g) ?? []
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`
}

async function getPrivyKey(): Promise<CryptoKey> {
  if (privyKey) return privyKey
  const pem = normalizeSpkiPem(env('PRIVY_VERIFICATION_KEY'))
  try {
    privyKey = await importSPKI(pem, 'ES256')
  } catch (e) {
    console.error('PRIVY_VERIFICATION_KEY could not be imported as an ES256 SPKI public key', e)
    throw new Error('PRIVY_VERIFICATION_KEY is not a valid ES256 public key (expected the PEM from Privy Dashboard > App settings)')
  }
  return privyKey
}

/** Verifies the Privy access token and returns the user's Privy DID (`sub`). Throws 401. */
export async function requirePrivyUser(req: Request): Promise<string> {
  const header = req.headers.get('Authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new HttpError(401, 'unauthorized', 'Falta el token de acceso')
  // A missing secret is a server misconfiguration (500), not an authentication failure.
  const key = await getPrivyKey()
  try {
    const { payload } = await jwtVerify(token, key, { issuer: 'privy.io', audience: env('PRIVY_APP_ID') })
    if (!payload.sub) throw new Error('missing sub')
    return payload.sub
  } catch {
    throw new HttpError(401, 'unauthorized', 'Token de acceso inválido')
  }
}

export interface UserRow {
  id: string
  privy_id: string | null
  wallet_address: string
  email: string | null
  role: string
  balance: number
  created_at: string
}

/** Resolves the caller's `users` row from the verified token. Throws 401 / 404 user_not_synced. */
export async function requireUser(req: Request): Promise<UserRow> {
  const did = await requirePrivyUser(req)
  const { data, error } = await admin.from('users').select('*').eq('privy_id', did).maybeSingle()
  if (error) throw dbError(error)
  if (!data) throw new HttpError(404, 'user_not_synced', 'Usuario no sincronizado')
  return data as UserRow
}

/** Like requireUser, but anonymous callers (no or invalid token) get `null` instead of an error. */
export async function optionalUser(req: Request): Promise<UserRow | null> {
  if (!(req.headers.get('Authorization') ?? '').startsWith('Bearer ')) return null
  try {
    return await requireUser(req)
  } catch (e) {
    if (e instanceof HttpError && (e.status === 401 || e.status === 404)) return null
    throw e
  }
}

/** Foundation columns safe to show to anyone (never official_email nor the legal documents). */
export const PUBLIC_FOUNDATION_COLUMNS =
  'id, user_id, name, description, category, logo_url, wallet_address, reputation_score, payout_percentage, status, total_received, created_at, rif, country, city, level, instagram_url, tiktok_url, x_url, contract_address'

/** Parses and validates an amount: finite number, > 0, <= MAX_USD, rounded to 2 decimals. */
export function parseAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, 'invalid_amount', 'Monto inválido')
  }
  const amount = round2(value)
  if (amount <= 0 || amount > MAX_USD) throw new HttpError(400, 'invalid_amount', 'Monto inválido')
  return amount
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json()
    if (body && typeof body === 'object' && !Array.isArray(body)) return body as Record<string, unknown>
  } catch {
    // fall through to the 400 below
  }
  throw new HttpError(400, 'invalid_body', 'Cuerpo de la solicitud inválido')
}

export interface ReleaseResult {
  tx_hash: string
  released: number
  payout_percentage: number
}

const CLAIM_TTL_MS = 2 * 60 * 1000

/**
 * Sends the initial tranche of a donation from custody to the foundation. Idempotent at every step:
 * claim -> send -> persist hash -> best-effort receipt -> finalize (record_initial_release).
 * A retry after a persisted hash only finalizes; it never sends again.
 */
export async function releaseInitial(donationId: string): Promise<ReleaseResult> {
  const { data: donation, error } = await admin
    .from('donations')
    .select('*, foundation:foundations(*)')
    .eq('id', donationId)
    .maybeSingle()
  if (error) throw dbError(error)
  if (!donation) throw new HttpError(404, 'donation_not_found', 'Donación no encontrada')

  const f = donation.foundation
  // The percentage fixed when the donation was made (tranche 1 amount); the foundation's CURRENT payout
  // may differ if its reputation changed since. Legacy rows without initial_pct fall back to the current one.
  const pct = Number(donation.initial_pct ?? f.payout_percentage)
  const releasedUsd = round2((Number(donation.total_amount) * pct) / 100)

  if (Number(donation.amount_released) > 0) {
    throw new HttpError(409, 'already_released', 'Ya se liberó el tramo inicial')
  }
  if (donation.status !== 'in_escrow') {
    throw new HttpError(409, 'invalid_status', `Estado inválido: ${donation.status}`)
  }
  // `frozen` is the only blocked value the table allows (never 'suspended'); `pending` has not been approved yet.
  if (f.status !== 'active') throw new HttpError(403, 'foundation_suspended', 'Fundación suspendida')

  let txHash: string | null = donation.release_tx_hash

  if (!txHash) {
    // Claim: only one caller can hold a fresh claim.
    const staleBefore = new Date(Date.now() - CLAIM_TTL_MS).toISOString()
    const { data: claimed, error: claimErr } = await admin
      .from('donations')
      .update({ release_claimed_at: new Date().toISOString() })
      .eq('id', donationId)
      .is('release_tx_hash', null)
      .or(`release_claimed_at.is.null,release_claimed_at.lt.${staleBefore}`)
      .select('id')
      .maybeSingle()
    if (claimErr) throw dbError(claimErr)
    if (!claimed) {
      const { data: current } = await admin
        .from('donations')
        .select('release_tx_hash')
        .eq('id', donationId)
        .maybeSingle()
      if (current?.release_tx_hash) throw new HttpError(409, 'already_released', 'Ya se liberó el tramo inicial')
      throw new HttpError(409, 'release_in_progress', 'La liberación ya está en curso')
    }

    // Send. A failure before a hash exists is safe to compensate; after a hash exists, never.
    const releaseWei = (usdToWei(Number(donation.total_amount)) * BigInt(pct)) / 100n
    try {
      txHash = await sendRelease(f.wallet_address, releaseWei)
    } catch (e) {
      console.error('release send failed', e)
      await admin
        .from('donations')
        .update({ release_claimed_at: null })
        .eq('id', donationId)
        .is('release_tx_hash', null)
      throw new HttpError(502, 'chain_error', 'No se pudo enviar la liberación on-chain')
    }

    // Persist the hash with a few retries: losing it would allow a double send after the claim expires.
    let persistErr: { message: string } | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error: err } = await admin
        .from('donations')
        .update({ release_tx_hash: txHash })
        .eq('id', donationId)
        .is('release_tx_hash', null)
      persistErr = err
      if (!err) break
      console.error('release hash NOT persisted', { donationId, txHash, attempt, err })
      if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * attempt))
    }
    if (persistErr) {
      throw new HttpError(500, 'persist_failed', 'La liberación se envió pero no se pudo registrar el hash')
    }
  }

  // Best effort on timeout: the tx is already broadcast, so it must not block finalizing.
  // A confirmed revert, however, means nothing was sent: free the donation for a clean retry.
  const receipt = await waitReceipt(txHash as string, 'receipt wait skipped')
  if (receipt && receipt.status === 'reverted') {
    console.error('release tx reverted', { donationId, txHash })
    const { error: clearErr } = await admin
      .from('donations')
      .update({ release_tx_hash: null, release_claimed_at: null })
      .eq('id', donationId)
      .eq('release_tx_hash', txHash)
    if (clearErr) console.error('could not clear reverted release', { donationId, clearErr })
    throw new HttpError(502, 'chain_reverted', 'La transacción de liberación fue revertida on-chain')
  }

  const { error: finErr } = await admin.rpc('record_initial_release', {
    p_donation_id: donationId,
    p_tx_hash: txHash,
    p_released_usd: releasedUsd,
  })
  if (finErr) throw dbError(finErr)

  return { tx_hash: txHash as string, released: releasedUsd, payout_percentage: pct }
}

export interface SpendReleaseResult {
  /** `released`: tranches paid (or already paid); `none`: the invoice had no tranche to release. */
  status: 'released' | 'none'
  tx_hash?: string
  released_count: number
  released_usd: number
}

const sumCents = (rows: { amount: number | string }[]) => rows.reduce((s, r) => s + Math.round(Number(r.amount) * 100), 0)

/**
 * Sends the tranches a VERIFIED invoice unlocked (allocate_spend marked the next tranche of every donation whose
 * tranche reached 50% consumed as `in_review`, with invoice_id = this invoice) with ONE transfer from custody to
 * the foundation wallet. If no tranche reached the threshold there is nothing to send (`status: 'none'`).
 * Same pattern as releaseInitial:
 * claim -> send -> persist hash -> best-effort receipt -> finalize (record_spend_release).
 * Every step is retryable: a retry after a persisted hash only finalizes; it never sends again.
 * A send failure (e.g. escrow without ETH) leaves invoice = verified and tranches = in_review: call again later.
 */
export async function releaseSpend(invoiceId: string): Promise<SpendReleaseResult> {
  const { data: invoice, error } = await admin
    .from('invoices')
    .select('id, foundation_id, status, release_tx_hash, foundation:foundations(wallet_address)')
    .eq('id', invoiceId)
    .maybeSingle()
  if (error) throw dbError(error)
  if (!invoice) throw new HttpError(404, 'invoice_not_found', 'Factura no encontrada')
  if (invoice.status !== 'verified') throw new HttpError(409, 'invoice_not_verified', 'La factura no está verificada')

  const { data: pending, error: pErr } = await admin
    .from('tranches')
    .select('amount')
    .eq('invoice_id', invoiceId)
    .eq('state', 'in_review')
  if (pErr) throw dbError(pErr)

  let txHash: string | null = invoice.release_tx_hash
  if (!pending?.length) {
    if (!txHash) return { status: 'none', released_count: 0, released_usd: 0 }
    // Already finalized (or the tranches were broken by a later freeze): report what was released.
    const { data: done } = await admin.from('tranches').select('amount').eq('invoice_id', invoiceId).eq('state', 'released')
    return { status: 'released', tx_hash: txHash, released_count: done?.length ?? 0, released_usd: sumCents(done ?? []) / 100 }
  }

  if (!txHash) {
    // Claim: only one caller can hold a fresh claim.
    const staleBefore = new Date(Date.now() - CLAIM_TTL_MS).toISOString()
    const { data: claimed, error: claimErr } = await admin
      .from('invoices')
      .update({ release_claimed_at: new Date().toISOString() })
      .eq('id', invoiceId)
      .is('release_tx_hash', null)
      .or(`release_claimed_at.is.null,release_claimed_at.lt.${staleBefore}`)
      .select('id')
      .maybeSingle()
    if (claimErr) throw dbError(claimErr)
    if (!claimed) {
      const { data: current } = await admin.from('invoices').select('release_tx_hash').eq('id', invoiceId).maybeSingle()
      if (current?.release_tx_hash) throw new HttpError(409, 'already_released', 'Ya se envió la liberación')
      throw new HttpError(409, 'release_in_progress', 'La liberación ya está en curso')
    }

    // Send. A failure before a hash exists is safe to compensate; after a hash exists, never.
    const releaseWei = BigInt(sumCents(pending)) * 10_000_000_000n
    const to = (invoice.foundation as { wallet_address: string } | null)?.wallet_address
    if (!to) throw new HttpError(500, 'internal_error', 'Error interno del servidor')
    try {
      txHash = await sendRelease(to, releaseWei)
    } catch (e) {
      console.error('spend release send failed', e)
      await admin.from('invoices').update({ release_claimed_at: null }).eq('id', invoiceId).is('release_tx_hash', null)
      throw new HttpError(502, 'chain_error', 'No se pudo enviar la liberación on-chain')
    }

    // Persist the hash with a few retries: losing it would allow a double send after the claim expires.
    let persistErr: { message: string } | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      const { error: err } = await admin
        .from('invoices')
        .update({ release_tx_hash: txHash })
        .eq('id', invoiceId)
        .is('release_tx_hash', null)
      persistErr = err
      if (!err) break
      console.error('spend release hash NOT persisted', { invoiceId, txHash, attempt, err })
      if (attempt < 3) await new Promise((r) => setTimeout(r, 300 * attempt))
    }
    if (persistErr) {
      throw new HttpError(500, 'persist_failed', 'La liberación se envió pero no se pudo registrar el hash')
    }
  }

  // Best effort on timeout; a confirmed revert means nothing was sent: free the invoice for a clean retry.
  const receipt = await waitReceipt(txHash as string, 'spend receipt wait skipped')
  if (receipt && receipt.status === 'reverted') {
    console.error('spend release tx reverted', { invoiceId, txHash })
    const { error: clearErr } = await admin
      .from('invoices')
      .update({ release_tx_hash: null, release_claimed_at: null })
      .eq('id', invoiceId)
      .eq('release_tx_hash', txHash)
    if (clearErr) console.error('could not clear reverted spend release', { invoiceId, clearErr })
    throw new HttpError(502, 'chain_reverted', 'La transacción de liberación fue revertida on-chain')
  }

  const { data: fin, error: finErr } = await admin.rpc('record_spend_release', { p_invoice_id: invoiceId, p_tx_hash: txHash })
  if (finErr) throw dbError(finErr)
  const summary = fin as { released_count: number; released_usd: number }
  return { status: 'released', tx_hash: txHash as string, released_count: summary.released_count, released_usd: Number(summary.released_usd) }
}
