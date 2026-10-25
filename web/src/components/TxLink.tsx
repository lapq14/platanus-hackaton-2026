import type { CSSProperties } from 'react'
import { explorerTx } from '../lib/chain'
import { shortHash } from '../lib/format'
import { isSimulatedHash } from '../lib/simulated'

interface TxLinkProps {
  hash: string
  /** Text shown before the short hash on real transactions (e.g. "tx"). */
  label?: string
  style?: CSSProperties
}

/** Explorer link for a real transaction; a non-link "Simulado" badge (full hash in the tooltip) for simulated ones. */
export default function TxLink({ hash, label, style }: TxLinkProps) {
  if (isSimulatedHash(hash)) {
    return (
      <span title={`Transacción simulada: ${hash}`} style={{ ...style, color: '#5A5468', cursor: 'help' }}>
        Simulado
      </span>
    )
  }
  return (
    <a href={explorerTx(hash)} target="_blank" rel="noopener noreferrer" style={style}>
      {label ? `${label} ` : ''}
      {shortHash(hash)} ↗
    </a>
  )
}
