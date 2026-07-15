import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { signInFn } from '../server/auth'

export const Route = createFileRoute('/login')({ component: LoginPage })

function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const res = await signInFn({ data: { email: email.trim(), password } })
    if (res.error) {
      setError(res.error)
      setSubmitting(false)
      return
    }
    await navigate({ to: '/app' })
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-bold">Prihlásenie</h1>
      <p className="mt-1 text-sm text-gray-600">Organizátorský portál Ticketio</p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">E-mail</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Heslo</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </div>

        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Prihlasujem…' : 'Prihlásiť sa'}
        </button>
      </form>

      <p className="mt-4 text-sm text-gray-600">
        Nemáte účet?{' '}
        <Link to="/register" className="text-indigo-600 hover:underline">
          Zaregistrujte sa
        </Link>
      </p>
    </div>
  )
}
