import {
  createFileRoute,
  notFound,
  useNavigate,
  Link,
} from '@tanstack/react-router'
import { useState } from 'react'
import { getEventFn, joinWaitlistFn } from '../server/fns'
import { getEventSeatMapFn } from '../server/seat-map'
import { SeatPicker } from '../components/SeatPicker'
import { formatEur } from '../lib/money'
import { formatSk } from '../lib/datetime'
import { EventAnalytics } from '../components/EventAnalytics'
import { absoluteUrl } from '../lib/site'
import { eventJsonLd, metaDescription } from '../lib/seo'

export const Route = createFileRoute('/e/$slug/')({
  loader: async ({ params }) => {
    const [data, seatMap] = await Promise.all([
      getEventFn({ data: { slug: params.slug } }),
      getEventSeatMapFn({ data: { slug: params.slug } }),
    ])
    if (!data) throw notFound()
    // Format the date here (once, server-side for SSR) and pass the string down.
    // Intl.DateTimeFormat's sk-SK output differs between Node's ICU (server) and
    // the browser's ICU (Safari uses commas, Node uses "o"), which is a React
    // hydration text mismatch (#418) that breaks the page on mobile Safari.
    const whenLabel = formatDate(data.event.starts_at, data.event.timezone)
    return { ...data, seatMap, whenLabel }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { event } = loaderData
    const url = absoluteUrl(`/e/${event.slug}`)
    const image = event.cover_url ?? absoluteUrl(`/api/og/${event.slug}`)
    const whenLabel = formatSk(event.starts_at, 'long', event.timezone)
    const title = `${event.title} — Ticketio`
    const description = metaDescription(event, whenLabel)
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: event.title },
        { property: 'og:description', content: description },
        { property: 'og:type', content: 'website' },
        { property: 'og:url', content: url },
        { property: 'og:image', content: image },
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:image', content: image },
      ],
      links: [{ rel: 'canonical', href: url }],
    }
  },
  component: EventPage,
})

function formatDate(iso: string, tz: string) {
  return formatSk(iso, 'full', tz)
}

function Stepper({
  value,
  max,
  onChange,
  disabled,
}: {
  value: number
  max: number
  onChange: (n: number) => void
  disabled?: boolean
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-xl border border-ink-700 bg-ink-900 p-1">
      <button
        type="button"
        disabled={disabled || value <= 0}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="grid h-9 w-9 place-items-center rounded-lg text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="Menej"
      >
        −
      </button>
      <span className="min-w-8 text-center font-display text-lg font-bold tabular-nums">
        {value}
      </span>
      <button
        type="button"
        disabled={disabled || value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="grid h-9 w-9 place-items-center rounded-lg text-ink-300 transition hover:bg-ink-800 hover:text-ink-100 disabled:opacity-30 disabled:hover:bg-transparent"
        aria-label="Viac"
      >
        +
      </button>
    </div>
  )
}

function WaitlistWatch({
  slug,
  ticketTypeId,
}: {
  slug: string
  ticketTypeId: string
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const res = await joinWaitlistFn({
        data: { slug, ticketTypeId, email: email.trim() },
      })
      if (res.ok) {
        setMsg({ ok: true, text: 'Dáme vám vedieť, keď sa uvoľní miesto.' })
        setEmail('')
      } else {
        setMsg({ ok: false, text: res.message ?? 'Nepodarilo sa uložiť.' })
      }
    } catch {
      setMsg({ ok: false, text: 'Nepodarilo sa uložiť. Skúste znova.' })
    } finally {
      setBusy(false)
    }
  }

  if (!open && !msg) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-ink-700 px-2.5 py-1 text-xs font-medium text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
      >
        Strážiť dostupnosť
      </button>
    )
  }

  return (
    <div className="w-full max-w-[220px]">
      {msg?.ok ? (
        <p className="text-xs text-emerald-400">{msg.text}</p>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-1.5">
          <input
            type="email"
            required
            value={email}
            onChange={(ev) => setEmail(ev.target.value)}
            placeholder="vas@email.sk"
            className="w-full rounded-lg border border-ink-700 bg-ink-900 px-2.5 py-1.5 text-xs text-ink-100 placeholder:text-ink-500 outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-accent px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy ? 'Ukladám…' : 'Upozorniť ma'}
          </button>
          {msg && !msg.ok && <p className="text-xs text-red-400">{msg.text}</p>}
        </form>
      )}
    </div>
  )
}

/** 1 vstupenka · 2–4 vstupenky · 5+ vstupeniek */
function ticketWord(n: number): string {
  if (n === 1) return 'vstupenka'
  return n >= 2 && n <= 4 ? 'vstupenky' : 'vstupeniek'
}

function EventPage() {
  const { slug } = Route.useParams()
  const { event, ticketTypes, seatMap, whenLabel } = Route.useLoaderData()
  const navigate = useNavigate()
  const [qty, setQty] = useState<Record<string, number>>({})
  const [seats, setSeats] = useState<string[]>([])
  const [aboutOpen, setAboutOpen] = useState(false)


  const seated = seatMap.seated
  // The map is worth showing whenever there is one — a standing-only floor has
  // no seats but still has a stage and areas to orient the buyer.
  const showMap =
    seated || seatMap.layout.levels.some((l) => l.objects.length > 0)
  // Seated categories are bought by picking seats; everything else (standing
  // areas, extras) keeps the quantity stepper, and an event can have both.
  const quantityTypes = ticketTypes.filter((t) => !t.seated)

  const seatPriceById = new Map(
    seatMap.seats.map((s) => [s.seatId, s.priceCents]),
  )
  const seatedTotal = seats.reduce(
    (s, id) => s + (seatPriceById.get(id) ?? 0),
    0,
  )

  const itemsTotal = quantityTypes.reduce(
    (sum, t) => sum + (qty[t.id] ?? 0) * t.price_cents,
    0,
  )
  const total = seatedTotal + itemsTotal
  const totalItems = Object.values(qty).reduce((a, b) => a + b, 0)
  // Seats and quantity items are both tickets — the mobile bar counts both.
  const ticketCount = totalItems + seats.length
  const anySelected = ticketCount > 0

  const setQuantity = (id: string, value: number) => {
    setQty((prev) => ({ ...prev, [id]: value }))
  }

  const goToCheckout = () => {
    // Checkout takes both halves of the cart: picked seats and quantity items.
    const items = quantityTypes
      .filter((t) => (qty[t.id] ?? 0) > 0)
      .map((t) => `${t.id}:${qty[t.id]}`)
      .join(',')
    navigate({
      to: '/e/$slug/checkout',
      params: { slug },
      search: { items, seats: seats.join(',') },
    })
  }

  const cover = (event as unknown as { cover_url?: string | null }).cover_url

  const jsonLd = eventJsonLd({
    event,
    ticketTypes,
    pageUrl: absoluteUrl(`/e/${event.slug}`),
    imageUrl: event.cover_url ?? absoluteUrl(`/api/og/${event.slug}`),
  })

  // Rendered above the map on a seated event and beside the ticket panel on an
  // unseated one, so it is written once and placed twice.
  const about = (
    <>
      <h2 className="font-display text-2xl font-bold">O podujatí</h2>
      {event.description ? (
        <>
          <p
            className={`mt-4 whitespace-pre-line text-ink-300 leading-relaxed ${
              aboutOpen ? '' : 'line-clamp-6'
            }`}
          >
            {event.description}
          </p>
          {event.description.length > 260 && (
            <button
              type="button"
              onClick={() => setAboutOpen((v) => !v)}
              className="mt-3 text-sm font-semibold text-accent transition hover:opacity-80"
            >
              {aboutOpen ? 'Zobraziť menej' : 'Zobraziť viac'}
            </button>
          )}
        </>
      ) : (
        <p className="mt-4 text-ink-500">
          Bližší popis podujatia bude čoskoro.
        </p>
      )}
    </>
  )


  return (
    <div className="min-h-screen">
      <script
        type="application/ld+json"
        // schema.org/Event for Google rich results; safe JSON (no user scripts).
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <EventAnalytics
        ga4Id={event.ga4_measurement_id}
        pixelId={event.meta_pixel_id}
      />
      {/* HERO */}
      <div
        className="relative"
        style={{
          background: cover
            ? `linear-gradient(180deg, rgba(9,9,11,0.4) 0%, var(--color-ink-950) 100%), url(${cover}) center/cover`
            : 'var(--gradient-hero), var(--gradient-fallback)',
        }}
      >
        <div className="mx-auto max-w-6xl px-6 pt-8 pb-16 md:pt-10 md:pb-24">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-ink-300 transition hover:text-ink-100"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Späť na podujatia
          </Link>

          <div className="mt-8 max-w-3xl animate-fade-up">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-950/60 px-3 py-1 text-xs font-medium text-accent backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />V predaji
            </div>
            <h1 className="font-display text-4xl font-bold leading-[1.05] tracking-tight md:text-6xl">
              {event.title}
            </h1>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-ink-200">
              <span className="inline-flex items-center gap-2">
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <path d="M16 2v4M8 2v4M3 10h18" />
                </svg>
                {whenLabel}
              </span>
              {event.venue_name && (
                <span className="inline-flex items-center gap-2">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <path d="M12 22s-8-7.5-8-13a8 8 0 1 1 16 0c0 5.5-8 13-8 13z" />
                    <circle cx="12" cy="9" r="3" />
                  </svg>
                  {event.venue_name}
                  {event.venue_address ? `, ${event.venue_address}` : ''}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* BODY */}
      <div className="mx-auto max-w-6xl px-6 pb-32 md:pb-16">
        {/* Buy first, read after: the map sits BESIDE the ticket panel at the
            top of the page and the (often long) description follows below, so a
            wall of text no longer pushes the picker off the first screen. */}


        <div
          className={
            showMap
              ? 'grid gap-10 lg:grid-cols-[minmax(0,1fr)_380px]'
              : 'grid gap-10 md:grid-cols-[minmax(0,1fr)_380px]'
          }
        >
          {/* LEFT: the map on a seated event, otherwise the description. */}
          {showMap ? (
            <section>
              <h2 className="font-display text-2xl font-bold">
                Výber sedadiel
              </h2>
              <div className="mt-4">
                <SeatPicker
                  map={seatMap}
                  selected={seats}
                  onChange={setSeats}
                />
              </div>
            </section>
          ) : (
            <div>{about}</div>
          )}

          {/* RIGHT: sticky ticket panel */}
          <aside
            className={
              showMap
                ? 'lg:sticky lg:top-24 lg:self-start'
                : 'md:sticky md:top-24 md:self-start'
            }
          >
            <div className="card-surface p-6">
              <h2 className="font-display text-xl font-bold">
                {showMap ? 'Vstupenky a súhrn' : 'Vstupenky'}
              </h2>
              {/* Picked seats belong next to the total, not under the map: the
                  buyer must see what is in the cart without scrolling back. */}
              {showMap && (
                <div className="mt-4 rounded-xl border border-ink-700 bg-ink-900/50 p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold text-ink-200">
                      Vybrané sedadlá
                    </span>
                    <span className="text-xs text-ink-400 tabular-nums">
                      {seats.length} · {formatEur(seatedTotal)}
                    </span>
                  </div>
                  {seats.length === 0 ? (
                    <p className="mt-2 text-xs text-ink-500">
                      Vyberte sedadlá kliknutím na mapu.
                    </p>
                  ) : (
                    <ul className="mt-2 max-h-44 space-y-1 overflow-auto pr-1 text-xs">
                      {seats.map((id) => {
                        const s = seatMap.seats.find((x) => x.seatId === id)
                        if (!s) return null
                        return (
                          <li
                            key={id}
                            className="flex items-center justify-between gap-2"
                          >
                            <span className="min-w-0 truncate text-ink-300">
                              {s.sector} · rad {s.rowLabel} · miesto{' '}
                              {s.seatNumber}
                              {s.seatType === 'wheelchair' && (
                                <span className="ml-1 text-sky-400">
                                  · bezbariérové
                                </span>
                              )}
                            </span>
                            <span className="flex shrink-0 items-center gap-2">
                              <span className="tabular-nums text-ink-200">
                                {formatEur(s.priceCents)}
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  setSeats(seats.filter((x) => x !== id))
                                }
                                aria-label={`Odobrať sedadlo ${s.sector} ${s.rowLabel}${s.seatNumber}`}
                                title="Odobrať"
                                className="h-5 w-5 rounded border border-ink-700 text-ink-300 transition hover:bg-ink-800 hover:text-ink-100"
                              >
                                ×
                              </button>
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )}
              {!showMap && quantityTypes.length === 0 && (
                <p className="mt-4 text-sm text-ink-400">
                  Momentálne nie sú v predaji žiadne vstupenky.
                </p>
              )}

              {quantityTypes.length > 0 && (
                <>
                  {showMap && (
                    <div className="mt-4 text-sm font-semibold text-ink-200">
                      Státie a ostatné vstupenky
                    </div>
                  )}
                  <ul className="mt-4 space-y-3">
                    {quantityTypes.map((t) => (
                      <li
                        key={t.id}
                        className="rounded-xl border border-ink-700 bg-ink-900/50 p-4"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <div className="font-semibold text-ink-100">
                              {t.name}
                            </div>
                            {t.description && (
                              <div className="mt-0.5 text-xs text-ink-400 line-clamp-2">
                                {t.description}
                              </div>
                            )}
                            <div className="mt-2 font-display text-lg font-bold text-accent">
                              {formatEur(t.price_cents)}
                            </div>
                          </div>
                          {t.sold_out ? (
                            <div className="flex flex-col items-end gap-2">
                              <span className="rounded-md bg-ink-800 px-2.5 py-1 text-xs font-medium uppercase tracking-wider text-ink-400">
                                Vypredané
                              </span>
                              <WaitlistWatch slug={slug} ticketTypeId={t.id} />
                            </div>
                          ) : (
                            <Stepper
                              value={qty[t.id] ?? 0}
                              max={t.max_per_order}
                              onChange={(n) => setQuantity(t.id, n)}
                            />
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {/* Desktop total + CTA */}
              <div className="mt-6 hidden md:block">
                <div className="flex items-baseline justify-between border-t border-ink-700 pt-4">
                  <span className="text-sm text-ink-400">Spolu</span>
                  <span className="font-display text-2xl font-bold">
                    {formatEur(total)}
                  </span>
                </div>
                <button
                  disabled={!anySelected}
                  onClick={goToCheckout}
                  className="btn-primary mt-4 w-full disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
                >
                  {anySelected ? 'Pokračovať na platbu' : 'Vyberte vstupenky'}
                  {anySelected && (
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
                  )}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile sticky CTA */}
      {anySelected && (
        <div className="fixed inset-x-0 bottom-0 z-50 border-t border-ink-800 bg-ink-950/95 p-4 backdrop-blur-xl md:hidden animate-fade-up">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div>
              <div className="text-xs text-ink-400">
                {ticketCount} {ticketWord(ticketCount)}
              </div>
              <div className="font-display text-xl font-bold">
                {formatEur(total)}
              </div>
            </div>
            <button onClick={goToCheckout} className="btn-primary">
              Pokračovať
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
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
