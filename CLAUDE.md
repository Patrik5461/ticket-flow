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
- **OS env prebíja `--env-file`.** PM2 načítava secrets cez `node --env-file=~/ticketio-secrets.env`, ale ak tú istú premennú má vo svojom uloženom dumpe (`~/.pm2/dump.pm2`), vyhrá dump a zmena v súbore sa ticho ignoruje — vrátane prípadu, keď je v dumpe **prázdna** hodnota. `pm2 restart --update-env` to neopraví, len znova aplikuje ten istý dump. Po zmene secretu preto vždy over `tr '\0' '\n' < /proc/$(pm2 pid ticketio)/environ | grep <PREMENNÁ>` — tam sa premenná objaviť **nesmie**. Ak sa objaví, čistý reset je `pm2 delete ticketio && pm2 start ~/ecosystem.config.cjs && pm2 save`.
- Build na VM vyžaduje `NODE_OPTIONS="--max-old-space-size=4096"`.
- **`src/lib/env.ts` je server-only a musí ním aj zostať v bundli.** Zod schéma sa stavia lazy vo `buildSchema()`, nie na top-level — top-level `z.object({...})` je volanie, ktoré bundler nevie označiť za čisté, prežije tree-shaking a zoznam všetkých našich integrácií (GOPAY, RESEND, FAKTERO, ANTHROPIC, WALLET, CRON_SECRET) skončí v klientskom chunku. Po builde spusti `npm run verify:client-env` (`scripts/verify-client-env.mjs`) — hľadá názvy server-only premenných a service-role JWT vo všetkých `.output/public` chunkoch.
- html2canvas / jsPDF / html-to-image: VŽDY len dynamický client-only import (SSR build inak padá).
- Žiadne live queries na externé registre z frontendu — všetko cez server routes.
- Peniaze: sumy VŽDY v centoch ako integer, nikdy float. Mena EUR.
- Všetky mutácie cez server functions s validáciou (zod). Klient nikdy neurčuje cenu — cena sa vždy počíta na serveri z DB.
- RLS zapnuté na všetkých tabuľkách. Service role key len na serveri.
- **RLS filtruje riadky, nie stĺpce.** Tabuľky čítané anon kľúčom (`events`, `ticket_types`) majú preto stĺpcové granty: anon/authenticated dostávajú `GRANT SELECT (explicitný zoznam stĺpcov)`, nie tabuľkový `GRANT SELECT` (ten by prezradil aj tajné stĺpce ako `events.qr_secret`). **Každý nový stĺpec v anon-čitateľnej tabuľke sa musí explicitne pridať do column grantu** v migrácii (a nikdy tam nesmie ísť secret) — inak ho anon buď neuvidí (ak je verejný), alebo ho uvidí (ak by sa použil tabuľkový grant). Po každej takej zmene spusti `npm run probe:rls` (`scripts/rls-anon-probe.mjs`) — musí byť zelený. Secrety číta výhradne server cez `service_role`, ktorý granty aj RLS obchádza.
- Časy v DB v UTC (timestamptz), zobrazovanie v Europe/Bratislava.

## Supabase — ktorý projekt a ako ho sondovať

- **Ticketio je cloud projekt `upymwphlrkxcegnyslky`** (`SUPABASE_URL` v `~/ticketio-secrets.env`). Overuj ref, nie meno.
- **Pripojený MCP server `claude.ai Supabase ticketio` mieri na `upymwphlrkxcegnyslky`, teda na Ticketio** (overené 2026-08-03 cez `get_project_url`). Je to connector z claude.ai účtu (nie `.mcp.json`, nie `mcpServers` v `~/.claude.json`), takže sa dedí do každej session bez ohľadu na adresár — a rovnako sa môže bez varovania prepnúť inam: do 2026-08-03 mieril na `tmssxnluhjhzqmutflbl`, čo je Tendrik, CUDZÍ projekt. **Meno servera nie je dôkaz, ref áno.** Preto pred prvým dotazom v session vždy `get_project_url`; ak nevráti `upymwphlrkxcegnyslky`, MCP nepoužiť. `execute_sql` aj `apply_migration` idú naostro do toho projektu, ktorý connector práve drží — bez potvrdenia a bez stagingu.
- Ticketio DB sa sonduje **service-role kľúčom cez PostgREST**: `node --env-file=~/ticketio-secrets.env <skript>` a `fetch(`${SUPABASE_URL}/rest/v1/…`)` s hlavičkami `apikey` + `Authorization: Bearer`. Service role obchádza RLS aj granty, takže vidí aj server-only tabuľky (`app_settings`, `email_jobs`).
- Čo takto **nevidno**: PostgREST vystavuje len schémy `public` a `graphql_public` (`PGRST106 — Invalid schema` na čokoľvek iné). Cez REST teda neuvidíš:
  - schému `cron` — existenciu pg_cron jobov sa overiť nedá, len nepriamo z toho, že migrácia prebehla celá;
  - `supabase_migrations.schema_migrations` — stav migrácií na remote;
  - `pg_catalog` — indexy, constrainty, RLS policies. **OpenAPI spec na `/rest/v1/` ukáže len stĺpce, typy, defaulty a nullability (`required`), nič viac.**
- **Schému a stav migrácií si preto nehádaj — vypýtaj si ich od Patrika**, má na projekt priamy prístup (SQL editor v dashboarde). Odvodzovať existenciu indexu/constraintu z toho, čo je v repe alebo čo REST ukazuje, vedie k falošným poplachom: takto vznikol nahlásený „chýbajúci" partial index `venues_external_ref_public`, ktorý na produkcii celý čas bol.
- **Supabase CLI na VM je** — `npx supabase` (2.109.1, v `node_modules/.bin`), globálne na PATH nie je. **Repo ale nie je nalinkované** (`supabase/.temp/` neexistuje) a `SUPABASE_ACCESS_TOKEN` ani heslo k DB v `~/ticketio-secrets.env` nie sú, takže každý príkaz siahajúci na remote (`migration list`, `db push`, `db pull`) padne na `LegacyProjectNotLinkedError`. Link vyžaduje interaktívny `npx supabase login` — to spúšťa Patrik, nie Claude. `psql` na VM nie je.

## app_settings — konfigurácia pg_cron mostíkov

- Všetky pozadové úlohy idú cez most **pg_cron → `trigger_*()` → pg_net → `/api/cron/*` v appke**. Cieľovú URL a secret si `trigger_*` funkcie čítajú z tabuľky `app_settings`, ktorá sa **zámerne needituje migráciami** (aby secret nebol v repe) — seeduje sa ručne proti produkčnej DB.
- **Kým je riadok prázdny, funkcia ticho vráti `return` a úloha sa nikdy nevykoná.** Žiadna chyba, žiadny log — len sa nič nedeje. Takto boli od začiatku mŕtve všetky mostíky; naplnené 2026-07-31.
- Potrebných je 6 kľúčov: `cron_secret` (musí sa **presne zhodovať** s `CRON_SECRET` zo `~/ticketio-secrets.env`, inak route vráti 401), `cron_endpoint` (refundy), `email_cron_endpoint`, `invoice_cron_endpoint`, `waitlist_cron_endpoint`, `webhook_cron_endpoint` — všetky ako `${APP_URL}/api/cron/<route>`.
- **Pri zmene `CRON_SECRET` alebo `APP_URL` sa musí prepísať aj `app_settings`**, inak sa mostíky ticho rozbijú (nesúlad secretov = 401, stará URL = post do prázdna).
- Rýchla kontrola: `select key, value from app_settings order by key` — 6 riadkov, endpointy na aktuálnom `APP_URL`.

### Diagnostika: ticho v logu ≠ porucha

- Každá `trigger_*()` funkcia má **na začiatku gating count** a pri prázdnej fronte sa vráti **bez** volania `net.http_post`. Gating podmienky: `email_jobs` / `refund_jobs` / `webhook_deliveries` = `pending` alebo (`failed` a `attempts < max_attempts`); `settlements` = `invoice_status = 'none'` a `fee_cents > 0`; `waitlist_entries` = `waiting` na type, kde `sold_count < capacity`.
- Preto sa **nedá diagnostikovať cez „chodia requesty do nginxu?"** — pri prázdnych frontách ich tam legitímne nie je ani jeden. Správna otázka je **„je vo fronte práca?"**: najprv zisti počty v tých piatich tabuľkách, a až keď je práca a request nechodí, hľadaj chybu v `app_settings` / pg_net.
- Overenie appky bez zápisu do DB: POST na `${APP_URL}/api/cron/<route>` s hlavičkou `x-cron-secret`. Pri prázdnej fronte je to no-op drain — vráti `200` a `{"processed":0,…}`, nič neodošle. Otestuje nginx → route → auth, ale **nie** pg_net egress.
- Že pg_net naozaj vyšiel zo Supabase cloudu von, sa pozná v `/var/log/nginx/access.log` podľa **User-Agent `pg_net/<verzia>`** (skupina `adm` ho číta bez sudo). Requesty z VM majú UA `node` alebo `curl`.
- **Stav k 2026-07-31:** úsek `trigger_*()` → pg_net → nginx → worker → Resend overený jedným testovacím `email_jobs` riadkom — `status = 'sent'` do 3 s, v nginx logu `POST /api/cron/process-email … 200 "pg_net/0.20.3"`, e-mail doručený. Všetkých 5 workerov vracia `200` na aktuálny `CRON_SECRET`.
- **Aj samotné pg_cron plánovanie je overené** (2026-07-31, pasívny test): do fronty šiel jeden claimable riadok a **RPC sa nevolalo** — request `POST /api/cron/process-email … "pg_net/0.20.3"` prišiel sám o `11:00:00`, teda na hranici `*/5`, a job bol `sent` do 40 s. Cron job `process-email-jobs` teda existuje a beží. Ak by bolo treba overiť to znova, toto je postup: claimable riadok do fronty, žiadne RPC, sleduj nginx log. Cez REST schému `cron` vidieť nie je, `select * from cron.job` ide len z dashboard SQL editora.

## Doménové pravidlá

- Vstupenka = riadok v `tickets` s podpísaným QR: `TIK.{ticket_id}.{hmac_sha256(ticket_id + event_secret)}` (base64url, skrátený HMAC na 16 bajtov). Každý event má vlastný `qr_secret`.
- Objednávka drží rezerváciu kapacity 15 minút (`orders.expires_at`); expirované objednávky uvoľňuje pg_cron.
- Check-in je idempotentný: opakovaný sken vráti "už použitá" + čas prvého použitia, nikdy nespadne.
- GoPay webhook: overiť podpis/stav voči GoPay API (nikdy neveriť len payloadu), spracovanie idempotentné cez `payment_events` tabuľku.
- Kupón sa validuje a uplatňuje výhradne na serveri.
- Provízia platformy: konfigurovateľná per organizátor (`organizers.fee_percent`, `organizers.fee_min_cents`), default 4 % / min 0,40 €.

## Knižnica hál (import z MaxiTicketu)

- Zdieľanú knižnicu miest konania (`venues.organizer_id is null` + `is_public`) naplnil `scripts/import-halls.ts` z exportu starého MaxiTicketu. Stav: 456 hál / 456 máp / 253 687 sedadiel.
- **Zdrojový export v repe nie je a nebude** (59 MB, `tmp/` je v `.gitignore`) a jeho umiestnenie sa z kódu nedá zistiť. Existuje len na produkčnej VM:
  - rozbalený v `~/ticketio/tmp/maxiticket-export-hall/` — 485 podadresárov, v každom `hall.json`, plus `halls.csv`;
  - archív `~/maxiticket-export-hall.zip` (3,8 MB).

  V čistom klone teda import spustiť **nejde**, aj keď to tak z repa vyzerá. Ak by tieto dáta z VM zmizli, knižnica sa nedá postaviť nanovo — inde záloha nie je.
- Cesta k exportu je povinný argument, žiadny default:
  ```bash
  cd ~/ticketio
  node scripts/import-halls.ts tmp/maxiticket-export-hall                 # dry run, DB netreba
  node --env-file=~/ticketio-secrets.env \
    scripts/import-halls.ts tmp/maxiticket-export-hall --commit           # zápis
  ```
- Re-import je idempotentný a prepisuje mapy in place (`--resume` sa pri prepise nepoužíva). **Výnimka: hala alebo mapa s `import_locked_at` bola ručne opravená cez `/admin/haly` a import ju nechá úplne na pokoji vrátane sedadiel**; na konci behu vypíše, čo preskočil. Späť pod import ju vráti pomenovaná akcia „Vrátiť pod import" v `/admin/haly`. Mapa už použitá v podujatí sa preskočí vždy.
- **Ručná oprava sa do zdrojového exportu nepremietne** — `hall.json` ostáva chybný. Pri stavbe knižnice od nuly by opravy boli preč; jediná stopa, ktorých hál sa to týka, je zoznam zamknutých z výpisu importu.
- Pri kontrolách čísel odfiltruj organizátorské mapy — importované nesú `external_ref like 'mt:%'`, ostatné do knižnice nepatria.

## Jazyk

- UI a všetky texty po slovensky (i18n štruktúra pripravená na CZ/EN neskôr).
- Kód, komentáre a commity po anglicky.

## GoPay

- Env premenné (hodnoty len v `~/ticketio-secrets.env`, nikdy v repe): `GOPAY_GOID`, `GOPAY_CLIENT_ID`, `GOPAY_CLIENT_SECRET`, `GOPAY_ENV`, `APP_URL`.
- `GOPAY_ENV` je `sandbox` | `production` a **odvodzuje API URL** (`src/lib/gopay.ts`): sandbox `https://gw.sandbox.gopay.com/api`, produkcia `https://gate.gopay.cz/api`. Base URL sa nikdy nepíše ručne inde.
- `APP_URL` je jediný zdroj pre `return_url` aj `notification_url` — a zároveň pre odkazy na objednávku v e-mailoch. Zmena `APP_URL` teda mení oboje naraz.
- Refund potrebuje OAuth scope `payment-all`; vytvorenie platby `payment-create`.
- Shareable key (`gopay.js`, embedded brána) sa **nepoužíva** — brána beží redirectom na `gw_url`. Ak sa embedded režim niekedy nasadí, pribudne premenná na shareable key.

### Sandbox testovanie

- Testovacie karty: MasterCard `5447380000000006`, VISA `4444444444444448`. CVC ľubovoľné 3 číslice, expirácia ľubovoľný budúci dátum.
- **Výsledok autorizácie určujú posledné dve číslice sumy**, nie karta: suma končiaca na `.00` → autorizácia prejde, `.04` → zamietnutá. Testovacie ceny vstupeniek preto nastavuj na celé eurá, inak sa sandbox správa nepredvídateľne.
- Sandbox portál: `https://partner.sandbox.gopay.com/`. Prevodom platený test sa potvrdzuje na `https://partner.sandbox.gopay.com/gp-gateways/bank/gateway.action` (stav sa preklopí na Paid do ~3 min).
- Apple Pay sa v sandboxe simulovať nedá.

## E-maily (Resend)

- Env premenné (hodnoty len v `~/ticketio-secrets.env`): `RESEND_API_KEY`, `EMAIL_FROM`.
- Provider sa vyberá podľa env (`src/lib/email/index.ts`): neprázdny `RESEND_API_KEY` → `ResendEmailProvider`, inak konzolový provider (dev). `EMAIL_FROM` musí byť adresa na doméne overenej v Resende — `ticketio.sk` overená je.
- Kľúč je **restricted (len odosielanie)**. Taký kľúč nemá právo na `GET /domains`, čo je presne to, čím sa sonduje zdravie — Resend vráti 401 s `name: "restricted_api_key"`. `checkResend()` (`src/server/health.ts`) to vyhodnocuje ako `ok`, nie ako neplatný kľúč; pokryté testami v `health.test.ts`. Ak sa kľúč vymení za plnoprávny, sonda vráti 200 a správa sa rovnako.

## Testovanie

- Vitest na doménovú logiku: výpočet ceny, kupóny, HMAC podpis/verifikácia QR, kapacitné rezervácie.
- Platobný flow testovať proti GoPay sandboxu.
- **Po každej migrácii dotýkajúcej sa RLS over anon probe verejného čítania** (anon client dotaz na verejné dáta — napr. published eventy a ich ticket types). RLS policy, ktorá v subquery číta inú tabuľku s RLS bez anon policy, ticho skryje verejné dáta; na takéto cross-table checky používaj SECURITY DEFINER funkciu (vzor `is_org_member`, `organizer_is_active`).

## Git a spolupráca s Lovable

- Remote: `origin` = `git@github.com:Patrik5461/ticket-flow.git`, hlavná vetva `main` (žiadny `master`).
- Z VM sa pushuje cez **deploy key** (`~/.ssh/id_ed25519`), preto je remote SSH, nie HTTPS. Ak `git push` zlyhá na `could not read Username for 'https://github.com'`, remote je prepnutý na HTTPS — oprav cez `git remote set-url origin git@github.com:Patrik5461/ticket-flow.git`.
- Git identita na VM je repo-lokálna (`git config user.email` v `~/ticketio`), globálna neexistuje. Bez nej `git commit` zlyhá na „Author identity unknown".
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

**Najprv zisti, kde bežíš.** Claude Code session môže bežať priamo na produkčnej VM. Over `hostname` — ak vráti `ticketio` (resp. `hostname -I` → `192.168.1.15`), si na VM a **SSH nepoužívaj**, choď rovno na „Deploy z VM" nižšie. Inak deployuj cez SSH.

**Prístup (z lokálneho stroja):** `ssh ticketio` → `patrik@192.168.1.15`, ProxyJump cez `pve` (`root@116.202.234.213`), rovnaký viac-hopový vzor ako preversi. Ak blok chýba v `~/.ssh/config`, pridaj:

```
Host ticketio
    HostName 192.168.1.15
    User patrik
    ProxyJump pve
```

**Kde:** repo v `~/ticketio` (nie `/opt/...`), build v `.output/`, beží pod PM2 ako proces `ticketio` (fork mód), Nitro počúva na `127.0.0.1:3000` za HAProxy/OPNsense SNI routingom na ticketio.sk. Secrets v `~/ticketio-secrets.env`, PM2 ecosystem v `~/ecosystem.config.cjs` (obe NIE v repe).

**Deploy z VM (keď už na nej bežíš — bez SSH):**
```bash
cd ~/ticketio &&
  git remote -v &&                                   # musí byť ticket-flow.git; ak nie, STOP
  git fetch origin main && git checkout main && git pull origin main &&
  git log --oneline -1 &&                            # over očakávaný commit
  npm ci &&
  rm -rf .output &&
  NODE_OPTIONS="--max-old-space-size=4096" npm run build &&
  npm run verify:polyfill &&
  npm run verify:client-env &&
  pm2 restart ticketio --update-env && pm2 save
```
> **`npm run build` na VM = výpadok, kým nereštartuješ PM2.** Build prepíše `.output/`, ale bežiaci proces má v pamäti starý server, ktorý v SSR HTML odkazuje na staré asset hashe — a tie build práve zmazal. Verejná stránka vracia 500 na entry chunk až do `pm2 restart`. Preto:
> - **Nikdy nebuilduj na VM „len na overenie".** Na overenie zmien stačí `npx tsc --noEmit` a `npx vitest run` — tie `.output/` nechajú na pokoji.
> - Ak build musíš spustiť, počítaj s tým, že si sa zaviazal hneď aj reštartovať. Build + `pm2 restart` patria k sebe ako jeden krok.
> - Ak buildeš z rozrobeného working tree, nasadzuješ tým necommitnutý kód. Buď to commitni a pushni, alebo sa vráť na `main`, prebuilduj a reštartuj.

**Rollback na poslednú nasadenú verziu:** `git checkout main && NODE_OPTIONS="--max-old-space-size=4096" npm run build && pm2 restart ticketio --update-env`. Staré `.output/` sa nedá obnoviť — jediná cesta späť je prebuild z gitu.

**Manuálny deploy (z lokálneho stroja, keď webhook nestačí):**
```bash
ssh ticketio 'cd ~/ticketio &&
  git remote -v &&                                   # musí byť ticket-flow.git; ak nie, STOP
  git fetch origin main && git checkout main && git pull origin main &&
  git log --oneline -1 &&                            # over očakávaný commit
  npm ci &&
  rm -rf .output &&                                  # zmazať stale artefakty
  NODE_OPTIONS="--max-old-space-size=4096" npm run build &&
  npm run verify:polyfill &&                         # poistka mobilného polyfillu
  npm run verify:client-env &&                       # nič server-only v klientskom bundli
  pm2 restart ticketio --update-env && pm2 save'
```

**Over po deployi:**
- `curl -s http://127.0.0.1:3000/api/health` (z VM; inak cez `ssh ticketio '…'`) → `{"status":"ok","db":true}` — localhost je spoľahlivejší než verejná URL zvnútra VM.
- Zmenený entry asset hash: `curl -s https://ticketio.sk/ | grep -aoE '/assets/index-[^"]+\.js'` — po úspešnom builde sa musí líšiť od predošlého.
- Migrácie Supabase aplikuj samostatne (nie sú súčasťou VM buildu) — DB je cloud Supabase; RPC/tabuľky over service-role probe, nie len z migračných súborov.
