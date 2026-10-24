// Utilidades compartidas por las Edge Functions de Trazo.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { createPublicClient, createWalletClient, defineChain, http } from 'npm:viem@2'
import { privateKeyToAccount } from 'npm:viem@2/accounts'

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  })
}

export function env(name: string): string {
  const v = Deno.env.get(name)
  if (!v) throw new Error(`Falta la variable de entorno ${name}`)
  return v
}

/** Cliente con service role: salta RLS. Solo usar en el servidor. */
export const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'))

export const chain = defineChain({
  id: Number(Deno.env.get('CHAIN_ID') ?? 84532),
  name: 'Trazo chain',
  nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [Deno.env.get('CHAIN_RPC') ?? 'https://sepolia.base.org'] } },
})

export const publicClient = createPublicClient({ chain, transport: http() })

/** Wallet de custodia: firma liberaciones y reembolsos. */
export function escrowWallet() {
  const account = privateKeyToAccount(env('ESCROW_PRIVATE_KEY') as `0x${string}`)
  return { account, client: createWalletClient({ account, chain, transport: http() }) }
}
