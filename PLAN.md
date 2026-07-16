# Ticketio — Master plán: Fáza 5 → spustenie

Použitie: každú fázu vkladaj do Claude Code ako samostatný prompt, až keď je predchádzajúca hotová, otestovaná a pushnutá. Po každej fáze: testy + typecheck + build, commit, push, krátke preklikanie v preview. UI štýlovanie každej novej obrazovky rieš následne v Lovable (Claude Code stavia funkčné UI v existujúcom dizajn systéme).

---

## Fáza 5 — Super-admin (platforma)

Nová rola `platform_admin` (tabuľka `platform_admins` s user_id, seed pridá môj účet). Routes pod `/admin` (guard: len platform admin, 404 pre ostatných — neprezrádzať existenciu).

- `/admin` — prehľad: celkové tržby, provízie platformy, počet organizátorov/eventov/objednávok, graf predajov po dňoch (30 dní)
- `/admin/organizers` — zoznam + detail: úprava fee_percent a fee_min_cents, aktivácia/deaktivácia organizátora (deaktivovaný nemôže publikovať ani predávať; nový stĺpec organizers.status active/suspended), poznámky
- `/admin/events` — všetky eventy naprieč organizátormi, možnosť unpublish (moderácia)
- `/admin/orders` — vyhľadanie objednávky (e-mail, ID) naprieč platformou — na support
- `audit_log` tabuľka: každá admin akcia (kto, čo, kedy, stará/nová hodnota). Migrácia + zápis zo všetkých admin mutácií.

Akceptácia: bežný organizátor dostane na /admin 404; zmena provízie sa prejaví v novej objednávke; audit log zachytáva zmeny.

## Fáza 6 — Peniaze naostro

- **Refundácie:** server fn refundOrder (celá objednávka; GoPay refund API + storno vstupeniek + e-mail kupujúcemu) a refundTicket (čiastočná — jedna vstupenka, prepočet). Stavy: orders.status refunded / partially_refunded (migrácia). Refund smie owner/admin organizátora a platform admin.
- **Zrušenie eventu:** cancelEvent — event → cancelled, hromadný refund všetkých paid objednávok (dávkovo, idempotentne, s retry frontou — tabuľka refund_jobs spracovávaná pg_cron), e-mail všetkým kupujúcim. UI potvrdenie s dvojitým overením.
- **Vyúčtovanie organizátora:** mesačný settlement — tabuľka settlements (organizer_id, obdobie, hrubé tržby, provízia, netto), generovanie PDF protokolu, viditeľné v dashboarde organizátora. pg_cron 1. deň v mesiaci.
- **Fakturácia provízie cez Faktero API:** po vygenerovaní settlementu vytvor faktúru organizátorovi cez Faktero (API kľúč v env, abstrakcia za interface — ak env chýba, len log). Doplň aj voliteľnú faktúru kupujúcemu na firmu: checkbox v checkoute "kúpiť na firmu" + IČO lookup (RPO API pattern z MimaPro), údaje do orders (billing_ico, billing_name, billing_address...).
- **GoPay produkcia:** GOPAY_ENV prepínač už existuje — over produkčný flow proti doc.gopay.com, doplň spracovanie všetkých stavov (PARTIALLY_REFUNDED, REFUNDED) vo webhooku a reconcile.

Akceptácia: sandbox platba → refund → stav v DB aj GoPay konzistentný; zrušenie eventu so 3 objednávkami refunduje všetky a rozošle e-maily; settlement PDF sedí na cent s objednávkami.

## Fáza 7 — E-maily naostro

- Implementuj ResendEmailProvider (env RESEND_API_KEY; provider výber podľa env, console zostáva fallback v deve).
- Šablóny (pekné HTML, dizajn konzistentný s webom, SK): vstupenky po zaplatení, potvrdenie objednávky čakajúcej na platbu, refund potvrdenie, zrušenie eventu, pripomienka 24 h pred eventom (pg_cron + tabuľka email_jobs s dedup), zmena termínu/miesta eventu.
- **Hromadná správa účastníkom:** v dashboarde eventu "Napísať účastníkom" — predmet + text, odošle všetkým kupujúcim s paid objednávkou (cez email_jobs frontu, rate-limit). Log odoslaní.
- Doménové nastavenie: SPF/DKIM poznámky do README (doména ticketio.sk, subdoména mail).

Akceptácia: celý flow objednávky generuje správne e-maily cez Resend sandbox/test; pripomienka sa naplánuje a odošle len raz.

## Fáza 8 — Prevádzka organizátora

- **Guestlist / pozvánky:** import CSV/Excel kontaktov (papaparse/SheetJS server-side), hromadné vygenerovanie vstupeniek zdarma (bez objednávky — nový zdroj tickets.source order/guestlist/manual) + rozoslanie e-mailom; prehľad guestlistu so stavom check-inu.
- **Ručná objednávka:** organizátor vytvorí objednávku v dashboarde (predaj na mieste / prevodom) — vyberie typy, zadá kupujúceho, stav paid_manual; vstupenky sa vygenerujú a pošlú.
- **Správa vstupeniek:** re-send na e-mail, zmena holder_name, storno jednotlivej vstupenky (bez refundu — len invalidácia), presun vstupenky na iný e-mail.
- **Duplikát/strata:** re-generácia QR pre vstupenku (nový ticket id, starý cancelled) pri podozrení na únik.

Akceptácia: guestlist importuje 100 kontaktov a všetky prejdú check-inom; ručná objednávka sa objaví v sales aj settlemente (bez provízie z GoPay, provízia platformy podľa nastavenia).

## Fáza 9 — Parita s Invitonom + differentiators

- **Embed widget:** `/e/{slug}/embed` — odľahčená verzia event stránky pre iframe (bez nav/footeru, postMessage resize) + JS snippet `<script src=".../widget.js" data-event="slug">`; stránka v dashboarde "Predávaj na svojom webe" s copy-paste kódom. CSP/security review.
- **Apple/Google Wallet:** .pkpass generovanie (certifikáty v env, abstrakcia — bez certov sa tlačidlo nezobrazí) + Google Wallet JWT link. Tlačidlá na order stránke a v e-maile.
- **GA4 + Meta Pixel per event:** polia v nastaveniach eventu (measurement ID, pixel ID), injektuj len na verejných stránkach daného eventu, s jednoduchou consent lištou (nutná aj tak — Fáza 10). Purchase event s hodnotou objednávky.
- **Vlastné polia formulára per typ vstupenky:** JSON schema builder v dashboarde (text, select, checkbox, povinné/nepovinné), render v checkoute per vstupenka, odpovede do ticket_answers tabuľky, export v CSV.
- **Personalizácia vstupenky:** upload loga a farba organizátora (organizers.brand_logo_url, brand_color, Supabase Storage), PDF šablóna ich použije; náhľad v dashboarde.
- **Waitlist:** pri vypredanom type "Strážiť dostupnosť" → e-mail + event_id + ticket_type_id do waitlist tabuľky; pri uvoľnení kapacity (expirácia rezervácie/refund) pg_cron pošle notifikáciu prvým N s časovo obmedzeným linkom.

Akceptácia: widget beží v iframe na cudzej doméne; testovací .pkpass sa dá pridať do Wallet; vlastné polia sa vyžadujú v checkoute a exportujú v CSV.

## Fáza 10 — Obsah, právo, SEO

- Statické stránky: /cennik (verejný cenník s kalkulačkou "koľko dostanem z lístka za X €"), /ako-to-funguje, /kontakt, /obchodne-podmienky, /gdpr (obsah dodám — texty od právnika, placeholder teraz), /cookies.
- Cookie consent lišta (nutné pre GA/Pixel z Fázy 9) — vlastná jednoduchá, kategórie nutné/analytické/marketingové, blokuje skripty pred súhlasom.
- SEO: meta + OG tagy (event stránky s cover obrázkom ako OG image, generovaný fallback), sitemap.xml (published eventy), robots.txt, JSON-LD schema.org/Event na event stránkach (Google ich zobrazuje v events výsledkoch — silný organic kanál!).
- Checkout: povinný súhlas s VOP linkou, uloženie času súhlasu k objednávke.

Akceptácia: Lighthouse SEO > 90 na landing a event stránke; validátor schema.org bez chýb; GA sa nespustí pred súhlasom.

## Fáza 11 — Verejné API

- API kľúče per organizátor (dashboard: vygenerovať/revokovať, hash v DB), Bearer auth, rate limit.
- Endpointy v1 (REST, /api/v1): eventy organizátora (list/detail), objednávky (list s filtrami), vstupenky + check-in status, webhook subscriptions (order.paid, ticket.checked_in — podpísané HMAC).
- OpenAPI spec + jednoduchá /developers stránka s dokumentáciou.

Akceptácia: curl s API kľúčom vráti eventy; webhook príde pri zaplatení testovacej objednávky s validným podpisom.

## Fáza 12 — Deploy, monitoring, hardening (samostatný prompt, moja infra)

- Nová VM na Proxmoxe (vzor ostatných projektov): Node + PM2 (ecosystem mimo repa), secrets ~/ticketio-secrets.env, webhook deploy, NODE_OPTIONS pre build, mazanie stale artefaktov.
- HAProxy SNI: ticketio.sk + dev.ticketio.sk (staging beží prvý, produkcia po dokončení testov), SSL certy.
- DNS ticketio.sk → WAN IP, GoPay notification URL na produkčnú doménu.
- Supabase: rozhodnutie cloud vs self-host na VM (odporúčam začať na cloude, migrácia neskôr je možná — migrácie sú prenosné), denné zálohy (pg_dump do Storage Boxu).
- Monitoring: uptime check (dev aj prod), error logging (PM2 logs + jednoduchý alert), Supabase log drain review.
- Hardening: rate limiting na /api/checkin, checkout a auth endpointy; security headers (CSP, HSTS); dependency audit; penetračný self-test checkout flow (manipulácia cien, cudzie ID, replay webhookov).
- Ostrý GoPay: produkčné credentials, testovacia platba 1 € end-to-end, refund test.

## Fáza 13 — Doplnenie funkcií z prehliadky

- **Blok 1 — Cover obrázok eventu:** upload do Supabase Storage (bucket `event-covers`, public read; limit 5 MB, jpg/png/webp, server-side validácia), pole v create/edit event formulári s okamžitým náhľadom, orezový pomer 16:9 náhľadovo. Cover zobraziť všade, kde sa event renderuje (landing karta, event hero, OG image, embed). Plus live náhľad event karty pri vytváraní.
- **Blok 2 — Nastavenia organizátora:** `/app/nastavenia` rozšíriť o editáciu firemných údajov (name, ico, dic, ic_dph, iban, email, phone, adresa — over/doplň stĺpce migráciou), zmeny cez server fn s validáciou (IBAN formát, IČO 8 číslic), audit zápis. Slug needitovateľný. Sekcie: Firemné údaje / Branding / Tím (read-only zoznam členov).
- **Blok 3 — Dashboard prehľad organizátora:** `/app` hore metriky karty naprieč všetkými eventmi — predané vstupenky, hrubé tržby, provízia, netto na vyplatenie; obdobie prepínateľné (30 dní / celkovo). Vzor agregácie z admin-overview.
- **Blok 4 — Žiadosť o vyplatenie zálohy:** tabuľka `payout_requests` (organizer_id, amount_cents, status requested/approved/paid/rejected, note, created_by, resolved_by, resolved_at). Organizátor vidí „dostupné na vyplatenie" (netto z paid objednávok mínus vyplatené/požiadané) + tlačidlo v `/app/vyuctovania`; admin nová stránka žiadostí so schválením/zamietnutím (+ poznámka), stavy s auditom a e-mail notifikáciou. Vyplatenie je manuálny bankový prevod — systém eviduje stav.

## Pred spustením — checklist mimo kódu

- [ ] VOP + GDPR od právnika (sprostredkovateľský model, refund povinnosti, vzťah organizátor–kupujúci–platforma)
- [ ] GoPay produkčná zmluva — over marketplace/split model a podmienky pre platformu (tok peňazí!)
- [ ] Registrácia ochrannej známky / kontrola kolízie názvu Ticketio
- [ ] E-mailová doména (SPF/DKIM/DMARC) nastavená a odtestovaná na doručiteľnosť
- [ ] Prvý pilotný organizátor (ideálne existujúci klient z Maxiticketu na malý event) — beta test naostro pred verejným spustením
- [ ] Cenová politika finálna (4 % / min 0,40 € vs Inviton 5 % / 0,60 €) a zverejnená na /cennik
