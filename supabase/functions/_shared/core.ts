// Utilidades compartidas por las Edge Functions de Trazo.
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
  name: 'Trazo chain',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [Deno.env.get('CHAIN_RPC') ?? 'https://sepolia.base.org'] } },
})

export const publicClient = createPublicClient({ chain, transport: http() })

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
  const pct = Number(f.payout_percentage)
  const releasedUsd = round2((Number(donation.total_amount) * pct) / 100)

  if (Number(donation.amount_released) > 0) {
    throw new HttpError(409, 'already_released', 'Ya se liberó el tramo inicial')
  }
  if (donation.status !== 'in_escrow') {
    throw new HttpError(409, 'invalid_status', `Estado inválido: ${donation.status}`)
  }
  if (f.status === 'suspended') throw new HttpError(403, 'foundation_suspended', 'Fundación suspendida')

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
      const { client } = escrowWallet()
      txHash = await client.sendTransaction({ to: f.wallet_address as `0x${string}`, value: releaseWei })
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
  const receipt = await publicClient
    .waitForTransactionReceipt({ hash: txHash as `0x${string}`, timeout: 60_000 })
    .catch((e) => {
      console.warn('receipt wait skipped', e instanceof Error ? e.message : e)
      return null
    })
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
