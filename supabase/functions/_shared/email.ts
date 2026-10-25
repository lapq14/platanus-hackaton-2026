// Transactional e-mail through Resend's HTTP API (no SDK: one POST). The repo had no mail mechanism before.
// Secrets: RESEND_API_KEY (required to actually send), EMAIL_FROM (optional, e.g. "Rastro <no-reply@your-domain>").
// Without RESEND_API_KEY nothing is sent and the result is 'skipped' (never an error): callers record it and
// can retry later; a mail failure must never revert the decision it reports.
export type EmailResult = { status: 'sent' } | { status: 'skipped' } | { status: 'failed'; error: string }

export interface EmailMessage {
  to: string
  subject: string
  text: string
  html: string
}

export const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return { status: 'skipped' }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('EMAIL_FROM') ?? 'Rastro <onboarding@resend.dev>',
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      console.error('email send failed', res.status, detail)
      return { status: 'failed', error: `resend_${res.status}` }
    }
    return { status: 'sent' }
  } catch (e) {
    console.error('email send error', e instanceof Error ? e.message : e)
    return { status: 'failed', error: e instanceof Error && e.name === 'TimeoutError' ? 'timeout' : 'network' }
  }
}
