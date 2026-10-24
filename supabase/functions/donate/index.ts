// Debits the donor balance, records the donation and releases the initial tranche on-chain.
// POST { foundation_id, amount } -> { donation, balance, release }
// A chain failure after the debit still answers 200 with release.status = 'pending'.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  admin,
  CORS,
  dbError,
  fail,
  HttpError,
  json,
  parseAmount,
  readBody,
  releaseInitial,
  requireUser,
} from '../_shared/core.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const user = await requireUser(req)
    const body = await readBody(req)
    const foundationId = body.foundation_id
    if (typeof foundationId !== 'string' || !foundationId) {
      throw new HttpError(400, 'invalid_body', 'foundation_id requerido')
    }
    const amount = parseAmount(body.amount)
    if (amount < 1) throw new HttpError(400, 'invalid_amount', 'El monto mínimo es 1 USD')

    // Atomic debit + donation insert.
    const { data: donation, error } = await admin.rpc('donate_from_balance', {
      p_user_id: user.id,
      p_foundation_id: foundationId,
      p_amount: amount,
    })
    if (error) throw dbError(error)

    const { data: fresh } = await admin.from('users').select('balance').eq('id', user.id).single()
    const balance = Number(fresh?.balance ?? user.balance - amount)

    let release:
      | { status: 'released'; tx_hash: string; released: number }
      | { status: 'pending'; error: string }
    try {
      const r = await releaseInitial(donation.id)
      release = { status: 'released', tx_hash: r.tx_hash, released: r.released }
    } catch (e) {
      console.error('initial release pending', e)
      release = {
        status: 'pending',
        error: e instanceof HttpError ? e.message : 'La liberación inicial quedó pendiente',
      }
    }

    return json({ donation, balance, release })
  } catch (e) {
    return fail(e)
  }
})
