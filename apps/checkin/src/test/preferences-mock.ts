/**
 * In-memory stand-in for @capacitor/preferences.
 *
 * The map lives at module scope, so re-importing the app modules (vi.resetModules)
 * simulates an APP RESTART: fresh module state, same persisted storage — exactly
 * what a queued admission has to survive.
 */
export const prefStore = new Map<string, string>()

export const Preferences = {
  get: ({ key }: { key: string }) =>
    Promise.resolve({ value: prefStore.get(key) ?? null }),
  set: ({ key, value }: { key: string; value: string }) => {
    prefStore.set(key, value)
    return Promise.resolve()
  },
  remove: ({ key }: { key: string }) => {
    prefStore.delete(key)
    return Promise.resolve()
  },
  clear: () => {
    prefStore.clear()
    return Promise.resolve()
  },
  keys: () => Promise.resolve({ keys: [...prefStore.keys()] }),
}
