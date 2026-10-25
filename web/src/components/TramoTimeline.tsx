import type { TrancheState } from '../types'
import { formatUSDT } from '../lib/format'
import TxLink from './TxLink'
import TramoIcon from './TramoIcon'

export interface StepUse {
  /** What the money was spent on ("Insumos médicos · Factura N° 000204 · Farmacia San Rafael"). */
  label: string
  amount: number
  date?: string
}

export interface StepProgress {
  /** % of the tranche already consumed (0-100). */
  usedPct: number
  /** % at which the next tranche unlocks. */
  thresholdPct: number
  caption: string
}

export interface TimelineStep {
  state: TrancheState
  title: string
  amount: number
  description: string
  /** Date shown next to the title (already formatted). */
  date?: string
  /** On-chain transfer, rendered as `tx 0x…` linking to the explorer (or the "Simulado" badge). */
  hash?: string
  /** Where the money of this tranche went. */
  uses?: StepUse[]
  /** Progress toward the 50% that unlocks the next tranche. */
  progress?: StepProgress
}

/** Vertical tranche timeline. The connector is solid ink between released steps and dashed grey afterwards. */
export default function TramoTimeline({ steps }: { steps: TimelineStep[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {steps.map((step, i) => {
        const last = i === steps.length - 1
        const solid = step.state === 'released' && steps[i + 1]?.state === 'released'
        return (
          <div key={i} style={{ display: 'flex', gap: '18px' }}>
            <div style={{ width: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <TramoIcon state={step.state} size={40} />
              {!last &&
                (solid ? (
                  <div style={{ flex: '1', width: '3px', background: '#1B1530' }} />
                ) : (
                  <div style={{ flex: '1', width: '0', borderLeft: '3px dashed #8A8296' }} />
                ))}
            </div>
            <div style={{ flex: '1', minWidth: '0', padding: last ? '6px 0 0' : '6px 0 24px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <strong style={{ fontSize: '17px' }}>{step.title}</strong>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '17px', fontWeight: 600 }}>{formatUSDT(step.amount)}</span>
              </div>
              <span style={{ fontSize: '14px', color: '#5A5468' }}>
                {step.description}
                {step.date ? ` · ${step.date}` : ''}
              </span>
              {step.hash && (
                <TxLink hash={step.hash} label="tx" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', textDecoration: 'none' }} />
              )}
              {step.uses && step.uses.length > 0 && (
                <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {step.uses.map((u, k) => (
                    <li
                      key={k}
                      style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: '14px', background: '#F6F4EF', borderRadius: '10px', padding: '8px 12px' }}
                    >
                      <span>
                        {u.label}
                        {u.date && <span style={{ color: '#5A5468' }}> · {u.date}</span>}
                      </span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontWeight: 600, whiteSpace: 'nowrap' }}>{formatUSDT(u.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {step.progress && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '2px' }}>
                  <div
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(step.progress.usedPct)}
                    aria-label={step.progress.caption}
                    style={{ position: 'relative', height: '8px', borderRadius: '4px', background: '#ECE7F0' }}
                  >
                    <div style={{ height: '8px', borderRadius: '4px', background: '#1A7F52', width: `${Math.min(100, step.progress.usedPct)}%` }} />
                    <div style={{ position: 'absolute', top: '-3px', bottom: '-3px', left: `${step.progress.thresholdPct}%`, borderLeft: '2px solid #1B1530' }} />
                  </div>
                  <span style={{ fontSize: '12px', color: '#5A5468' }}>{step.progress.caption}</span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
