import { isAddress, zeroAddress } from 'viem'

/**
 * The only module that reads `import.meta.env`.
 * Validates once at module load and throws a single error listing every problem.
 */

export interface ChainEnv {
  id: number
  name: string
  symbol: string
  rpcUrl: string
  explorerUrl: string
}

export interface AppEnv {
  privyAppId: string
  supabaseUrl: string
  supabasePublishableKey: string
  chain: ChainEnv
}

const problems: string[] = []

const requiredValue = (name: string, value: string | undefined): string => {
  const v = value?.trim() ?? ''
  if (!v) problems.push(name)
  return v
}

const optional = (value: string | undefined, fallback: string): string => value?.trim() || fallback

const privyAppId = requiredValue('VITE_PRIVY_APP_ID', import.meta.env.VITE_PRIVY_APP_ID)
const supabaseUrl = requiredValue('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL)
const supabasePublishableKey = requiredValue(
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
)
// Legacy and optional: nothing in the app reads it. Format is only checked when a value is present.
const escrowRaw = import.meta.env.VITE_ESCROW_ADDRESS?.trim() ?? ''
if (escrowRaw && (!isAddress(escrowRaw, { strict: false }) || escrowRaw.toLowerCase() === zeroAddress)) {
  problems.push('VITE_ESCROW_ADDRESS (not a valid non-zero 0x address)')
}

const chainId = Number(optional(import.meta.env.VITE_CHAIN_ID, '84532'))
if (!Number.isInteger(chainId) || chainId <= 0) {
  problems.push('VITE_CHAIN_ID (not a positive integer)')
}

if (problems.length > 0) {
  throw new Error(`Missing or invalid environment variables: ${problems.join(', ')}. See web/.env.example.`)
}

export const env: Readonly<AppEnv> = Object.freeze({
  privyAppId,
  supabaseUrl,
  supabasePublishableKey,
  chain: Object.freeze({
    id: chainId,
    name: optional(import.meta.env.VITE_CHAIN_NAME, 'Base Sepolia'),
    symbol: optional(import.meta.env.VITE_CHAIN_SYMBOL, 'ETH'),
    rpcUrl: optional(import.meta.env.VITE_CHAIN_RPC, 'https://sepolia.base.org'),
    explorerUrl: optional(import.meta.env.VITE_CHAIN_EXPLORER, 'https://sepolia.basescan.org'),
  }),
})
