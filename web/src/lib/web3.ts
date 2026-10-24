import { createPublicClient, formatEther, http } from 'viem'
import { CHAIN } from './chain'

/** Cliente de solo lectura (balances, recibos). No firma nada. */
export const publicClient = createPublicClient({ chain: CHAIN, transport: http() })

export async function getBalanceEth(address: `0x${string}`): Promise<number> {
  const wei = await publicClient.getBalance({ address })
  return Number(formatEther(wei))
}

export function fmt(n: number | string, decimals = 4) {
  return Number(n).toLocaleString('es-VE', { maximumFractionDigits: decimals })
}

export const SYMBOL = CHAIN.nativeCurrency.symbol

/** Faucet para fondos de prueba (cambiar cuando tengamos la testnet del hackatón). */
export const FAUCET_URL =
  import.meta.env.VITE_FAUCET_URL ?? 'https://portal.cdp.coinbase.com/products/faucet'
