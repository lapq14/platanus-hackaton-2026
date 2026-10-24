/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PRIVY_APP_ID?: string
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  readonly VITE_ESCROW_ADDRESS?: string
  readonly VITE_CHAIN_ID?: string
  readonly VITE_CHAIN_NAME?: string
  readonly VITE_CHAIN_SYMBOL?: string
  readonly VITE_CHAIN_RPC?: string
  readonly VITE_CHAIN_EXPLORER?: string
}

interface ViteTypeOptions {
  strictImportMetaEnv: unknown
}
