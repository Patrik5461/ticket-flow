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
- **Po každej migrácii dotýkajúcej sa RLS over anon probe verejného čítania** (anon client dotaz na verejné dáta — napr. published eventy a ich ticket types). RLS policy, ktorá v subquery číta inú tabuľku s RLS bez anon policy, ticho skryje verejné dáta; na takéto cross-table checky používaj SECURITY DEFINER funkciu (vzor `is_org_member`, `organizer_is_active`).

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

## Deploy (produkčná VM)

**Prístup:** `ssh ticketio` → `patrik@192.168.1.15`, ProxyJump cez `pve` (`root@116.202.234.213`), rovnaký viac-hopový vzor ako preversi. Ak blok chýba v `~/.ssh/config`, pridaj:

```
Host ticketio
    HostName 192.168.1.15
    User patrik
    ProxyJump pve
```

**Kde:** repo v `~/ticketio` (nie `/opt/...`), build v `.output/`, beží pod PM2 ako proces `ticketio` (fork mód), Nitro počúva na `127.0.0.1:3000` za HAProxy/OPNsense SNI routingom na ticketio.sk. Secrets v `~/ticketio-secrets.env`, PM2 ecosystem v `~/ecosystem.config.cjs` (obe NIE v repe).

**Manuálny deploy (keď webhook nestačí):**
```bash
ssh ticketio 'cd ~/ticketio &&
  git remote -v &&                                   # musí byť ticket-flow.git; ak nie, STOP
  git fetch origin main && git checkout main && git pull origin main &&
  git log --oneline -1 &&                            # over očakávaný commit
  npm ci &&
  rm -rf .output &&                                  # zmazať stale artefakty
  NODE_OPTIONS="--max-old-space-size=4096" npm run build &&
  npm run verify:polyfill &&                         # poistka mobilného polyfillu
  pm2 restart ticketio --update-env && pm2 save'
```

**Over po deployi:**
- `ssh ticketio 'curl -s http://127.0.0.1:3000/api/health'` → `{"status":"ok","db":true}` (localhost je spoľahlivejší než verejná URL zvnútra VM).
- Zmenený entry asset hash: `curl -s https://ticketio.sk/ | grep -aoE '/assets/index-[^"]+\.js'` — po úspešnom builde sa musí líšiť od predošlého.
- Migrácie Supabase aplikuj samostatne (nie sú súčasťou VM buildu) — DB je cloud Supabase; RPC/tabuľky over service-role probe, nie len z migračných súborov.
