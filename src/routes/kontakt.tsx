import { createFileRoute } from '@tanstack/react-router'
import { ContentPage } from '../components/ContentPage'
import { Markdown } from '../components/Markdown'
import { getContentFn } from '../server/content'

export const Route = createFileRoute('/kontakt')({
  head: () => ({
    meta: [
      { title: 'Kontakt — Ticketio' },
      {
        name: 'description',
        content:
          'Kontaktujte Ticketio — podpora pre organizátorov aj kupujúcich vstupeniek.',
      },
    ],
  }),
  loader: async () => getContentFn({ data: { key: 'kontakt' } }),
  component: () => {
    const block = Route.useLoaderData()
    if (!block) {
      return (
        <ContentPage title="Kontakt">
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
