import { createFileRoute } from '@tanstack/react-router'
import { ContentPage, H2 } from '../components/ContentPage'

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
  component: () => (
    <ContentPage
      title="Obchodné podmienky"
      subtitle="Podmienky používania platformy Ticketio."
    >
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
        Toto je predbežné znenie. Finálne obchodné podmienky pripravuje právnik
        a budú doplnené pred spustením.
      </p>
      <H2>1. Prevádzkovateľ a rozsah</H2>
      <p>
        Ticketio je sprostredkovateľ predaja vstupeniek medzi organizátorom
        podujatia a kupujúcim. Zmluva o návšteve podujatia vzniká medzi
        kupujúcim a organizátorom.
      </p>
      <H2>2. Objednávka a platba</H2>
      <p>
        Objednávka drží rezerváciu kapacity po obmedzený čas. Platba prebieha
        cez platobnú bránu GoPay. Po úspešnej platbe dostane kupujúci vstupenky
        s QR kódom e-mailom.
      </p>
      <H2>3. Storno a reklamácie</H2>
      <p>
        Podmienky vrátenia vstupného a prípadné zrušenie podujatia určuje
        organizátor v súlade s platnými právnymi predpismi. Reklamácie k platbe
        riešime v spolupráci s organizátorom.
      </p>
      <H2>4. Provízia platformy</H2>
      <p>
        Ticketio si účtuje transparentnú províziu z predaja podľa aktuálneho
        cenníka. Provízia sa nepripočítava kupujúcemu nad rámec ceny vstupenky,
        pokiaľ nie je uvedené inak.
      </p>
      <H2>5. Ochrana osobných údajov</H2>
      <p>
        Spracúvanie osobných údajov sa riadi zásadami ochrany osobných údajov
        (GDPR).
      </p>
    </ContentPage>
  ),
})
