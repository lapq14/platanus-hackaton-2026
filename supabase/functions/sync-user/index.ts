// Syncs the authenticated Privy user into `users` (service role). Never touches `balance`.
// POST { wallet_address, email? } -> { user }
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, HttpError, json, readBody, requirePrivyUser } from '../_shared/core.ts'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const did = await requirePrivyUser(req)
    const body = await readBody(req)
    const wallet = body.wallet_address
    const email = body.email ?? null
    if (typeof wallet !== 'string' || !ADDRESS_RE.test(wallet)) {
      throw new HttpError(400, 'invalid_body', 'wallet_address inválida')
    }
    if (email !== null && typeof email !== 'string') {
      throw new HttpError(400, 'invalid_body', 'email inválido')
    }

    // 1. Claim a legacy row (created before privy_id was enforced) for this identity. Only plain donor rows
    // are claimable: knowing a wallet address must never grant the role of a seeded auditor / ong row.
    const { error: claimErr } = await admin
      .from('users')
      .update({ privy_id: did })
      .eq('wallet_address', wallet)
      .eq('role', 'donor')
      .is('privy_id', null)
    if (claimErr) throw claimErr.code === '23505' ? walletTaken() : dbError(claimErr)

    // 2. Upsert on privy_id. Only the listed columns are written (balance never; email only when
    // the client sent a non-empty one, so a stored email is never overwritten with null).
    const row: { privy_id: string; wallet_address: string; email?: string } = { privy_id: did, wallet_address: wallet }
    if (typeof email === 'string' && email.trim() !== '') row.email = email.trim()
    const { data, error } = await admin
      .from('users')
      .upsert(row, { onConflict: 'privy_id' })
      .select('*')
      .single()
    if (error) throw error.code === '23505' ? walletTaken() : dbError(error)

    return json({ user: data })
  } catch (e) {
    return fail(e)
  }
})

const walletTaken = () => new HttpError(409, 'wallet_taken', 'Esta wallet ya está vinculada a otra cuenta')
