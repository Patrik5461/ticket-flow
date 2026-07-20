import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { ScanLogo } from '../components/ScanLogo'

/** Screen 1 — sign in any organizer member (owner / admin / checkin role). */
export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

        <p className="hint" style={{ marginTop: 20, textAlign: 'center' }}>
          Prihlás sa účtom organizátora. Appka slúži len na skenovanie vstupeniek.
        </p>
      </div>
    </div>
  )
}
