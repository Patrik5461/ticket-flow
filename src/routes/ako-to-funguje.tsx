import { createFileRoute } from '@tanstack/react-router'
import { ContentPage } from '../components/ContentPage'
import { Markdown } from '../components/Markdown'
import { getContentFn } from '../server/content'

export const Route = createFileRoute('/ako-to-funguje')({
  head: () => ({
    meta: [
      { title: 'Ako to funguje — Ticketio' },
      {
        name: 'description',
        content:
          'Ako predávať vstupenky cez Ticketio: vytvorte podujatie, predávajte online, odbavujte cez mobil. Priebežný payout, transparentný cenník.',
      },
    ],
  }),
  loader: async () => getContentFn({ data: { key: 'ako-to-funguje' } }),
  component: () => {
    const block = Route.useLoaderData()
    if (!block) {
      return (
        <ContentPage title="Ako to funguje">
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
