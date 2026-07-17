import { useEffect, useState } from 'react'

/**
 * Light/dark theme toggle. State is persisted in localStorage under `theme`.
 * A pre-hydration script in __root.tsx applies the saved class synchronously
 * to avoid a flash of the wrong theme.
 */
export function ThemeToggle({ className = '' }: { className?: string }) {
  const [mounted, setMounted] = useState(false)
  const [isLight, setIsLight] = useState(false)

  useEffect(() => {
    setMounted(true)
    setIsLight(document.documentElement.classList.contains('light'))
  }, [])

  const toggle = () => {
    const next = !isLight
    setIsLight(next)
    const root = document.documentElement
    if (next) root.classList.add('light')
    else root.classList.remove('light')
    try {
      localStorage.setItem('theme', next ? 'light' : 'dark')
    } catch {
      /* ignore storage errors */
    }
  }

  // Render a neutral placeholder before hydration so the layout is stable
  // and no icon flashes with the wrong state.
  const label = mounted
    ? isLight
      ? 'Prepnúť na tmavý režim'
      : 'Prepnúť na svetlý režim'
    : 'Prepnúť režim'

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={
        'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-ink-700 text-ink-200 transition hover:border-ink-500 hover:text-ink-100 ' +
        className
      }
    >
      {mounted && isLight ? (
        // Moon (currently light → click to dark)
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      ) : (
        // Sun (currently dark → click to light)
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
      )}
    </button>
  )
}
