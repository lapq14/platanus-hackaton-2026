import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCatalog } from '../hooks/useCatalog'
import { slugify } from '../lib/format'
import OrgCard, { OrgCardSkeleton } from './OrgCard'

/**
 * "¿A quién le sigues el rastro hoy?" catalog shared by Home and Explorar.
 * The category filter lives in the URL (`?categoria=salud`) so it can be shared.
 */
export default function CatalogSection({ variant }: { variant: 'home' | 'explorar' }) {
  const { items, loading, error } = useCatalog()
  const [params, setParams] = useSearchParams()

  const categories = useMemo(() => [...new Set(items.map((i) => i.category))].sort((a, b) => a.localeCompare(b, 'es')), [items])
  const selected = categories.find((c) => slugify(c) === params.get('categoria')) ?? null
  const visible = selected ? items.filter((i) => i.category === selected) : items

  const pick = (category: string | null) => {
    const next = new URLSearchParams(params)
    if (category) next.set('categoria', slugify(category))
    else next.delete('categoria')
    setParams(next, { replace: true, preventScrollReset: true })
  }

  const home = variant === 'home'
  const chip = (label: string, on: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      aria-pressed={on}
      style={{
        minHeight: '40px',
        padding: '0 16px',
        borderRadius: '999px',
        border: `1.5px solid ${on ? '#1B1530' : '#DAD4CF'}`,
        background: on ? '#1B1530' : '#FFFFFF',
        color: on ? '#F8F8F8' : '#1B1530',
        fontFamily: 'inherit',
        fontSize: '14px',
        fontWeight: on ? 600 : 400,
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  )

  return (
    <section
      id="fundaciones"
      style={{
        maxWidth: '1200px',
        margin: '0 auto',
        padding: home ? '24px 24px 80px' : '8px 24px 64px',
        display: 'flex',
        flexDirection: 'column',
        gap: '22px',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '16px',
          ...(home ? { paddingTop: '32px', borderTop: '1.5px solid #1B1530' } : {}),
        }}
      >
        <h2 style={{ margin: 0, fontSize: home ? 'clamp(28px, 3vw, 38px)' : '32px', fontWeight: 800, letterSpacing: '-1px' }}>
          ¿A quién le sigues el rastro hoy?
        </h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }} role="group" aria-label="Filtrar por categoría">
          {chip('Todas', selected === null, () => pick(null))}
          {categories.map((c) => chip(c, selected === c, () => pick(c)))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '16px' }}>
        {loading && [0, 1, 2, 3].map((i) => <OrgCardSkeleton key={i} />)}
        {!loading && visible.map((f) => <OrgCard key={f.id} foundation={f} />)}
      </div>
      {!loading && error && (
        <p role="alert" style={{ margin: 0, textAlign: 'center', color: '#8E1B47', fontWeight: 600 }}>
          No pudimos cargar las fundaciones. Intenta de nuevo en unos segundos.
        </p>
      )}
      {!loading && !error && visible.length === 0 && (
        <p style={{ margin: 0, textAlign: 'center', color: '#5A5468' }}>Aún no hay fundaciones en esta categoría.</p>
      )}
    </section>
  )
}
