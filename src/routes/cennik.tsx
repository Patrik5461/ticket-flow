import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { computeFee } from '../lib/pricing'
import { formatEur } from '../lib/money'

// Our default tariff (CLAUDE.md) vs Inviton's public pricing.
const US = { percent: 4, minCents: 40, label: 'Ticketio' }
const INVITON = { percent: 5, minCents: 60, label: 'Inviton' }

export const Route = createFileRoute('/cennik')({
  head: () => ({
    meta: [
      { title: 'Cenník — Ticketio' },
      {
        name: 'description',
        content:
          'Transparentný cenník Ticketio: 4 % / min 0,40 € z predanej vstupenky. Spočítajte si, koľko dostanete z lístka za X €.',
      },
    ],
  }),
  component: PricingPage,
})

function PricingPage() {
  const [price, setPrice] = useState('20')

  const cents = Math.max(
    0,
    Math.round(parseFloat(price.replace(',', '.')) * 100),
  )
  const valid = Number.isFinite(cents) && cents > 0

  const ourFee = computeFee(cents, US.percent, US.minCents)
  const invFee = computeFee(cents, INVITON.percent, INVITON.minCents)
  const ourNet = cents - ourFee
  const invNet = cents - invFee
  const diff = ourNet - invNet

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <div className="mx-auto max-w-2xl px-6 py-12">
        <Link
          to="/"
          className="text-sm text-ink-300 transition hover:text-ink-100"
        >
          ← Späť na hlavnú stránku
        </Link>
        <h1 className="mt-6 font-display text-3xl font-bold">Cenník</h1>
        <p className="mt-3 text-ink-300">
          Žiadne mesačné poplatky, žiadne skryté náklady. Platíte len províziu z
          predanej vstupenky.
        </p>

        <div className="mt-8 rounded-2xl border border-accent/40 bg-accent/5 p-6">
          <div className="text-sm text-ink-300">Provízia platformy</div>
          <div className="mt-1 font-display text-4xl font-bold">
            4 %{' '}
            <span className="text-lg font-medium text-ink-300">
              / min 0,40 € za vstupenku
            </span>
          </div>
          <p className="mt-3 text-sm text-ink-400">
            Zaplatené vstupenky sa účtujú províziou 4 % z ceny, minimálne 0,40
            €. Bezplatné vstupenky sú bez poplatku.
          </p>
        </div>

        {/* Calculator */}
        <div className="mt-8 rounded-2xl border border-ink-700 bg-ink-900/50 p-6">
          <h2 className="font-display text-lg font-semibold">
            Koľko dostanem z lístka?
          </h2>
          <label className="mt-4 block text-sm text-ink-300">
            Cena vstupenky (€)
            <div className="mt-1.5 flex items-center gap-2">
              <input
                type="number"
                min="0"
                step="0.50"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-40 rounded-xl border border-ink-700 bg-ink-900 px-4 py-3 text-ink-100 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <span className="text-ink-400">€</span>
            </div>
          </label>

          {valid ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-xl border border-ink-700 bg-ink-950 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-ink-300">
                    Provízia Ticketio (4 % / min 0,40 €)
                  </span>
                  <span className="font-medium text-ink-200">
                    −{formatEur(ourFee)}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between border-t border-ink-800 pt-2">
                  <span className="font-semibold">Dostanete</span>
                  <span className="font-display text-2xl font-bold text-accent">
                    {formatEur(ourNet)}
                  </span>
                </div>
              </div>

              <div className="rounded-xl border border-ink-800 p-4 text-sm">
                <div className="flex items-center justify-between text-ink-400">
                  <span>U Invitonu (5 % / min 0,60 €)</span>
                  <span>{formatEur(invNet)}</span>
                </div>
                {diff > 0 && (
                  <div className="mt-2 text-emerald-400">
                    S Ticketiom máte z každej vstupenky o{' '}
                    <strong>{formatEur(diff)}</strong> viac.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-6 text-sm text-ink-400">
              Zadajte cenu vstupenky pre výpočet.
            </p>
          )}
        </div>

        <p className="mt-8 text-sm text-ink-400">
          <Link to="/ako-to-funguje" className="text-accent underline">
            Ako to funguje →
          </Link>
        </p>
      </div>
    </div>
  )
}
