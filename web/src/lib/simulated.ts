/**
 * Mirror of `isSimulatedHash` in supabase/functions/_shared/core.ts.
 * Simulated chain mode (the default) stores hashes starting with this marker: 0x + ASCII "simul".
 * Keep both in sync.
 */
export const SIMULATED_HASH_PREFIX = '0x73696d756c'

export const isSimulatedHash = (hash: string): boolean => hash.toLowerCase().startsWith(SIMULATED_HASH_PREFIX)
