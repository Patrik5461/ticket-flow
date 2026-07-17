import { createFileRoute, Link } from '@tanstack/react-router'
import { listEventsFn } from '../server/fns'

export const Route = createFileRoute('/')({
  loader: async () => ({ events: await listEventsFn() }),
  component: Landing,
})

function formatDateShort(iso: string, tz: string) {
  return new Intl.DateTimeFormat('sk-SK', {
    day: '2-digit',
    month: 'short',
    timeZone: tz,
  }).format(new Date(iso))
}
function formatTime(iso: string, tz: string) {
  return new Intl.DateTimeFormat('sk-SK', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  }).format(new Date(iso))
}

function Nav() {
  return (
    <nav className="sticky top-0 z-40 border-b border-ink-800/60 bg-ink-950/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <Link to="/" className="font-display text-xl font-bold tracking-tight">
          ticketio<span className="text-accent">.</span>
        </Link>
        <div className="hidden items-center gap-8 text-sm text-ink-300 md:flex">
          <a href="#events" className="hover:text-ink-100 transition">
            Podujatia
          </a>
          <a href="#how" className="hover:text-ink-100 transition">
            Ako to funguje
          </a>
          <a href="#pricing" className="hover:text-ink-100 transition">
            Cenník
          </a>
        </div>
        <div className="flex items-center gap-2">
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

function Footer() {
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

function Landing() {
  const { events } = Route.useLoaderData()

  return (
    <div className="min-h-screen">
      <Nav />

      {/* HERO */}
      <section
        className="relative overflow-hidden"
        style={{ background: 'var(--gradient-hero)' }}
      >
        <div className="mx-auto max-w-7xl px-6 pt-20 pb-28 md:pt-32 md:pb-40">
          <div className="grid items-center gap-12 lg:grid-cols-2">
            <div className="animate-fade-up">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-900/60 px-4 py-1.5 text-xs font-medium text-ink-300 backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_8px_var(--color-accent)]" />
                Nová generácia predaja vstupeniek
              </div>
              <h1 className="font-display text-5xl font-bold leading-[0.95] tracking-tight md:text-7xl lg:text-8xl">
                Vstupenky
                <br />
                <span className="text-accent">bez starostí.</span>
              </h1>
              <p className="mt-8 max-w-2xl text-lg text-ink-300 md:text-xl">
                Transparentný cenník bez skrytých poplatkov. Priebežný payout cez
                GoPay — peniaze máte na účte hneď, nie až po evente. Moderné
                odbavenie cez mobil.
              </p>
              <div className="mt-10 flex flex-wrap gap-3">
                <a href="#events" className="btn-primary">
                  Zobraziť podujatia
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M5 12h14M13 5l7 7-7 7" />
                  </svg>
                </a>
                <a href="#how" className="btn-ghost">
                  Ako to funguje
                </a>
              </div>

              {/* stats */}
              <div className="mt-16 grid max-w-2xl grid-cols-3 gap-6 border-t border-ink-800 pt-8">
                <div>
                  <div className="font-display text-3xl font-bold text-ink-100">
                    4 %
                  </div>
                  <div className="mt-1 text-xs text-ink-400">Nízka provízia</div>
                </div>
                <div>
                  <div className="font-display text-3xl font-bold text-ink-100">
                    24 h
                  </div>
                  <div className="mt-1 text-xs text-ink-400">Payout</div>
                </div>
                <div>
                  <div className="font-display text-3xl font-bold text-ink-100">
                    0 €
                  </div>
                  <div className="mt-1 text-xs text-ink-400">Zriadenie</div>
                </div>
              </div>
            </div>

            <div className="relative hidden md:block">
              <TicketPreview />
            </div>
          </div>

          <div className="mt-14 md:hidden">
            <TicketPreview compact />
          </div>
        </div>
      </section>

      {/* MARQUEE */}
      {events.length > 0 && (
        <section aria-label="Podujatia" className="border-y border-ink-800/60 bg-ink-900/30 py-8">
          <div className="marquee">
            <ul className="marquee-track" aria-hidden={events.length < 3 ? undefined : 'true'}>
              {[...events, ...events].map((e, idx) => {
                const cover = (e as unknown as { cover_url?: string | null }).cover_url
                const fromPrice = (e as unknown as { from_price_cents?: number | null }).from_price_cents
                return (
                  <li key={`${e.id}-${idx}`} className="shrink-0">
                    <Link
                      to="/e/$slug"
                      params={{ slug: e.slug }}
                      className="card-surface group flex w-[280px] items-center gap-3 overflow-hidden p-2 transition hover:border-accent/40"
                    >
                      <div
                        className="h-16 w-16 shrink-0 rounded-lg"
                        style={{
                          background: cover
                            ? `url(${cover}) center/cover`
                            : 'var(--gradient-fallback)',
                        }}
                      />
                      <div className="min-w-0 flex-1 pr-2">
                        <div className="truncate font-display text-sm font-semibold text-ink-100 transition group-hover:text-accent">
                          {e.title}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-ink-400">
                          {formatDateShort(e.starts_at, e.timezone)}
                          {e.venue_name ? ` · ${e.venue_name}` : ''}
                        </div>
                        {typeof fromPrice === 'number' && (
                          <div className="mt-0.5 text-xs text-ink-300">
                            od <span className="text-accent">{(fromPrice / 100).toFixed(0)} €</span>
                          </div>
                        )}
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>
      )}

      {/* EVENTS */}
      <section id="events" className="mx-auto max-w-7xl px-6 py-20">

        <div className="mb-10 flex items-end justify-between">
          <div>
            <div className="text-sm font-medium uppercase tracking-widest text-accent">
              Program
            </div>
            <h2 className="mt-2 font-display text-4xl font-bold md:text-5xl">
              Aktuálne podujatia
            </h2>
          </div>
        </div>

        {events.length === 0 ? (
          <div className="card-surface p-16 text-center">
            <p className="text-ink-400">
              Zatiaľ nie sú zverejnené žiadne podujatia.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {events.map((e, idx) => {
              const cover = (e as unknown as { cover_url?: string | null })
                .cover_url
              const fromPrice = (
                e as unknown as { from_price_cents?: number | null }
              ).from_price_cents
              return (
                <Link
                  key={e.id}
                  to="/e/$slug"
                  params={{ slug: e.slug }}
                  className="group card-surface animate-fade-up relative overflow-hidden transition-all duration-300 hover:-translate-y-1 hover:border-accent/40 hover:shadow-[0_20px_60px_-20px_var(--color-accent-glow)]"
                  style={{ animationDelay: `${idx * 60}ms` }}
                >
                  {/* Cover */}
                  <div
                    className="relative aspect-[4/3] w-full overflow-hidden"
                    style={{
                      background: cover
                        ? `url(${cover}) center/cover`
                        : 'var(--gradient-fallback)',
                    }}
                  >
                    <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/30 to-transparent" />
                    <div className="absolute left-4 top-4 flex flex-col items-center justify-center rounded-xl bg-ink-950/80 px-3 py-2 backdrop-blur-md">
                      <span className="font-display text-xs font-semibold uppercase text-accent">
                        {formatDateShort(e.starts_at, e.timezone).split(' ')[1]}
                      </span>
                      <span className="font-display text-xl font-bold leading-none">
                        {formatDateShort(e.starts_at, e.timezone).split(' ')[0]}
                      </span>
                    </div>
                    {typeof fromPrice === 'number' && (
                      <div className="absolute right-4 top-4 rounded-full bg-ink-950/80 px-3 py-1 text-xs font-medium backdrop-blur-md">
                        od{' '}
                        <span className="text-accent">
                          {(fromPrice / 100).toFixed(0)} €
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="p-5">
                    <h3 className="font-display text-xl font-bold leading-tight transition-colors group-hover:text-accent">
                      {e.title}
                    </h3>
                    <div className="mt-3 flex items-center gap-4 text-sm text-ink-400">
                      <span className="inline-flex items-center gap-1.5">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <circle cx="12" cy="12" r="10" />
                          <path d="M12 6v6l4 2" />
                        </svg>
                        {formatTime(e.starts_at, e.timezone)}
                      </span>
                      {e.venue_name && (
                        <span className="inline-flex items-center gap-1.5 truncate">
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                          >
                            <path d="M12 22s-8-7.5-8-13a8 8 0 1 1 16 0c0 5.5-8 13-8 13z" />
                            <circle cx="12" cy="9" r="3" />
                          </svg>
                          <span className="truncate">{e.venue_name}</span>
                        </span>
                      )}
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </section>

      {/* HOW IT WORKS */}
      <section id="how" className="border-t border-ink-800 bg-ink-900/40">
        <div className="mx-auto max-w-7xl px-6 py-24">
          <div className="max-w-2xl">
            <div className="text-sm font-medium uppercase tracking-widest text-accent">
              Ako to funguje
            </div>
            <h2 className="mt-2 font-display text-4xl font-bold md:text-5xl">
              Tri kroky k vypredanému eventu.
            </h2>
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {[
              {
                n: '01',
                t: 'Vytvor event',
                d: 'Za pár minút nastavíš typy vstupeniek, kapacitu a cenník. Bez integrácií, bez čakania.',
              },
              {
                n: '02',
                t: 'Predávaj',
                d: 'Zákazníci platia kartou cez GoPay a vstupenku s QR kódom dostanú okamžite mailom.',
              },
              {
                n: '03',
                t: 'Odbav a inkasuj',
                d: 'Pri vstupe sken cez našu appku — offline aj online. Payout ti príde priebežne na účet.',
              },
            ].map((s) => (
              <div key={s.n} className="card-surface p-8">
                <div className="font-display text-5xl font-bold text-accent">
                  {s.n}
                </div>
                <h3 className="mt-6 font-display text-2xl font-bold">{s.t}</h3>
                <p className="mt-3 text-ink-400 leading-relaxed">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
      <section id="pricing" className="mx-auto max-w-7xl px-6 py-24">
        <div className="max-w-2xl">
          <div className="text-sm font-medium uppercase tracking-widest text-accent">
            Cenník
          </div>
          <h2 className="mt-2 font-display text-4xl font-bold md:text-5xl">
            Jedna cena. Žiadne prekvapenia.
          </h2>
        </div>

        <div className="mt-14 grid gap-8 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div
            className="relative overflow-hidden rounded-2xl border border-accent/30 p-10"
            style={{
              background:
                'linear-gradient(135deg, rgba(74,222,128,0.08) 0%, rgba(74,222,128,0.02) 100%), var(--gradient-card)',
            }}
          >
            <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-accent/20 blur-3xl" />
            <div className="relative">
              <div className="text-xs font-semibold uppercase tracking-widest text-accent">
                Štandard
              </div>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="font-display text-7xl font-bold">4 %</span>
                <span className="text-ink-400">z ceny vstupenky</span>
              </div>
              <p className="mt-2 text-ink-400">
                alebo minimálne 0,40 € za predanú vstupenku
              </p>

              <ul className="mt-8 space-y-3 text-sm">
                {[
                  'Bez mesačných poplatkov',
                  'Priebežný payout (nie až po evente)',
                  'Neobmedzený počet eventov a typov vstupeniek',
                  'Offline mobilná appka na odbavenie',
                  'Slovenská podpora',
                ].map((f) => (
                  <li key={f} className="flex items-center gap-3">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent/20 text-accent">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="3"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    </span>
                    <span className="text-ink-200">{f}</span>
                  </li>
                ))}
              </ul>

              <a href="mailto:hello@ticketio.sk" className="btn-primary mt-10">
                Chcem predávať cez Ticketio
              </a>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card-surface p-6">
              <div className="text-sm text-ink-400">Konkurencia (Inviton)</div>
              <div className="mt-1 font-display text-2xl font-bold text-ink-300">
                5 % / min 0,60 €
              </div>
              <div className="mt-1 text-xs text-ink-500">
                Payout až po evente
              </div>
            </div>
            <div className="card-surface p-6 border-accent/40">
              <div className="text-sm text-accent">Ticketio</div>
              <div className="mt-1 font-display text-2xl font-bold">
                4 % / min 0,40 €
              </div>
              <div className="mt-1 text-xs text-ink-400">Priebežný payout</div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  )
}
