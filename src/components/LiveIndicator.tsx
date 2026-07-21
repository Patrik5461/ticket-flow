import { useEffect, useState } from 'react'
import type { LiveMode } from '../lib/use-live-sales'

/**
 * Connection state of the live dashboard: a green pulsing dot while the stream
 * is up, and an honest "Aktualizované pred X" while we are only polling — the
 * user should never think they are seeing live numbers when they are not.
 */
export function LiveIndicator({
  mode,
  updatedAt,
}: {
  mode: LiveMode
  updatedAt: number | null
}) {
  // Re-render every 10 s so the relative age stays truthful while polling.
  const [, tick] = useState(0)
  useEffect(() => {
    if (mode === 'live') return
    const id = setInterval(() => tick((n) => n + 1), 10_000)
    return () => clearInterval(id)
  }, [mode])

  if (mode === 'live') {
    return (
      <span
        className="inline-flex items-center gap-2 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-medium text-green-700"
        title="Údaje sa aktualizujú automaticky"
      >
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-500 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
        </span>
        Naživo
      </span>
    )
  }

  const label =
    mode === 'connecting'
      ? 'Pripájam…'
      : `Aktualizované ${relativeAge(updatedAt)}`

  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600"
      title="Živé spojenie sa nepodarilo nadviazať — obnovujem každých 30 sekúnd"
    >
      <span className="h-2 w-2 rounded-full bg-gray-400" />
      {label}
    </span>
  )
}

function relativeAge(updatedAt: number | null): string {
  if (!updatedAt) return 'teraz'
  const seconds = Math.max(0, Math.round((Date.now() - updatedAt) / 1000))
  if (seconds < 15) return 'práve teraz'
  if (seconds < 60) return `pred ${seconds} s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `pred ${minutes} min`
  return `pred ${Math.round(minutes / 60)} h`
}
