/**
 * Network guards.
 *
 * In airplane mode a request from the webview does not fail — it just never
 * settles. Every call the app makes to the outside world therefore has a
 * deadline, so the UI can fall back to local data instead of spinning forever.
 *
 * The timeout does not cancel the underlying request (CapacitorHttp has no
 * abort); it only stops the app from waiting on it.
 */
export class TimeoutError extends Error {
  constructor(label: string) {
    super(`Časový limit vypršal (${label}).`)
  }
}

export function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  label = 'požiadavka',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(label)), ms)
    work.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}
