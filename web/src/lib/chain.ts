import { defineChain } from 'viem'

/**
 * ÚNICO lugar donde se configura la red.
 * Cuando tengamos los datos de la testnet del hackatón, se cambian aquí
 * (o vía variables VITE_CHAIN_*) y toda la app los toma.
 *
 * Placeholder actual: Base Sepolia (Privy la soporta nativo y tiene faucet gratis).
 */
const env = import.meta.env

export const CHAIN = defineChain({
  id: Number(env.VITE_CHAIN_ID ?? 84532),
  name: env.VITE_CHAIN_NAME ?? 'Base Sepolia',
  nativeCurrency: {
    name: env.VITE_CHAIN_SYMBOL ?? 'ETH',
    symbol: env.VITE_CHAIN_SYMBOL ?? 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [env.VITE_CHAIN_RPC ?? 'https://sepolia.base.org'] },
  },
  blockExplorers: {
    default: {
      name: 'Explorer',
      url: env.VITE_CHAIN_EXPLORER ?? 'https://sepolia.basescan.org',
    },
  },
  testnet: true,
})

/** Wallet de custodia (escrow) de la plataforma. Las donaciones se depositan aquí. */
export const ESCROW_ADDRESS = (env.VITE_ESCROW_ADDRESS ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`

export const explorerTx = (hash: string) => `${CHAIN.blockExplorers!.default.url}/tx/${hash}`
export const explorerAddress = (addr: string) => `${CHAIN.blockExplorers!.default.url}/address/${addr}`
