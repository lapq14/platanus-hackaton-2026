/**
 * Public columns of `foundations`. The table only grants SELECT on these columns to the anon key
 * (official_email and the legal documents are private), so `select('*')` would fail: always list them.
 */
export const FOUNDATION_COLUMNS =
  'id,user_id,name,description,category,logo_url,wallet_address,reputation_score,payout_percentage,status,total_received,created_at,rif,country,city,level,instagram_url,tiktok_url,x_url,contract_address'
