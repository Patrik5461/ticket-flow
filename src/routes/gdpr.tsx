import { createFileRoute } from '@tanstack/react-router'
import { ContentPage } from '../components/ContentPage'
import { Markdown } from '../components/Markdown'
import { getContentFn } from '../server/content'

export const Route = createFileRoute('/gdpr')({
  head: () => ({
    meta: [
      { title: 'Ochrana osobných údajov (GDPR) — Ticketio' },
      {
        name: 'description',
        content:
          'Zásady spracúvania osobných údajov na platforme Ticketio v súlade s GDPR.',
      },
    ],
  }),
  loader: async () => getContentFn({ data: { key: 'gdpr' } }),
  component: () => {
    const block = Route.useLoaderData()
    if (!block) {
      return (
        <ContentPage title="Ochrana osobných údajov">
          <p>Obsah tejto stránky sa pripravuje.</p>
        </ContentPage>
      )
    }
    return (
      <ContentPage title={block.title}>
        <Markdown source={block.body} />
      </ContentPage>
    )
  },
})
