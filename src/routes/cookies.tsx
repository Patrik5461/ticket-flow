import { createFileRoute, Link } from '@tanstack/react-router'
import { openConsentSettings } from '../lib/consent'

export const Route = createFileRoute('/cookies')({
  head: () => ({
    meta: [
      { title: 'Cookies — Ticketio' },
      {
        name: 'description',
        content:
          'Aké cookies Ticketio používa a ako spravovať svoj súhlas s analytickými a marketingovými cookies.',
      },
    ],
  }),
  component: CookiesPage,
})

function Category({
  title,
  always,
  children,
}: {
  title: string
  always?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-900/50 p-5">
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold text-ink-100">{title}</h3>
        {always && (
          <span className="rounded-md bg-ink-800 px-2 py-0.5 text-xs text-ink-300">
            Vždy aktívne
          </span>
        )}
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-300">{children}</p>
    </div>
  )
}

function CookiesPage() {
  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link
          to="/"
          className="text-sm text-ink-300 transition hover:text-ink-100"
        >
          ← Späť na hlavnú stránku
        </Link>
        <h1 className="mt-6 font-display text-3xl font-bold">Cookies</h1>
        <p className="mt-3 text-ink-300">
          Cookies sú malé súbory, ktoré nám pomáhajú prevádzkovať stránku a s
          vaším súhlasom aj merať návštevnosť a zobrazovať relevantnejší obsah.
          Svoj súhlas môžete kedykoľvek zmeniť.
        </p>

        <div className="mt-8 space-y-4">
          <Category title="Nutné cookies" always>
            Potrebné pre základný chod stránky — prihlásenie, udržanie obsahu
            košíka a bezpečnosť. Bez nich by stránka nefungovala, preto ich
            nemožno vypnúť.
          </Category>
          <Category title="Analytické cookies">
            Pomáhajú nám pochopiť, ako sa stránka používa (napr. Google
            Analytics), aby sme ju mohli zlepšovať. Spúšťajú sa len s vaším
            súhlasom.
          </Category>
          <Category title="Marketingové cookies">
            Umožňujú meranie konverzií a remarketing (napr. Meta Pixel).
            Spúšťajú sa len s vaším súhlasom.
          </Category>
        </div>

        <div className="mt-8">
          <button
            onClick={() => openConsentSettings()}
            className="rounded-lg bg-accent px-4 py-2.5 font-semibold text-white transition hover:opacity-90"
          >
            Zmeniť nastavenia cookies
          </button>
        </div>
      </div>
    </div>
  )
}
