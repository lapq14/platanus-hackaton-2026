import type { TrancheState } from '../types'
import { formatUSDT } from '../lib/format'
import TxLink from './TxLink'
import TramoIcon from './TramoIcon'

export interface TimelineStep {
  state: TrancheState
  title: string
  amount: number
  description: string
  /** On-chain reference, rendered as `{prefix} 0x…` linking to the explorer. */
  hash?: { prefix: 'tx' | 'hash'; value: string }
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
            <div style={{ flex: '1', minWidth: '0', padding: last ? '6px 0 0' : '6px 0 24px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <strong style={{ fontSize: '17px' }}>{step.title}</strong>
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '17px', fontWeight: 600 }}>{formatUSDT(step.amount)}</span>
              </div>
              <span style={{ fontSize: '14px', color: '#5A5468' }}>{step.description}</span>
              {step.hash && (
                <TxLink
                  hash={step.hash.value}
                  label={step.hash.prefix}
                  style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', textDecoration: 'none' }}
                />
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
