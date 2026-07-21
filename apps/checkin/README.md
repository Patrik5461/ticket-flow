# Ticketio Scan

Natívna check-in aplikácia pre organizátorov (Capacitor, iOS + Android).
**Slúži výhradne na skenovanie vstupeniek.** Žiadny admin, žiadna správa
podujatí, žiadne objednávky, tržby ani nastavenia.

## Prečo samostatná, minimalistická appka

Appku má v telefóne pracovník na vstupe — často na požičanom alebo zdieľanom
zariadení. Preto ukazuje iba **zoznam podujatí + skener** a nič viac. Aj keby sa
niekto k odomknutému zariadeniu dostal, nedostane sa k tržbám, objednávkam ani k
správe eventov.

- Prihlásiť sa môže **ktorýkoľvek člen organizátora** — rola `owner`, `admin`
  aj `checkin`. Autorizácia je rovnaká ako na webe (`organizer_members`).
- **Platform admin (super-admin) nemá v appke žiadne špeciálne práva** — vidí to
  isté ako bežný člen.
- Odporúčanie pre organizátorov: brigádnikom na vstupe vytvorte účet s rolou
  **`checkin`** — ten vie len skenovať a k ničomu inému sa nedostane.

## Architektúra

- SPA (Vite + React) zabalená Capacitorom do natívnej appky. Zdieľa API s
  hlavnou appkou — appka **nemá vlastnú serverovú logiku**, volá existujúce
  endpointy (`POST /api/checkin`).
- Natívne skenovanie cez **`@capacitor-mlkit/barcode-scanning`** (Google MLKit)
  — nie jsQR. Kamera beží natívne za priehľadným webview; fullscreen farebná
  odozva sa kreslí ako HTML navrchu.
- Prihlásenie: Supabase Auth priamo v appke (token + refresh, uložený natívne),
  takže session drží natrvalo a auto-obnovuje sa. *(Blok 2.)*

## Bloky

| Blok | Obsah | Stav |
|------|-------|------|
| 1 | Capacitor projekt, konfigurácia, ikona + splash, dark shell | **hotové** |
| 2 | Tri obrazovky: prihlásenie → zoznam podujatí → skener | **hotové** |
| 3a | Offline režim — stiahnutie dát na zariadenie | **hotové** |
| 3b | Offline skenovanie (lokálne overenie + fronta) | **hotové** |
| 3c | Synchronizácia fronty + konflikty | **hotové** |
| 3d | Testy a overenie | **hotové** |
| 4 | Build a distribúcia (TestFlight, APK / Play Console) | **hotové** → [BUILD.md](./BUILD.md) |

### Blok 2 — ako to funguje

- **Prihlásenie:** `supabase.auth.signInWithPassword`, session uložená v natívnych
  Preferences (`src/lib/supabase.ts`) → drží natrvalo, token sa auto-obnovuje.
- **Zoznam podujatí:** čisto klientsky cez Supabase RLS (`events_member_read` +
  `tickets_member_read`) — žiadny serverový endpoint. Ktorákoľvek rola člena
  (owner/admin/checkin) vidí svoje eventy + počet odbavených/celkom.
- **Skener:** natívny MLKit (`@capacitor-mlkit/barcode-scanning`) beží za
  priehľadným webview; fullscreen farebná odozva + odpočet (2 s ok / 4 s chyba)
  + „Skenovať ďalší" / „Zostať" navrchu. Kamera sa medzi skenmi nezastavuje.
- **Check-in:** volá existujúce `POST /api/checkin` s hlavičkou
  `Authorization: Bearer <supabase access token>` cez `CapacitorHttp` (natívne
  HTTP obchádza CORS; Supabase klient používa bežný fetch). Endpoint teraz
  akceptuje Bearer token **len tu** (spätne kompatibilné s cookie); admin/tržby/
  exporty ostávajú cookie-only. Autorizácia je identická — kontrola členstva v
  `organizer_members` prebehne rovnako ako pri webe.

### Blok 3a — offline dáta

V zozname podujatí má každý event pásik **„Stiahnuť pre offline"**. Stiahnutie
volá nový endpoint `GET /api/offline-bundle` (stránkovane po 500 vstupenkách,
s ukazovateľom priebehu) a uloží dáta do natívnych Preferences
(`src/lib/offline.ts`). Zobrazuje sa počet vstupeniek a **čas poslednej
aktualizácie** — po 2 hodinách zožltne, nech pracovník vidí, že má staré dáta.

#### ⚠️ Bezpečnosť — na zariadení NIE JE `qr_secret`

Kto má `qr_secret` eventu, vie vyrobiť platné QR kódy. Preto sa **nesťahuje**.
Namiesto neho posiela server pre každú vstupenku **SHA-256 odtlačok celého QR
tokenu**. Skener zahashuje to, čo naskenoval, a odtlačok vyhľadá — falzifikát
neprejde (bez tokenu sa jeho hash nedá vyrobiť), ale z telefónu sa nedá vytiahnuť
nič, čím by sa dala vstupenka sfalšovať.

Dôsledok, s ktorým appka počíta: vstupenka predaná **až po** stiahnutí dát v
balíku nie je. Offline ju skener označí ako **„Neznáma vstupenka — over
online"**, nikdy nie ako neplatnú (Blok 3b).

Stiahnuté dáta obsahujú mená návštevníkov, takže sa mažú:

- **pri odhlásení** (`SIGNED_OUT` → zmaže všetky balíky vrátane fronty),
- **ručne** tlačidlom „Zmazať" pri evente,
- **automaticky 24 h po skončení eventu** (kontrola pri každom otvorení zoznamu).

> **Odporúčanie pre organizátorov:** offline dáta sťahujte len na zariadenia,
> ktoré máte pod kontrolou, a po evente ich zmažte (alebo sa odhláste). Na
> požičanom telefóne sa po skončení práce vždy odhláste — tým sa lokálne dáta
> zmažú okamžite.

Sťahovať smie len člen organizátora daného eventu — endpoint má rovnakú
autorizáciu ako `/api/checkin` (Bearer token → členstvo v `organizer_members` →
vlastníctvo eventu).

### Blok 3b — offline skenovanie

Skener skúša **najprv server**. Ak požiadavka zlyhá (alebo je zariadenie
offline), vyhodnotí sken **lokálne** z bundlu (`src/lib/offline-scan.ts`) —
zahashuje naskenovaný string a nájde odtlačok. Vypršaná session (401) sa na
lokálne dáta **neprepína**, tá vedie na prihlásenie.

Rozhodovacia tabuľka je zámerne rovnaká ako na serveri, vrátane Fázy 23:

| Stav v lokálnych dátach | `allow_reentry` | Výsledok |
|---|---|---|
| nie je v bundli | – | **Neznáma vstupenka** (oranžová, „over online") |
| `cancelled` | – | Zrušená vstupenka |
| `valid` | – | Vstup povolený → lokálne označená ako použitá + do fronty |
| `used` | vypnuté | Už použitá (čas prvého vstupu) |
| `used` | zapnuté | **Opätovný vstup** (N. vstup, čas predošlého) + do fronty |

Pri opätovnom vstupe zostáva vstupenka `used` a rastie len počítadlo vstupov —
počet odbavených sa nemôže započítať dvakrát, rovnako ako na serveri.

Ďalšie správanie:

- **Bez siete a bez stiahnutých dát** → celoobrazovkové „Chýbajú offline dáta —
  pripoj sa k internetu alebo stiahni dáta".
- Každý offline výsledok má odznak **„OFFLINE · overené lokálne"**; v hlavičke
  skenera je stav pripojenia a počet skenov čakajúcich na odoslanie.
- Fronta (`src/lib/queue.ts`) je v Preferences, takže **prežije reštart appky**.
  Zariadenie sa označuje stabilným `deviceLabel` (napr. „Ticketio Scan · A3F91C")
  — ten ide aj do online skenov, takže v audite vidno, ktorý telefón odbavil.
- Odhlásenie s neodoslanými skenmi si vypýta potvrdenie (dáta sa mažú).

### Blok 3c — synchronizácia

Fronta sa odosiela cez existujúce `POST /api/checkin` (idempotentné), a to
**automaticky** po prihlásení, po obnovení siete (`online` udalosť) a po návrate
appky z pozadia — plus ručne tlačidlom **„↑ Synchronizovať"**. Stav je zdieľaný
medzi zoznamom podujatí a skenerom (`src/lib/sync.ts`): bodka online/offline,
počet čakajúcich, priebeh „Odosielam 3 / 12…".

- **Záznam mizne z fronty až keď naň server odpovedal.** Ak sa spojenie preruší
  v polovici, zvyšok zostáva vo fronte a ďalší pokus pokračuje tam, kde skončil.
- **Vypršaná session počas synchronizácie appku neodhlási** — odhlásenie by
  zmazalo práve tú frontu, ktorú sa snažíme zachrániť. Zobrazí sa hláška a dáta
  zostávajú.
- **Konflikty sa nikdy nezahodia.** Ak bola vstupenka medzitým použitá online
  alebo na inom zariadení, server ju neodbaví a appka to ukáže ako
  „Pri synchronizácii: 2 vstupenky boli už použité inde" **so zoznamom
  konkrétnych vstupeniek** (ref, meno, dôvod). Report je uložený lokálne, takže
  ho nezmaže ani reštart appky — mizne až po potvrdení „Rozumiem".

> **Známy kompromis:** doručenie je *at-least-once*. Ak server sken zapíše, ale
> odpoveď sa stratí, záznam zostane vo fronte a pošle sa znova — potom sa
> ohlási ako konflikt (`už použitá`), resp. pri zapnutom opätovnom vstupe
> pribudne jeden vstup navyše. Stratiť odbavenie by bolo horšie než ohlásiť ho
> dvakrát.

### Blok 3d — testy

```bash
cd apps/checkin && npm test     # 26 testov offline vrstvy (vitest)
npm test                        # v koreni repa: serverová strana
```

Appka (`src/lib/*.test.ts`) — `@capacitor/preferences` je nahradené in-memory
mockom; `vi.resetModules()` so zachovaným úložiskom simuluje **reštart appky**:

- rozhodovacia tabuľka offline skenu vrátane re-entry (vstupenka zostáva `used`,
  rastie len počítadlo → odbavených sa nezapočíta dvakrát),
- neznámy kód → `unknown`, nie `invalid`, a **nejde do fronty**,
- stiahnutie po stránkach, priebeh, a že sa **nikde neuloží žiadny secret**,
- zlyhané sťahovanie nepoškodí predošlý balík,
- retencia: 24 h po konci eventu sa dáta zmažú, predtým nie,
- odhlásenie zmaže vstupenky, frontu **aj report konfliktov** (sú v ňom mená),
- fronta prežije reštart appky,
- synchronizácia: konflikt sa ohlási s konkrétnou vstupenkou, prerušené
  spojenie ponechá zvyšok vo fronte a ďalší pokus dobehne, vypršaná session
  neodhlási a nič nestratí, report konfliktov prežije reštart.

Server (`src/server/offline-bundle*.test.ts`) — 13 testov: autorizačný reťazec
(429/401/403/403/400), stránkovanie, a hlavne že payload obsahuje **SHA-256
odtlačky a ani stopu po `qr_secret`**, plus že sa počítajú len skutočné vstupy
(`ok` + `reentry`).

> Čo testy pokryť nevedia: skutočná kamera, prepnutie do režimu v lietadle a
> reálny beh proti produkcii. To je overenie na zariadení — postup nižšie.

## Prvé spustenie (Blok 1)

Predpoklady: Node 20+, a pre natívne buildy **Xcode + CocoaPods** (iOS) resp.
**Android Studio + SDK** (Android).

```bash
cd apps/checkin
cp .env.example .env          # doplň Supabase URL/anon key a API base
npm install
npm run build                 # skompiluje web vrstvu do dist/

# vygeneruj natívne projekty (spúšťaj lokálne, potrebujú natívne SDK)
npx cap add ios
npx cap add android

# vygeneruj ikony a splash zo /assets do oboch platforiem
npm run assets

# skopíruj web build + plugin config do natívnych projektov
npx cap sync
```

### Povolenie kamery (nutné pre MLKit skener)

Pridá sa do natívnych projektov (podrobný postup v Bloku 4):

- **iOS** — `ios/App/App/Info.plist`:
  ```xml
  <key>NSCameraUsageDescription</key>
  <string>Kamera slúži na skenovanie QR kódov vstupeniek pri vstupe.</string>
  ```
- **Android** — `android/app/src/main/AndroidManifest.xml`:
  ```xml
  <uses-permission android:name="android.permission.CAMERA" />
  ```

## Otvorenie v IDE

```bash
npm run open:ios       # Xcode
npm run open:android   # Android Studio
```

Kompletné inštrukcie na build a vydanie (TestFlight / Play Console), povolenia
kamery, verziovanie a riešenie problémov sú v **[BUILD.md](./BUILD.md)**.
