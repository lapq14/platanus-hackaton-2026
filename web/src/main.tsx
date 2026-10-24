import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PrivyProvider } from '@privy-io/react-auth'
import './index.css'
import App from './App'
import { CHAIN } from './lib/chain'

const PRIVY_APP_ID = import.meta.env.VITE_PRIVY_APP_ID as string | undefined

const app = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {PRIVY_APP_ID ? (
      <PrivyProvider
        appId={PRIVY_APP_ID}
        config={{
          loginMethods: ['google', 'email'],
          appearance: { theme: 'light', accentColor: '#16a34a' },
          embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
          defaultChain: CHAIN,
          supportedChains: [CHAIN],
        }}
      >
        {app}
      </PrivyProvider>
    ) : (
      // Sin App ID de Privy la app igual arranca (modo solo lectura) para no bloquear el desarrollo.
      app
    )}
  </StrictMode>,
)
