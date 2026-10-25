import type { CSSProperties, MouseEventHandler, ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface ButtonProps {
  children: ReactNode
  to?: string
  href?: string
  onClick?: MouseEventHandler<HTMLElement>
  disabled?: boolean
  type?: 'button' | 'submit'
  minHeight?: number
  fontSize?: number
  padding?: string
  style?: CSSProperties
  'aria-label'?: string
}

function render(base: CSSProperties, p: ButtonProps) {
  const style: CSSProperties = { ...base, ...p.style }
  if (p.to) {
    return (
      <Link to={p.to} style={style} onClick={p.onClick} aria-label={p['aria-label']}>
        {p.children}
      </Link>
    )
  }
  if (p.href) {
    return (
      <a href={p.href} style={style} onClick={p.onClick} aria-label={p['aria-label']}>
        {p.children}
      </a>
    )
  }
  return (
    <button type={p.type ?? 'button'} style={style} onClick={p.onClick} disabled={p.disabled} aria-label={p['aria-label']}>
      {p.children}
    </button>
  )
}

/** Bugainvilia action button (white text, radius 12). */
export function PrimaryButton(p: ButtonProps) {
  return render(
    {
      minHeight: `${p.minHeight ?? 48}px`,
      padding: p.padding ?? '0 22px',
      borderRadius: '12px',
      border: 'none',
      background: p.disabled ? '#ECE7F0' : '#B4235A',
      color: p.disabled ? '#5A5468' : '#FFFFFF',
      fontFamily: 'inherit',
      fontWeight: 700,
      fontSize: `${p.fontSize ?? 16}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textDecoration: 'none',
      cursor: p.disabled ? 'not-allowed' : 'pointer',
    },
    p,
  )
}

/** Ink-outlined secondary button. */
export function SecondaryButton(p: ButtonProps) {
  return render(
    {
      minHeight: `${p.minHeight ?? 48}px`,
      padding: p.padding ?? '0 22px',
      borderRadius: '12px',
      border: '1.5px solid #1B1530',
      background: 'transparent',
      color: '#1B1530',
      fontFamily: 'inherit',
      fontWeight: 600,
      fontSize: `${p.fontSize ?? 16}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      textDecoration: 'none',
      cursor: p.disabled ? 'not-allowed' : 'pointer',
    },
    p,
  )
}
