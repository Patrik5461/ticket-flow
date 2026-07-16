import { createFileRoute } from '@tanstack/react-router'
import { ContentPage, H2 } from '../components/ContentPage'

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
  component: () => (
    <ContentPage
      title="Ochrana osobných údajov"
      subtitle="Ako spracúvame vaše osobné údaje (GDPR)."
    >
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
        Toto je predbežné znenie. Finálne zásady ochrany osobných údajov
        pripravuje právnik a budú doplnené pred spustením.
      </p>
      <H2>Aké údaje spracúvame</H2>
      <p>
        Pri objednávke spracúvame e-mail, prípadne meno a telefón kupujúceho, a
        údaje potrebné na vystavenie vstupenky a dokladu. Fakturačné údaje
        spracúvame len ak kupujete na firmu.
      </p>
      <H2>Účel a právny základ</H2>
      <p>
        Údaje používame na spracovanie objednávky, doručenie vstupeniek a
        plnenie zákonných povinností. Analytické a marketingové nástroje
        spúšťame len s vaším súhlasom (viď nastavenia cookies).
      </p>
      <H2>Príjemcovia</H2>
      <p>
        Údaje sprístupňujeme organizátorovi podujatia (na účel odbavenia) a
        poskytovateľom platby a e-mailu v nevyhnutnom rozsahu.
      </p>
      <H2>Vaše práva</H2>
      <p>
        Máte právo na prístup, opravu a vymazanie údajov, obmedzenie spracúvania
        a namietanie. Kontaktujte nás na{' '}
        <a href="mailto:hello@ticketio.sk" className="text-accent underline">
          hello@ticketio.sk
        </a>
        .
      </p>
    </ContentPage>
  ),
})
