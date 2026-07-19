import { createFileRoute } from '@tanstack/react-router'
import { openConsentSettings } from '../lib/consent'
import { ContentPage } from '../components/ContentPage'
import { Markdown } from '../components/Markdown'
import { getContentFn } from '../server/content'

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
  loader: async () => getContentFn({ data: { key: 'cookies' } }),
  component: CookiesPage,
})

function CookiesPage() {
  const block = Route.useLoaderData()
  return (
    <ContentPage title={block?.title ?? 'Cookies'}>
      {block ? (
        <Markdown source={block.body} />
      ) : (
        <p>Obsah tejto stránky sa pripravuje.</p>
      )}
      {/* Functional consent control — stays in code (Markdown can't wire it). */}
      <div className="pt-4">
        <button
          onClick={() => openConsentSettings()}
          className="rounded-lg bg-accent px-4 py-2.5 font-semibold text-white transition hover:opacity-90"
        >
          Zmeniť nastavenia cookies
        </button>
      </div>
    </ContentPage>
  )
}
