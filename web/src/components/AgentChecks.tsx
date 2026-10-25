import type { AgentCheck } from '../types'

/** Agent verifications list: green check when passed, amber dashed ring when human review is suggested. */
export default function AgentChecks({ checks }: { checks: AgentCheck[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {checks.map((c) => (
        <div key={c.id} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '12px 0', borderTop: '1px solid #ECE7F0' }}>
          <span style={{ flexShrink: 0 }}>
            {c.passed ? (
              <svg width="22" height="22" viewBox="0 0 40 40" role="img" aria-label="Aprobada">
                <circle cx="20" cy="20" r="18" fill="#1A7F52" />
                <path d="m12.5 20.5 5 5 10-11" stroke="#FFFFFF" strokeWidth="3.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 40 40" role="img" aria-label="Requiere revisión humana">
                <circle cx="20" cy="20" r="18" fill="#E8A317" />
                <circle cx="20" cy="20" r="11" fill="none" stroke="#1B1530" strokeWidth="2.4" strokeDasharray="2 3" />
              </svg>
            )}
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            <strong style={{ fontSize: '15px' }}>{c.label}</strong>
            {c.detail && <span style={{ fontSize: '13px', color: '#5A5468' }}>{c.detail}</span>}
          </div>
        </div>
      ))}
    </div>
  )
}
