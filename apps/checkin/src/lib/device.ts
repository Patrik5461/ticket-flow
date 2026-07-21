import { Preferences } from '@capacitor/preferences'

const KEY = 'offline.deviceId'

let cached: string | null = null

/**
 * Stable per-install device label, e.g. "Ticketio Scan · A3F91C". It is sent as
 * `deviceLabel` with every check-in (online and synced-offline alike), so the
 * organizer's check-in log shows which door phone admitted a holder — and which
 * device produced a conflicting scan.
 */
export async function deviceLabel(): Promise<string> {
  if (cached) return cached
  const { value } = await Preferences.get({ key: KEY })
  if (value) {
    cached = value
    return value
  }
  const label = `Ticketio Scan · ${crypto.randomUUID().slice(0, 6).toUpperCase()}`
  await Preferences.set({ key: KEY, value: label })
  cached = label
  return label
}
