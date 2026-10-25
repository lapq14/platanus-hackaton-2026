import { usePrivy } from '@privy-io/react-auth'
import { PrimaryButton } from './Buttons'

/** Shown by donor pages when there is no session. */
export default function SignInPrompt({ message }: { message: string }) {
  const { login } = usePrivy()
  return (
    <div style={{ maxWidth: '420px', margin: '0 auto', padding: '96px 24px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', textAlign: 'center' }}>
      <p style={{ margin: 0, fontSize: '18px', color: '#5A5468' }}>{message}</p>
      <PrimaryButton onClick={login}>Entrar con Google</PrimaryButton>
    </div>
  )
}
