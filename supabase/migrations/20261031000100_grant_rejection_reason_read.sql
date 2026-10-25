-- foundations is readable by column only (official_email / legal_doc_* stay private). The owner panel needs the
-- auditor's rejection reason to tell the organization what to correct; it is a short sentence, not a document.
grant select (rejection_reason) on public.foundations to anon, authenticated;
