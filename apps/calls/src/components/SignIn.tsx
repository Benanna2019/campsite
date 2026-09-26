import { useAuthActions } from '@convex-dev/auth/react'
import { useState } from 'react'

export function SignIn() {
  const { signIn } = useAuthActions()
  const [flow, setFlow] = useState<'signIn' | 'signUp'>('signIn')
  const [error, setError] = useState<string>()

  return (
    <main className='mx-auto mt-24 w-full max-w-sm px-4'>
      <h1 className='text-xl font-semibold'>Campsite Calls</h1>
      <form
        className='mt-6 flex flex-col gap-3'
        onSubmit={async (event) => {
          event.preventDefault()
          setError(undefined)
          const form = new FormData(event.currentTarget)
          form.set('flow', flow)
          try {
            await signIn('password', form)
          } catch {
            setError(flow === 'signIn' ? 'Wrong email or password.' : "Couldn't create that account.")
          }
        }}
      >
        {flow === 'signUp' && <input name='name' placeholder='Your name (shown in calls)' className='input' required />}
        <input name='email' type='email' placeholder='Email' className='input' required />
        <input name='password' type='password' placeholder='Password' className='input' required minLength={8} />
        <button className='btn-primary'>{flow === 'signIn' ? 'Sign in' : 'Create account'}</button>
        {error && <p className='text-sm text-red-600'>{error}</p>}
      </form>
      <button className='mt-4 text-sm text-neutral-500 underline' onClick={() => setFlow(flow === 'signIn' ? 'signUp' : 'signIn')}>
        {flow === 'signIn' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>
    </main>
  )
}
