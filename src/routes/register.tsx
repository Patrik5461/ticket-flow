import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { signUpFn } from '../server/auth'

export const Route = createFileRoute('/register')({ component: RegisterPage })

function RegisterPage() {
  const navigate = useNavigate()
  const [organizerName, setOrganizerName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setInfo(null)
    setSubmitting(true)
    const res = await signUpFn({
      data: { email: email.trim(), password, organizerName: organizerName.trim() },
    })
    if (res.error) {
      setError(res.error)
      setSubmitting(false)
      return
    }
    if (res.needsConfirmation) {
      setInfo('Účet vytvorený. Potvrďte e-mail a potom sa prihláste.')
      setSubmitting(false)
      return
    }
    await navigate({ to: '/app' })
  }

  return (
    <div className="mx-auto max-w-sm px-6 py-16">
      <h1 className="text-2xl font-bold">Registrácia organizátora</h1>
      <p className="mt-1 text-sm text-gray-600">Vytvorte si účet a predávajte vstupenky.</p>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">Názov organizátora</label>
          <input
            required
            value={organizerName}
            onChange={(e) => setOrganizerName(e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
        </div>
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
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border px-3 py-2"
          />
          <p className="mt-1 text-xs text-gray-500">Aspoň 8 znakov.</p>
        </div>

        {error && (
          <p className="rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>
        )}
        {info && (
          <p className="rounded-md bg-green-50 p-3 text-sm text-green-700">{info}</p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-md bg-indigo-600 px-5 py-2.5 font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Vytváram…' : 'Vytvoriť účet'}
        </button>
      </form>

      <p className="mt-4 text-sm text-gray-600">
        Už máte účet?{' '}
        <Link to="/login" className="text-indigo-600 hover:underline">
          Prihláste sa
        </Link>
      </p>
    </div>
  )
}
