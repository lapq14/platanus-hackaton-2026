import { useEffect, useRef, type ReactNode } from 'react'

interface ModalProps {
  title: string
  onClose: () => void
  children: ReactNode
  maxWidth?: number
}

/** Accessible dialog in brand style: Esc and backdrop click close it, focus moves inside on open. */
export default function Modal({ title, onClose, children, maxWidth = 520 }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)
  // Keep the latest handler without re-running the focus effect on every parent render.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus()
    }
  }, [])

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(27,21,48,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: `${maxWidth}px`,
          maxHeight: '90vh',
          overflowY: 'auto',
          background: '#FFFFFF',
          border: '1.5px solid #1B1530',
          borderRadius: '20px',
          padding: '26px',
          display: 'flex',
          flexDirection: 'column',
          gap: '16px',
          color: '#1B1530',
          outline: 'none',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px' }}>{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{ border: 'none', background: 'transparent', fontSize: '24px', lineHeight: 1, cursor: 'pointer', color: '#5A5468', padding: '4px 8px' }}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
