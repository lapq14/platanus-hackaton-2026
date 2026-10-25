// The owner's invoices with everything the public view hides: the agent's explanation of each check, the failed
// attempts, and the evidence deadline.
// POST {} -> { invoices, max_attempts }
// Runs flag_overdue_spends first so a spend past its 7-day window shows as suspicious right away.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, json } from '../_shared/core.ts'
import { MAX_SPEND_ATTEMPTS, requireOwner } from '../_shared/owner.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { foundation } = await requireOwner(req, 'id')
    await admin.rpc('flag_overdue_spends')

    const { data, error } = await admin
      .from('invoices')
      .select('id, number, concept, amount, supplier_rif, status, agent_checks, review_note, file_hash, file_hashes, file_paths, spend_origin_path, spend_destination_path, release_tx_hash, allocated_amount, uploaded_at, reviewed_at, attempts, last_attempt_at, evidence_due_at, suspicious_at')
      .eq('foundation_id', foundation.id)
      .order('uploaded_at', { ascending: false })
    if (error) throw dbError(error)

    const rifs = [...new Set((data ?? []).map((i) => i.supplier_rif as string))]
    const { data: biz } = rifs.length ? await admin.from('businesses').select('rif, name').in('rif', rifs) : { data: [] as { rif: string; name: string }[] }
    const names = new Map((biz ?? []).map((b) => [b.rif, b.name]))

    // File paths stay on the server: the client only learns how many documents exist.
    const invoices = (data ?? []).map(({ file_paths, spend_origin_path, spend_destination_path, ...i }) => ({
      ...i,
      supplier_name: names.get(i.supplier_rif as string) ?? null,
      document_count: Array.isArray(file_paths) ? file_paths.length : 0,
      has_origin_doc: !!spend_origin_path,
      has_destination_doc: !!spend_destination_path,
    }))

    return json({ invoices, max_attempts: MAX_SPEND_ATTEMPTS })
  } catch (e) {
    return fail(e)
  }
})
