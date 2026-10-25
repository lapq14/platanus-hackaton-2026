/**
 * `public.foundations` is readable with the anon key BY COLUMN only: `official_email`, `legal_doc_path` and
 * `legal_doc_hash` are private, so `select('*')` fails with "permission denied for table foundations".
 * Always select this explicit list (keep it in sync with the column grants of the database).
 */
export const FOUNDATION_COLUMNS =
  'id, user_id, name, description, category, logo_url, wallet_address, reputation_score, payout_percentage, status, total_received, created_at, rif, country, city, level, instagram_url, tiktok_url, x_url, contract_address'

/** The owner's own panel also reads the auditor's rejection reason. */
export const OWN_FOUNDATION_COLUMNS = `${FOUNDATION_COLUMNS}, rejection_reason`

/**
 * `public.invoices` is no longer readable with the anon key: browsers read the `invoices_public` view
 * (it hides file paths and reduces the agent checks to id / label / passed).
 */
export const INVOICES_VIEW = 'invoices_public'
