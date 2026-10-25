import type { ReactNode } from 'react'

/** Root wrapper of every rastro page (brand font, ink on #F8F8F8). Pages bring their own header. */
export default function PageShell({ children, minHeight = 900 }: { children: ReactNode; minHeight?: number }) {
  return (
    <div style={{ color: '#1B1530', fontFamily: "'Bricolage Grotesque', system-ui, sans-serif", minHeight: `${minHeight}px`, backgroundColor: '#F8F8F8' }}>
      {children}
    </div>
  )
}

/** Centered informational block (loading, empty and error states). */
export function Notice({ title, children }: { title?: string; children?: ReactNode }) {
  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '64px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '10px', alignItems: 'center' }}>
      {title && <strong style={{ fontSize: '20px' }}>{title}</strong>}
      {children && <span style={{ fontSize: '16px', color: '#5A5468', maxWidth: '520px' }}>{children}</span>}
    </div>
  )
}
