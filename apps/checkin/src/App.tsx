import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { SplashScreen } from '@capacitor/splash-screen'
import { ensureDarkStatusBar } from './lib/chrome'
import { clearOnOperatorChange } from './lib/offline'
import { runSync, startAutoSync } from './lib/sync'
import { supabase } from './lib/supabase'
import { Login } from './screens/Login'
import { EventList } from './screens/EventList'
import { Scanner } from './screens/Scanner'
import { ScanLogo } from './components/ScanLogo'
import type { EventRow } from './lib/types'

/**
 * Scan-only app: login → event list → scanner. Nothing else is reachable —
 * no admin, revenue, orders or settings — regardless of the account's role.
 */
export function App() {
  // undefined = still restoring the persisted session.
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [event, setEvent] = useState<EventRow | null>(null)

  useEffect(() => {
    void ensureDarkStatusBar()
    void SplashScreen.hide().catch(() => {})
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (data.session) void clearOnOperatorChange(data.session.user.id)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) setEvent(null)
      // Losing the session must NOT wipe local data. SIGNED_OUT fires for an
      // expired or revoked token just as it does for a deliberate sign-out, and
      // the queue holds admissions already granted at the door — sync.ts goes
      // out of its way to preserve them ("skeny zostávajú vo fronte"), so this
      // listener must not undo that. The wipe lives on the button that means it
      // (EventList.signOut), plus the operator-change check below.
      if (s) void clearOnOperatorChange(s.user.id)
    })

    // iOS resets the status bar on resume — re-assert it. (StatusBar only, so we
    // don't disturb the scanner if the app resumes onto it.)
    let removeResume: (() => void) | undefined
    if (Capacitor.isNativePlatform()) {
      void CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          void ensureDarkStatusBar()
          // Coming back from the background is the most reliable moment to
          // notice the network is back — iOS does not always fire 'online'.
          if (navigator.onLine) void runSync()
        }
      }).then((handle) => {
        removeResume = () => void handle.remove()
      })
    }

    return () => {
      sub.subscription.unsubscribe()
      removeResume?.()
    }
  }, [])

  // Flush the offline queue once signed in, and again whenever the network
  // comes back. Never while signed out — the requests would only 401.
  useEffect(() => {
    if (!session) return
    return startAutoSync()
  }, [session])

  if (session === undefined) {
    return (
      <div className="screen center">
        <ScanLogo size={80} />
      </div>
    )
  }
  if (!session) return <Login />
  if (!event) return <EventList onPick={setEvent} />
  return <Scanner event={event} onBack={() => setEvent(null)} />
}
