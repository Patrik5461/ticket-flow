import { useSyncExternalStore } from 'react'
import { getSyncState, subscribeSync, type SyncState } from './sync'

/** Shared sync state — the event list and the scanner show the same numbers. */
export function useSync(): SyncState {
  return useSyncExternalStore(subscribeSync, getSyncState, getSyncState)
}

/** Connectivity, tracked with the webview's own events (no native plugin). */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      window.addEventListener('online', cb)
      window.addEventListener('offline', cb)
      return () => {
        window.removeEventListener('online', cb)
        window.removeEventListener('offline', cb)
      }
    },
    () => navigator.onLine,
    () => true,
  )
}
