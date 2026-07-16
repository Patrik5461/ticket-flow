import { createFileRoute } from '@tanstack/react-router'
import { ContentPage, H2 } from '../components/ContentPage'

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
  component: () => (
    <ContentPage
      title="Kontakt"
      subtitle="Radi vám pomôžeme — organizátorom aj kupujúcim."
    >
      <H2>E-mail</H2>
      <p>
        <a href="mailto:hello@ticketio.sk" className="text-accent underline">
          hello@ticketio.sk
        </a>
      </p>
      <H2>Podpora pre kupujúcich</H2>
      <p>
        Ak máte otázku k objednávke alebo vstupenke, napíšte nám a uveďte číslo
        objednávky z potvrdzovacieho e-mailu.
      </p>
      <H2>Pre organizátorov</H2>
      <p>
        Chcete predávať vstupenky cez Ticketio? Ozvite sa nám a pomôžeme vám s
        rozbehom prvého podujatia.
      </p>
      <H2>Sídlo</H2>
      <p>Bratislava, Slovensko</p>
    </ContentPage>
  ),
})
