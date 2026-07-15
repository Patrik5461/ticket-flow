# Ticketio — operačné pravidlá pre Claude Code

## Projekt
Ticketio (ticketio.sk) — self-service SaaS platforma na predaj vstupeniek pre organizátorov eventov na Slovensku. Konkurencia: Inviton (5 % / min 0,60 €, payout až po evente). Naša výhoda: transparentný cenník, priebežný payout cez GoPay, moderné UX, offline check-in appka.

## Stack (nemeniť bez súhlasu)
- Frontend + SSR: TanStack Start + Nitro
- DB/Auth/Storage: Supabase (self-hosted alebo cloud — podľa .env)
- Platby: GoPay (inline brána, webhooky)
- Mobile check-in: Capacitor (iOS + Android) — rieši sa v samostatnej fáze
- Deploy: PM2 na VM za HAProxy/OPNsense (Hetzner Proxmox)

## Konvencie a zákazy
- PM2 ecosystem config žije v `~/ecosystem.config.cjs` na VM, NIE v repe.
- Secrets žijú v `~/ticketio-secrets.env` na VM, NIE v repe. V repe len `.env.example`.
- Build na VM vyžaduje `NODE_OPTIONS="--max-old-space-size=4096"`.
- html2canvas / jsPDF / html-to-image: VŽDY len dynamický client-only import (SSR build inak padá).
- Žiadne live queries na externé registre z frontendu — všetko cez server routes.
- Peniaze: sumy VŽDY v centoch ako integer, nikdy float. Mena EUR.
- Všetky mutácie cez server functions s validáciou (zod). Klient nikdy neurčuje cenu — cena sa vždy počíta na serveri z DB.
- RLS zapnuté na všetkých tabuľkách. Service role key len na serveri.
- Časy v DB v UTC (timestamptz), zobrazovanie v Europe/Bratislava.

## Doménové pravidlá
- Vstupenka = riadok v `tickets` s podpísaným QR: `TIK.{ticket_id}.{hmac_sha256(ticket_id + event_secret)}` (base64url, skrátený HMAC na 16 bajtov). Každý event má vlastný `qr_secret`.
- Objednávka drží rezerváciu kapacity 15 minút (`orders.expires_at`); expirované objednávky uvoľňuje pg_cron.
- Check-in je idempotentný: opakovaný sken vráti "už použitá" + čas prvého použitia, nikdy nespadne.
- GoPay webhook: overiť podpis/stav voči GoPay API (nikdy neveriť len payloadu), spracovanie idempotentné cez `payment_events` tabuľku.
- Kupón sa validuje a uplatňuje výhradne na serveri.
- Provízia platformy: konfigurovateľná per organizátor (`organizers.fee_percent`, `organizers.fee_min_cents`), default 4 % / min 0,40 €.

## Jazyk
- UI a všetky texty po slovensky (i18n štruktúra pripravená na CZ/EN neskôr).
- Kód, komentáre a commity po anglicky.

## Testovanie
- Vitest na doménovú logiku: výpočet ceny, kupóny, HMAC podpis/verifikácia QR, kapacitné rezervácie.
- Platobný flow testovať proti GoPay sandboxu.

## Git a spolupráca s Lovable
- Remote: `origin` = https://github.com/Patrik5461/ticket-flow.git, hlavná vetva `main` (žiadny `master`).
- Pred každým začiatkom práce: `git pull origin main`.
- Po každej dokončenej a odsúhlasenej fáze: commit + `git push origin main`.
- Repo je napojené na **Lovable**, ktorý commituje UI zmeny (routes, komponenty, štýly).
  - **UI vrstva (`src/routes/`, UI komponenty) patrí Lovable.**
  - **`src/server/`, `src/lib/` a `supabase/` patria Claude Code.**
  - Pri konflikte v súboroch sa spýtať používateľa, ale toto rozdelenie platí ako default.

## Auth
- Auth je cookie-based (httpOnly), spravuje ju výhradne server vrstva (server functions v `src/server/`, `src/lib/supabase/auth.ts` cez `@supabase/ssr`).
- Lovable NESMIE pridávať auth logiku, tokeny ani Supabase auth volania v klientovi — len UI formuláre napojené na existujúce server functions.
- Onboarding (vytvorenie `organizers` + `organizer_members` s rolou owner) rieši server fn.

## Deploy (fáza 2, zatiaľ len lokálny dev)
- VM podľa vzoru ostatných projektov: webhook deploy, PM2, HAProxy SNI routing na ticketio.sk.
- Pred buildom na VM zmazať stale build artefakty.
