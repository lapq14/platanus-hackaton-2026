export type LoginIntent = 'donor' | 'ong'

const KEY = 'trazo:login-intent'

/** Remembers which door the user picked on the welcome page so post-login routing can honor it. */
export const saveIntent = (intent: LoginIntent) => localStorage.setItem(KEY, intent)

export const readIntent = (): LoginIntent | null => {
  const v = localStorage.getItem(KEY)
  return v === 'donor' || v === 'ong' ? v : null
}

export const clearIntent = () => localStorage.removeItem(KEY)
