import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { PrivyProvider } from '@privy-io/react-auth'
import './index.css'
import App from './App'
import { CHAIN } from './lib/chain'
import { env } from './lib/env'
import { CurrentUserProvider } from './context/CurrentUserProvider'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PrivyProvider
      appId={env.privyAppId}
      config={{
        loginMethods: ['google', 'email'],
        appearance: { theme: 'light', accentColor: '#16a34a' },
        embeddedWallets: { ethereum: { createOnLogin: 'users-without-wallets' } },
        defaultChain: CHAIN,
        supportedChains: [CHAIN],
      }}
    >
      <CurrentUserProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </CurrentUserProvider>
    </PrivyProvider>
  </StrictMode>,
)
