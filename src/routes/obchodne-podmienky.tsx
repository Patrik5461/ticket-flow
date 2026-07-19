import { createFileRoute } from '@tanstack/react-router'
import { ContentPage } from '../components/ContentPage'
import { Markdown } from '../components/Markdown'
import { getContentFn } from '../server/content'

export const Route = createFileRoute('/obchodne-podmienky')({
  head: () => ({
    meta: [
      { title: 'Obchodné podmienky — Ticketio' },
      {
        name: 'description',
        content: 'Obchodné podmienky používania platformy Ticketio.',
      },
    ],
  }),
  loader: async () => getContentFn({ data: { key: 'obchodne-podmienky' } }),
  component: () => {
    const block = Route.useLoaderData()
    if (!block) {
      return (
        <ContentPage title="Obchodné podmienky">
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
