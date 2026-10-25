// The owner's own view of the foundation: private profile fields, money stats, reputation state and appeals.
// POST {} -> { foundation, stats, appeals, can_appeal }
// Runs flag_overdue_spends first so a spend that went past its 7-day window is reflected immediately.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { admin, CORS, dbError, fail, json, PUBLIC_FOUNDATION_COLUMNS } from '../_shared/core.ts'
import { requireOwner } from '../_shared/owner.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })

  try {
    const { foundation: owned } = await requireOwner(req, 'id')
    await admin.rpc('flag_overdue_spends')

    const [{ data: foundation, error: fErr }, { data: stats, error: sErr }, { data: appeals, error: aErr }] = await Promise.all([
      admin.from('foundations').select(`${PUBLIC_FOUNDATION_COLUMNS}, official_email, legal_doc_path, rejection_reason`).eq('id', owned.id).single(),
      admin.from('foundation_stats').select('*').eq('foundation_id', owned.id).maybeSingle(),
      admin.from('appeals').select('id, reason, status, created_at, evidence_paths').eq('foundation_id', owned.id).order('created_at', { ascending: false }).limit(10),
    ])
    const err = fErr ?? sErr ?? aErr
    if (err) throw dbError(err)

    const { legal_doc_path, ...rest } = foundation as Record<string, unknown> & { legal_doc_path: string | null; status: string }
    const open = (appeals ?? []).some((a) => a.status === 'received' || a.status === 'in_review')
    const flagged = (stats as { reputation_state?: string } | null)?.reputation_state === 'inconfiable' || rest.status === 'frozen'

    return json({
      foundation: { ...rest, has_legal_doc: !!legal_doc_path },
      stats,
      appeals: (appeals ?? []).map(({ evidence_paths, ...a }) => ({ ...a, evidence_count: evidence_paths?.length ?? 0 })),
      can_appeal: flagged && !open,
    })
  } catch (e) {
    return fail(e)
  }
})
