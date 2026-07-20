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
| 3 | Offline režim (lokálna DB, lokálne overenie HMAC, sync) | odložené na v2 |
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
