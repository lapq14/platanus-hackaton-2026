import { Link } from 'react-router-dom'
import { LEVEL_RELEASE, LEVEL_TRANCHES, toLevel, type Level } from '../config/levels'
import { useCatalog } from '../hooks/useCatalog'
import { useMediaQuery } from '../hooks/useMediaQuery'
import OrgCard, { OrgCardSkeleton } from './OrgCard'

/** The home page only shows level 3 and above. */
const MIN_LEVEL = 3
const LEVELS_DESC: Level[] = [5, 4, 3]

/** Cards per row. Each card needs about 260px, so the row always fits on a single line. */
function useColumns(): number {
  const four = useMediaQuery('(min-width: 1180px)')
  const three = useMediaQuery('(min-width: 880px)')
  const two = useMediaQuery('(min-width: 580px)')
  return four ? 4 : three ? 3 : two ? 2 : 1
}

/**
 * Home catalog: one line of foundations per reputation level (5, 4 and 3). Foundations that are untrustworthy or have
 * no history are filtered out by the query itself. Each line shows as many cards as fit the screen; the rest are one
 * click away in Explorar.
 */
export default function LevelRows() {
  const { items, loading, error } = useCatalog({ minLevel: MIN_LEVEL, trustedOnly: true })
  const cols = useColumns()
  const grid = { display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: '16px' } as const

  const rows = LEVELS_DESC.map((level) => ({ level, list: items.filter((i) => toLevel(i.level) === level) })).filter((r) => r.list.length > 0)

  return (
    <section
      id="fundaciones"
      style={{ maxWidth: '1200px', margin: '0 auto', padding: '24px 24px 80px', display: 'flex', flexDirection: 'column', gap: '28px' }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '32px', borderTop: '1.5px solid #1B1530' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
          <h2 style={{ margin: 0, fontSize: 'clamp(28px, 3vw, 38px)', fontWeight: 800, letterSpacing: '-1px' }}>¿A quién le sigues el rastro hoy?</h2>
          <Link to="/explorar" style={{ fontSize: '15px', fontWeight: 600, textDecoration: 'none' }}>
            Ver todas las fundaciones →
          </Link>
        </div>
        <p style={{ margin: 0, fontSize: '14px', color: '#5A5468', maxWidth: '640px' }}>
          Aquí solo aparecen fundaciones de nivel 3 en adelante, con historial y sin alertas de confianza.
        </p>
      </div>

      {loading && (
        <div style={grid}>
          {Array.from({ length: cols }, (_, i) => (
            <OrgCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!loading &&
        rows.map(({ level, list }) => {
          const shown = list.slice(0, cols)
          const more = list.length - shown.length
          return (
            <div key={level} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }} role="group" aria-label={`Nivel ${level}`}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px 16px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '4px 12px' }}>
                  <h3 style={{ margin: 0, fontSize: '22px', fontWeight: 800, letterSpacing: '-0.5px' }}>Nivel {level}</h3>
                  <span style={{ fontSize: '14px', color: '#5A5468' }}>
                    Entregan el {LEVEL_RELEASE[level]}% al donar · {LEVEL_TRANCHES[level]} tramos
                  </span>
                </div>
                <Link to={`/explorar?nivel=${level}`} style={{ fontSize: '14px', fontWeight: 600, textDecoration: 'none' }}>
                  {more > 0 ? `Ver ${more} más` : 'Ver en Explorar'} →
                </Link>
              </div>
              <div style={grid}>
                {shown.map((f) => (
                  <OrgCard key={f.id} foundation={f} />
                ))}
              </div>
            </div>
          )
        })}

      {!loading && error && (
        <p role="alert" style={{ margin: 0, textAlign: 'center', color: '#8E1B47', fontWeight: 600 }}>
          No pudimos cargar las fundaciones. Intenta de nuevo en unos segundos.
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <p style={{ margin: 0, textAlign: 'center', color: '#5A5468' }}>Aún no hay fundaciones de nivel 3 o superior para mostrar.</p>
      )}
    </section>
  )
}
