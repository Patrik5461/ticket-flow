import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'

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
      onSubmit={(e) => {
        e.preventDefault()
        void navigate({
          to: '/podujatia',
          search: { q: term.trim(), kat: '', mesto: '', page: 1 },
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
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        placeholder="Hľadať podujatie…"
        aria-label="Hľadať podujatie"
        className="w-44 rounded-full border border-ink-800 bg-ink-900/60 py-1.5 pl-9 pr-3 text-sm text-ink-100 transition placeholder:text-ink-500 focus:w-56 focus:border-accent/60 focus:outline-none"
      />
    </form>
  )
}

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
          <Link
            to="/podujatia"
            search={{ q: '', kat: '', mesto: '', page: 1 }}
            className="transition hover:text-ink-100"
            activeProps={{ className: 'text-ink-100' }}
          >
            Podujatia
          </Link>
          <Link
            to="/ako-to-funguje"
            className="transition hover:text-ink-100"
            activeProps={{ className: 'text-ink-100' }}
          >
            Ako to funguje
          </Link>
          <Link
            to="/cennik"
            className="transition hover:text-ink-100"
            activeProps={{ className: 'text-ink-100' }}
          >
            Cenník
          </Link>
        </div>
        <div className="flex items-center gap-2">
          <NavSearch className="hidden lg:block" />
          {/* Below lg the input would crowd the bar out, so the icon just
              hands the visitor to the program, which has its own search. */}
          <Link
            to="/podujatia"
            search={{ q: '', kat: '', mesto: '', page: 1 }}
            aria-label="Hľadať podujatie"
            className="grid h-9 w-9 place-items-center rounded-full text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 lg:hidden"
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
