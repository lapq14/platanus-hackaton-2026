// Adds simulated USD balance to the caller (cap enforced atomically in the DB).
// POST { amount } -> { balance }
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, json, parseAmount, readBody, requireUser } from '../_shared/core.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const user = await requireUser(req)
    const body = await readBody(req)
    const amount = parseAmount(body.amount)

    const { data, error } = await admin.rpc('wallet_top_up', { p_user_id: user.id, p_amount: amount })
    if (error) throw dbError(error)

    return json({ balance: Number(data) })
  } catch (e) {
    return fail(e)
  }
})
