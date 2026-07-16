import { createFileRoute, Link } from '@tanstack/react-router'
import { ContentPage, H2 } from '../components/ContentPage'

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
  component: () => (
    <ContentPage
      title="Ako to funguje"
      subtitle="Od vytvorenia podujatia po odbavenie na vstupe — za pár minút."
    >
      <H2>1. Vytvorte podujatie</H2>
      <p>
        Zadajte názov, termín, miesto a typy vstupeniek s cenami a kapacitou.
        Môžete pridať zľavové kupóny aj vlastné polia formulára.
      </p>
      <H2>2. Predávajte online</H2>
      <p>
        Zdieľajte odkaz na podujatie. Kupujúci zaplatia kartou cez GoPay a
        vstupenky s QR kódom im prídu okamžite e-mailom (aj do Apple/Google
        Wallet).
      </p>
      <H2>3. Peniaze máte priebežne</H2>
      <p>
        Vďaka priebežnému payoutu cez GoPay máte tržby na účte hneď — nie až po
        evente. Provízia platformy je transparentná a nízka.
      </p>
      <H2>4. Odbavujte cez mobil</H2>
      <p>
        Na vstupe skenujete QR kódy webovým alebo mobilným skenerom. Odbavenie
        je idempotentné — opakovaný sken bezpečne oznámi „už použitá".
      </p>
      <p className="pt-4">
        <Link to="/cennik" className="text-accent underline">
          Pozrite si cenník a kalkulačku →
        </Link>
      </p>
    </ContentPage>
  ),
})
