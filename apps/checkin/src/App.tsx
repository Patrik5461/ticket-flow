import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { Capacitor } from '@capacitor/core'
import { App as CapApp } from '@capacitor/app'
import { SplashScreen } from '@capacitor/splash-screen'
import { ensureDarkStatusBar } from './lib/chrome'
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
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s)
      if (!s) setEvent(null)
    })

    // iOS resets the status bar on resume — re-assert it. (StatusBar only, so we
    // don't disturb the scanner if the app resumes onto it.)
    let removeResume: (() => void) | undefined
    if (Capacitor.isNativePlatform()) {
      void CapApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) void ensureDarkStatusBar()
      }).then((handle) => {
        removeResume = () => void handle.remove()
      })
    }

    return () => {
      sub.subscription.unsubscribe()
      removeResume?.()
    }
  }, [])

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
