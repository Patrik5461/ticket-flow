import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { queueCount } from '../lib/queue'
import { ScanLogo } from '../components/ScanLogo'

/** Slovak counts: 1 sken, 2-4 skeny, 5+ skenov. */
function scansWord(n: number): string {
  if (n === 1) return 'neodoslaný sken'
  if (n < 5) return 'neodoslané skeny'
  return 'neodoslaných skenov'
}

/** Screen 1 — sign in any organizer member (owner / admin / checkin role). */
export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  // Admissions can survive an expired session, so say so — otherwise the queue
  // is invisible here and the operator cannot know it still matters which
  // account they sign back in with.
  const [pending, setPending] = useState(0)

  useEffect(() => {
    void queueCount().then(setPending)
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setBusy(false)
    // On success the App's auth listener swaps to the event list.
    if (err) setError('Nesprávny e-mail alebo heslo.')
  }

  return (
    <div className="screen center safe" style={{ padding: 24 }}>
      <div style={{ width: '100%', maxWidth: 380 }}>
        <div className="center" style={{ flexDirection: 'column', gap: 12 }}>
          <ScanLogo size={72} />
          <div style={{ textAlign: 'center' }}>
            <div className="brand-mark" style={{ fontSize: 26 }}>
              ticket<span className="accent">io</span>
            </div>
            <div className="brand-sub">Scan</div>
          </div>
        </div>

        <form onSubmit={submit} style={{ marginTop: 32 }}>
          <label className="field-label">E-mail</label>
          <input
            className="field"
            type="email"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="vas@email.sk"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <label className="field-label" style={{ marginTop: 16 }}>
            Heslo
          </label>
          <input
            className="field"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && <p className="form-error">{error}</p>}

          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', minHeight: 56, marginTop: 24 }}
            disabled={busy || !email || !password}
          >
            {busy ? 'Prihlasujem…' : 'Prihlásiť sa'}
          </button>
        </form>

        {pending > 0 && (
          <p className="hint" style={{ marginTop: 20, textAlign: 'center' }}>
            Máš <strong>{pending}</strong> {scansWord(pending)}. Prihlás sa{' '}
            <strong>tým istým účtom</strong> — odošlú sa automaticky. Iný účet
            ich zmaže.
          </p>
        )}

        <p className="hint" style={{ marginTop: 20, textAlign: 'center' }}>
          Prihlás sa účtom organizátora. Appka slúži len na skenovanie vstupeniek.
        </p>
      </div>
    </div>
  )
}
