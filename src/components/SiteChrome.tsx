import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'

import { ThemeToggle } from './ThemeToggle'

/**
 * Site-wide event search. Submitting hands the term to /podujatia, which owns
 * the actual query — the header only has to get the visitor there.
 */
function NavSearch({ className = '' }: { className?: string }) {
  const navigate = useNavigate()
  const [term, setTerm] = useState('')

  return (
    <form
      role="search"
      // A plain GET form underneath, so the header search works before React
      // has booted — with scripting the handler below takes over.
      method="get"
      action="/podujatia"
      onSubmit={(e) => {
        e.preventDefault()
        void navigate({
          to: '/podujatia',
          search: { ...PROGRAM_SEARCH, q: term.trim() },
        })
      }}
      className={`relative ${className}`}
    >
      <svg
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
      <input
        type="search"
        name="q"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Hľadať podujatie…"
        aria-label="Hľadať podujatie"
        className="w-44 rounded-full border border-ink-800 bg-ink-900/60 py-1.5 pl-9 pr-3 text-sm text-ink-100 transition placeholder:text-ink-500 focus:w-56 focus:border-accent/60 focus:outline-none"
      />
    </form>
  )
}

const NAV_LINKS = [
  { to: '/podujatia' as const, label: 'Podujatia' },
  { to: '/ako-to-funguje' as const, label: 'Ako to funguje' },
  { to: '/cennik' as const, label: 'Cenník' },
]

/**
 * The same nav, for phones.
 *
 * Below md the links used to be `hidden` with nothing taking their place, so a
 * phone could reach the program only by typing the URL. A <details> again: the
 * panel opens without scripting and the links are in the served HTML.
 */
function MobileMenu() {
  const ref = useRef<HTMLDetailsElement>(null)
  const close = () => {
    if (ref.current) ref.current.open = false
  }

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const el = ref.current
      if (el?.open && !el.contains(e.target as Node)) el.open = false
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  return (
    <details ref={ref} className="group relative md:hidden">
      <summary
        aria-label="Menu"
        className="grid h-9 w-9 cursor-pointer list-none place-items-center rounded-full text-ink-200 transition hover:bg-ink-800 [&::-webkit-details-marker]:hidden"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M4 7h16M4 12h16M4 17h16" className="group-open:hidden" />
          <path d="M6 6l12 12M18 6L6 18" className="hidden group-open:block" />
        </svg>
      </summary>

      <div className="absolute right-0 z-50 mt-2 w-56 rounded-xl border border-ink-700 bg-ink-900 p-2 shadow-2xl">
        {NAV_LINKS.map((l) => (
          <Link
            key={l.to}
            to={l.to}
            search={l.to === '/podujatia' ? PROGRAM_SEARCH : undefined}
            onClick={close}
            className="block rounded-lg px-3 py-2.5 text-sm text-ink-200 transition hover:bg-ink-800 hover:text-ink-100"
            activeProps={{ className: 'bg-ink-800 text-ink-100' }}
          >
            {l.label}
          </Link>
        ))}
        <div className="my-1 border-t border-ink-800" />
        <Link
          to="/login"
          onClick={close}
          className="block rounded-lg px-3 py-2.5 text-sm text-ink-200 transition hover:bg-ink-800 hover:text-ink-100"
        >
          Prihlásiť sa
        </Link>
        <div className="flex items-center justify-between px-3 py-2.5 text-sm text-ink-400">
          Vzhľad
          <ThemeToggle />
        </div>
      </div>
    </details>
  )
}

/** Every link into the program carries the full filter state. */
const PROGRAM_SEARCH = { q: '', kat: '', mesto: '', page: 1 }

/**
 * Header and footer of the public site.
 *
 * They used to live inside the landing route, which is why the nav pointed at
 * `#events` / `#how` / `#pricing` — everything was one page. Now that the
 * program has its own route, both are shared so a nav change lands on every
 * public page at once.
 */
export function SiteNav() {
  return (
    <nav className="sticky top-0 z-40 border-b border-ink-800/60 bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link
          to="/"
          className="font-display text-2xl font-bold tracking-tight sm:text-3xl"
        >
          ticketio<span className="text-accent">.</span>
        </Link>
        <div className="hidden items-center gap-8 text-sm text-ink-300 md:flex">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.to}
              to={l.to}
              search={l.to === '/podujatia' ? PROGRAM_SEARCH : undefined}
              className="transition hover:text-ink-100"
              activeProps={{ className: 'text-ink-100' }}
            >
              {l.label}
            </Link>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <NavSearch className="hidden lg:block" />
          {/* Below lg the input would crowd the bar out, so the icon just
              hands the visitor to the program, which has its own search. */}
          <Link
            to="/podujatia"
            search={PROGRAM_SEARCH}
            aria-label="Hľadať podujatie"
            // Not on the narrowest phones: logo, CTA and the menu button
            // already fill a 390 px bar, and the program page carries its own
            // search box one tap away.
            className="hidden h-9 w-9 place-items-center rounded-full text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 sm:grid lg:hidden"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
          </Link>
          <ThemeToggle className="hidden sm:inline-flex" />
          <Link
            to="/login"
            className="hidden text-sm text-ink-300 transition hover:text-ink-100 sm:inline-flex sm:px-3 sm:py-1.5"
          >
            Prihlásiť sa
          </Link>
          <Link to="/register" className="btn-primary text-sm">
            Predávať vstupenky
          </Link>
          <MobileMenu />
        </div>
      </div>
    </nav>
  )
}

export function SiteFooter() {
  return (
    <footer className="mt-32 border-t border-ink-800 bg-ink-950">
      <div className="mx-auto grid max-w-7xl gap-8 px-6 py-14 md:grid-cols-3">
        <div>
          <div className="font-display text-2xl font-bold">
            ticketio<span className="text-accent">.</span>
          </div>
          <p className="mt-3 max-w-xs text-sm text-ink-400">
            Slovenská platforma na predaj vstupeniek pre moderných
            organizátorov.
          </p>
        </div>
        <div className="text-sm">
          <div className="mb-3 font-semibold text-ink-200">Platforma</div>
          <ul className="space-y-2 text-ink-400">
            <li>
              <a href="/podujatia" className="hover:text-ink-100">
                Podujatia
              </a>
            </li>
            <li>
              <a href="/ako-to-funguje" className="hover:text-ink-100">
                Ako to funguje
              </a>
            </li>
            <li>
              <a href="/cennik" className="hover:text-ink-100">
                Cenník
              </a>
            </li>
            <li>
              <a href="/login" className="text-accent hover:brightness-110">
                Pre organizátorov →
              </a>
            </li>
            <li>
              <a href="/kontakt" className="hover:text-ink-100">
                Kontakt
              </a>
            </li>
          </ul>
        </div>
        <div className="text-sm">
          <div className="mb-3 font-semibold text-ink-200">Právne</div>
          <ul className="space-y-2 text-ink-400">
            <li>
              <a href="/obchodne-podmienky" className="hover:text-ink-100">
                Obchodné podmienky
              </a>
            </li>
            <li>
              <a href="/gdpr" className="hover:text-ink-100">
                Ochrana osobných údajov
              </a>
            </li>
            <li>
              <a href="/cookies" className="hover:text-ink-100">
                Cookies
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="border-t border-ink-800">
        <div className="mx-auto max-w-7xl px-6 py-6 text-xs text-ink-500">
          © {new Date().getFullYear()} Ticketio. Všetky práva vyhradené.
        </div>
      </div>
    </footer>
  )
}
