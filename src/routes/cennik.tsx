import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { computeFee } from '../lib/pricing'
import { formatEur } from '../lib/money'
import { getPlatformSettingsFn } from '../server/platform-settings'

// Inviton's public pricing, for comparison. Our own tariff is live data.
const INVITON = { percent: 5, minCents: 60, label: 'Inviton' }

function pctStr(p: number): string {
  return String(p).replace('.', ',')
}

export const Route = createFileRoute('/cennik')({
  head: () => ({
    meta: [
      { title: 'Cenník — Ticketio' },
      {
        name: 'description',
        content:
          'Transparentný cenník Ticketio: nízka provízia z predanej vstupenky. Spočítajte si, koľko dostanete z lístka za X €.',
      },
    ],
  }),
  loader: async () => getPlatformSettingsFn(),
  component: PricingPage,
})

function PricingPage() {
  const settings = Route.useLoaderData()
  const us = {
    percent: settings.defaultFeePercent,
    minCents: settings.defaultFeeMinCents,
  }
  const feeLabel = `${pctStr(us.percent)} % / min ${formatEur(us.minCents)}`

  const [price, setPrice] = useState('20')

  const cents = Math.max(
    0,
    Math.round(parseFloat(price.replace(',', '.')) * 100),
  )
  const valid = Number.isFinite(cents) && cents > 0

  const ourFee = computeFee(cents, us.percent, us.minCents)
  const invFee = computeFee(cents, INVITON.percent, INVITON.minCents)
  const ourNet = cents - ourFee
  const invNet = cents - invFee
  const diff = ourNet - invNet

  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-16">
        <Link
          to="/"
          className="text-sm text-ink-400 transition hover:text-ink-100"
        >
          ← Späť na hlavnú stránku
        </Link>
        <h1 className="mt-6 font-display text-4xl font-bold sm:text-5xl">
          Cenník
        </h1>
        <p className="mt-3 max-w-xl text-ink-300">
          Žiadne mesačné poplatky, žiadne skryté náklady. Platíte len províziu z
          predanej vstupenky.
        </p>

        <div
          className="mt-10 rounded-2xl border border-accent/40 bg-gradient-to-br from-accent/10 via-ink-900 to-ink-900 p-6 sm:p-8"
          style={{
            boxShadow:
              '0 20px 60px -30px color-mix(in oklab, var(--color-accent) 60%, transparent)',
          }}
        >
          <div className="text-xs font-medium uppercase tracking-wider text-accent">
            Provízia platformy
          </div>
          <div className="mt-2 font-display text-5xl font-bold leading-none sm:text-6xl">
            {pctStr(us.percent)}
            <span className="text-accent"> %</span>
          </div>
          <div className="mt-2 text-base text-ink-300">
            minimálne{' '}
            <span className="font-semibold text-ink-100">
              {formatEur(us.minCents)}
            </span>{' '}
            za vstupenku
          </div>
          <p className="mt-4 max-w-md text-sm text-ink-400">
            Zaplatené vstupenky sa účtujú províziou {pctStr(us.percent)} % z
            ceny, minimálne {formatEur(us.minCents)}. Bezplatné vstupenky sú bez
            poplatku.
          </p>
        </div>

        {/* Calculator */}
        <div className="mt-8 rounded-2xl border border-ink-800 bg-ink-900/50 p-6 sm:p-8">
          <div className="flex items-center gap-2">
            <div className="grid h-9 w-9 place-items-center rounded-lg bg-accent/15 text-accent">
              €
            </div>
            <h2 className="font-display text-xl font-semibold">
              Koľko dostanem z lístka?
            </h2>
          </div>

          <label className="mt-6 block text-sm">
            <span className="mb-2 block font-medium text-ink-200">
              Cena vstupenky
            </span>
            <div className="relative w-full max-w-[220px]">
              <input
                type="number"
                min="0"
                step="0.50"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="w-full rounded-xl border border-ink-700 bg-ink-950 px-4 py-3 pr-10 text-lg font-semibold text-ink-100 outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-ink-500">
                €
              </span>
            </div>
          </label>

          {valid ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-accent/40 bg-accent/5 p-5">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-accent">
                  <span>Ticketio</span>
                  <span>{feeLabel}</span>
                </div>
                <div className="mt-4 flex items-baseline justify-between text-sm text-ink-400">
                  <span>Provízia</span>
                  <span className="font-medium text-ink-200">
                    −{formatEur(ourFee)}
                  </span>
                </div>
                <div className="mt-3 border-t border-accent/20 pt-3">
                  <div className="text-xs text-ink-400">Dostanete</div>
                  <div className="mt-1 font-display text-3xl font-bold text-accent">
                    {formatEur(ourNet)}
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-ink-800 bg-ink-950/60 p-5">
                <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-ink-500">
                  <span>Inviton</span>
                  <span>
                    {INVITON.percent} % / min {formatEur(INVITON.minCents)}
                  </span>
                </div>
                <div className="mt-4 flex items-baseline justify-between text-sm text-ink-400">
                  <span>Provízia</span>
                  <span className="font-medium text-ink-300">
                    −{formatEur(invFee)}
                  </span>
                </div>
                <div className="mt-3 border-t border-ink-800 pt-3">
                  <div className="text-xs text-ink-400">Dostanete</div>
                  <div className="mt-1 font-display text-3xl font-bold text-ink-200">
                    {formatEur(invNet)}
                  </div>
                </div>
              </div>

              {diff > 0 && (
                <div className="sm:col-span-2 rounded-xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-sm text-emerald-300">
                  S Ticketiom máte z každej vstupenky o{' '}
                  <strong className="text-emerald-200">
                    {formatEur(diff)}
                  </strong>{' '}
                  viac.
                </div>
              )}
            </div>
          ) : (
            <p className="mt-6 text-sm text-ink-500">
              Zadajte cenu vstupenky pre výpočet.
            </p>
          )}
        </div>

        <p className="mt-8 text-sm text-ink-400">
          <Link to="/ako-to-funguje" className="text-accent hover:underline">
            Ako to funguje →
          </Link>
        </p>
      </div>
    </div>
  )
}
