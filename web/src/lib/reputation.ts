import type { ReputationState } from '../types'

export const REPUTATION_LABELS: Record<ReputationState, string> = {
  sin_historial: 'Sin historial',
  en_construccion: 'En construcción',
  confiable: 'Confiable',
  inconfiable: 'Inconfiable',
}

export const reputationLabel = (state: ReputationState): string => REPUTATION_LABELS[state]
