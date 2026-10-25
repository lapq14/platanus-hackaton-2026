import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePrivy } from '@privy-io/react-auth'

/** Prefix of every sessionStorage key the app writes (registration draft, pending donation, redirects). */
const STORAGE_PREFIX = 'rastro:'

function clearAppStorage() {
  for (const key of Object.keys(sessionStorage)) {
    if (key.startsWith(STORAGE_PREFIX)) sessionStorage.removeItem(key)
  }
}

/**
 * Full sign-out: ends the Privy session (token + embedded wallet), drops every app value kept in
 * sessionStorage (so the next person on this browser never sees the previous draft) and goes home.
 * Single entry point for every "Salir" button.
 */
export function useLogout() {
  const { logout } = usePrivy()
  const navigate = useNavigate()

  return useCallback(async () => {
    try {
      await logout()
    } finally {
      clearAppStorage()
      void navigate('/', { replace: true })
    }
  }, [logout, navigate])
}
