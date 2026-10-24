import { Link } from 'react-router-dom'
import { Lock, Percent } from 'lucide-react'
import { useFoundations } from '../hooks/useFoundations'
import ReputationBadge from '../components/ReputationBadge'

export default function Home() {
  const { data, loading, error } = useFoundations()

  return (
    <div className="space-y-8">
      <section className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-500 p-8 text-white">
        <h1 className="text-3xl font-bold">Dona con trazabilidad real</h1>
        <p className="mt-2 max-w-2xl text-brand-50">
          Tu donación queda en custodia. Cada fundación recibe un tramo según su reputación y
          desbloquea el resto solo cuando demuestra, factura en mano, en qué lo gastó.
        </p>
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">Fundaciones</h2>
        {loading && <p className="text-slate-500">Cargando…</p>}
        {error && <p className="text-red-600">Error: {error}</p>}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((f) => (
            <Link
              key={f.id}
              to={`/fundacion/${f.id}`}
              className="group rounded-xl border border-slate-200 bg-white p-5 transition hover:border-brand-500 hover:shadow-md"
            >
              <div className="flex items-start gap-3">
                {f.logo_url && (
                  <img src={f.logo_url} alt="" className="h-12 w-12 rounded-lg bg-slate-100" />
                )}
                <div className="min-w-0 flex-1">
                  <h3 className="font-semibold group-hover:text-brand-700">{f.name}</h3>
                  <p className="text-xs text-slate-500">{f.category}</p>
                </div>
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-slate-600">{f.description}</p>
              <div className="mt-4 flex items-center justify-between">
                <ReputationBadge foundation={f} />
                <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                  <Percent size={12} /> {f.payout_percentage}% inicial
                  <Lock size={12} className="ml-1" /> {100 - f.payout_percentage}% custodia
                </span>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}
