import { defineChain } from 'viem'
import { env } from './env'

/**
 * ÚNICO lugar donde se configura la red.
 * Cuando tengamos los datos de la testnet del hackatón, se cambian aquí
 * (o vía variables VITE_CHAIN_*) y toda la app los toma.
 *
 * Placeholder actual: Base Sepolia (Privy la soporta nativo y tiene faucet gratis).
 */
export const CHAIN = defineChain({
  id: env.chain.id,
  name: env.chain.name,
  nativeCurrency: {
    name: env.chain.symbol,
    symbol: env.chain.symbol,
    decimals: 18,
  },
  rpcUrls: {
    default: { http: [env.chain.rpcUrl] },
  },
  blockExplorers: {
    default: {
      name: 'Explorer',
      url: env.chain.explorerUrl,
    },
  },
  testnet: true,
})

export const explorerTx = (hash: string) => `${CHAIN.blockExplorers!.default.url}/tx/${hash}`
export const explorerAddress = (addr: string) => `${CHAIN.blockExplorers!.default.url}/address/${addr}`
