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
    <div
      className="relative min-h-screen flex items-center justify-center px-6 py-16"
      style={{ background: 'var(--gradient-hero), var(--color-ink-950)' }}
    >
      <div className="w-full max-w-md animate-fade-up">
        <div className="mb-8 text-center">
          <Link to="/" className="inline-block">
            <span className="font-display text-3xl font-bold tracking-tight">
              ticket<span style={{ color: 'var(--color-accent)' }}>io</span>
            </span>
          </Link>
          <h1 className="mt-6 font-display text-3xl font-bold text-ink-100">
            Registrácia organizátora
          </h1>
          <p className="mt-2 text-sm text-ink-400">
            Vytvorte si účet a predávajte vstupenky.
          </p>
        </div>

        <div className="card-surface p-8" style={{ boxShadow: 'var(--shadow-glow)' }}>
          <form onSubmit={submit} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-400">
                Názov organizátora
              </label>
              <input
                required
                value={organizerName}
                onChange={(e) => setOrganizerName(e.target.value)}
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-4 py-2.5 text-ink-100 placeholder:text-ink-500 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
                placeholder="Napr. Klub XYZ"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-400">
                E-mail
              </label>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-4 py-2.5 text-ink-100 placeholder:text-ink-500 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
                placeholder="vas@email.sk"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium uppercase tracking-wider text-ink-400">
                Heslo
              </label>
              <input
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-4 py-2.5 text-ink-100 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/30"
                placeholder="••••••••"
              />
              <p className="mt-1.5 text-xs text-ink-500">Aspoň 8 znakov.</p>
            </div>

            {error && (
              <p className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
                {error}
              </p>
            )}
            {info && (
              <p
                className="rounded-lg border p-3 text-sm"
                style={{
                  borderColor: 'color-mix(in oklab, var(--color-accent) 30%, transparent)',
                  background: 'color-mix(in oklab, var(--color-accent) 10%, transparent)',
                  color: 'var(--color-accent)',
                }}
              >
                {info}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Vytváram…' : 'Vytvoriť účet'}
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-ink-400">
          Už máte účet?{' '}
          <Link
            to="/login"
            className="font-medium transition hover:underline"
            style={{ color: 'var(--color-accent)' }}
          >
            Prihláste sa
          </Link>
        </p>
      </div>
    </div>
  )
}
