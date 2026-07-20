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
| 2 | Tri obrazovky: prihlásenie → zoznam podujatí → skener | — |
| 3 | Offline režim (lokálna DB, lokálne overenie HMAC, sync) | — |
| 4 | Build a distribúcia (TestFlight, APK / Play Console) | — |

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

Kompletné inštrukcie na build a vydanie (TestFlight / Play Console) sú v **Bloku 4**.
