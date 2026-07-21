# Ticketio Scan — build & distribúcia

Kompletný postup na zostavenie a vydanie appky pre iOS (TestFlight) a Android
(APK / Play Console). Verzia **v1 je online-only** (offline režim je odložený na
v2). Všetky natívne kroky sa robia lokálne — potrebuješ macOS + Xcode (iOS) a
Android Studio + JDK 17 (Android).

---

## 0. Predpoklady

| Nástroj | Verzia | Na čo |
|---------|--------|-------|
| Node | 20+ | web build |
| Xcode | 15+ | iOS build, TestFlight (len macOS) |
| CocoaPods | `sudo gem install cocoapods` | iOS natívne závislosti |
| Android Studio | Hedgehog+ | Android build |
| JDK | 17 | Android/Gradle |
| Apple Developer účet | platený | podpis + TestFlight |
| Google Play Console | jednorazový $25 | Play distribúcia (APK ide aj bez) |

---

## 1. Jednorazová inicializácia

```bash
cd apps/checkin
cp .env.example .env          # doplň VITE_SUPABASE_URL, _ANON_KEY, VITE_API_BASE=https://ticketio.sk
npm install
npm run build                 # dist/
npx cap add ios
npx cap add android
npm run assets                # ikony + splash zo /assets do oboch platforiem
npx cap sync
```

Potom nastav **povolenie kamery** (bez toho skener nenaskočí) — časť 4.

---

## 2. Bežný build cyklus (po každej zmene web kódu)

```bash
npm run sync        # = npm run build && cap sync  (skopíruje web + plugin config)
npm run open:ios    # otvorí Xcode
npm run open:android
```

---

## 3. Verziovanie

- Marketingová verzia: `package.json` → `version` (napr. `1.0.0`).
- **iOS** (`ios/App/App.xcodeproj`, target App → General):
  `Version` = 1.0.0, `Build` = zvyšuj pri každom uploade do TestFlight (1, 2, 3…).
- **Android** (`android/app/build.gradle`):
  `versionName "1.0.0"`, `versionCode` = zvyšuj celé číslo pri každom builde.

---

## 4. Povolenie kamery (POVINNÉ)

### iOS — `ios/App/App/Info.plist`
```xml
<key>NSCameraUsageDescription</key>
<string>Kamera slúži na skenovanie QR kódov vstupeniek pri vstupe na podujatie.</string>
```
Deployment target: v Xcode (target App → General → Minimum Deployments) nastav
**iOS 15.5+** (vyžaduje Google MLKit barcode pod).

### Android — `android/app/src/main/AndroidManifest.xml`
V `<manifest>`:
```xml
<uses-permission android:name="android.permission.CAMERA" />
```
V `<application>` (predinštaluje MLKit model, aby skener fungoval hneď po
inštalácii, nie až po prvom stiahnutí modelu):
```xml
<meta-data
    android:name="com.google.mlkit.vision.DEPENDENCIES"
    android:value="barcode_ui" />
```
`android/variables.gradle`: `minSdkVersion = 22` (Capacitor 6 default) je OK.

> App volá `https://ticketio.sk` a Supabase cez HTTPS s platným certifikátom —
> žiadne ATS/cleartext výnimky netreba.

---

## 4b. Tmavé pozadie a orientácia (natívna vrstva)

Appka je **dark-only a len na výšku**. Nastavené je to natívne, nie v CSS — CSS
sa k safe-area pruhom (pod Dynamic Islandom / nad home indikátorom) nedostane:
Capacitor nastavuje `view = webView`, takže čokoľvek nenamaľuje HTML, maľuje
**natívne pozadie WKWebView**. Ak sa farba z configu nechytí, Capacitor
fallbackuje na `UIColor.systemBackground` = **biela v light móde** — to bol ten
biely pruh hore.

iOS (už aplikované v repe):

| Súbor | Zmena |
|---|---|
| `capacitor.config.ts` | `ios.contentInset: 'never'` — webview kreslí edge-to-edge; odsadenie rieši `env(safe-area-inset-*)` v CSS |
| `ios/App/App/AppDelegate.swift` | `MainViewController: CAPBridgeViewController` — `isOpaque = true`, `backgroundColor`/`scrollView.backgroundColor` = `#09090b`, `overrideUserInterfaceStyle = .dark`, `preferredStatusBarStyle = .lightContent`; `window.backgroundColor` tiež |
| `ios/App/App/Base.lproj/Main.storyboard` | `customClass="MainViewController" customModule="App"` |
| `ios/App/App/Info.plist` | `UIUserInterfaceStyle = Dark`, `UIStatusBarStyle = UIStatusBarStyleLightContent`, `UISupportedInterfaceOrientations` (aj `~ipad`) = len `UIInterfaceOrientationPortrait` |
| `ios/App/App/Base.lproj/LaunchScreen.storyboard` | pozadie natvrdo `#09090b` (nie `systemBackgroundColor`) |

Android (doplniť pri `npx cap add android`) — `android/app/src/main/AndroidManifest.xml`,
na `<activity android:name=".MainActivity">`:
```xml
android:screenOrientation="portrait"
```
a v `android/app/src/main/res/values/styles.xml` maj `windowBackground` = `#09090b`
(Capacitor to preberá z `android.backgroundColor` v `capacitor.config.ts`).

---

## 5. iOS → TestFlight

1. `npm run sync && npm run open:ios`
2. V Xcode: target **App** → **Signing & Capabilities** → zvoľ svoj **Team**
   (automatic signing). Bundle Identifier musí byť `sk.ticketio.scan`.
3. Zvýš **Build** number (časť 3).
4. Hore vyber cieľ **Any iOS Device (arm64)** (nie simulátor).
5. **Product → Archive**. Po dokončení sa otvorí Organizer.
6. **Distribute App → App Store Connect → Upload**.
7. V [App Store Connect](https://appstoreconnect.apple.com) → TestFlight →
   po spracovaní buildu pridaj interných testerov (stačí ich Apple ID e-mail).
   Testeri dostanú pozvánku do appky **TestFlight** a nainštalujú si Ticketio Scan.

> Prvý build vyžaduje vytvoriť app záznam v App Store Connect
> (Bundle ID `sk.ticketio.scan`, názov „Ticketio Scan").

---

## 6. Android

### 6a. Rýchly test — debug APK (bez Play Console)
```bash
npm run sync
cd android
./gradlew assembleDebug
# APK: android/app/build/outputs/apk/debug/app-debug.apk
```
Pošli `app-debug.apk` na telefón (e-mail / USB / `adb install app-debug.apk`).
Na zariadení povoľ „Inštalovať neznáme aplikácie".

### 6b. Podpísaný release (Play Console alebo distribúcia APK)
1. Vytvor keystore (raz):
   ```bash
   keytool -genkey -v -keystore ticketio-scan.keystore \
     -alias ticketio-scan -keyalg RSA -keysize 2048 -validity 10000
   ```
   Ulož keystore + heslá **mimo repa** (napr. do password manageru).
2. `android/keystore.properties` (git-ignored):
   ```properties
   storeFile=/absolutna/cesta/ticketio-scan.keystore
   storePassword=…
   keyAlias=ticketio-scan
   keyPassword=…
   ```
   a v `android/app/build.gradle` načítaj signingConfig (štandardný Capacitor
   release recept).
3. Build AAB pre Play:
   ```bash
   ./gradlew bundleRelease
   # AAB: android/app/build/outputs/bundle/release/app-release.aab
   ```
4. [Play Console](https://play.google.com/console) → vytvor appku „Ticketio Scan"
   (`sk.ticketio.scan`) → **Internal testing** → nahraj AAB → pridaj testerov
   (e-maily) → pošli im opt-in link. (Interné testovanie nevyžaduje recenziu.)

---

## 7. Odporúčanie pre organizátorov (dôležité)

> **Pre brigádnikov na vstupe vytvorte samostatný účet s rolou `checkin`.**
> Taký účet vie v appke **len skenovať** — nevidí tržby, objednávky, nastavenia
> ani správu podujatí, a to ani keby sa niekto k odomknutému telefónu dostal.
> Owner/admin účty fungujú tiež, ale na vstup dávajte `checkin` — je to
> najmenšie potrebné oprávnenie.
>
> Účet sa vytvára cez pozvánku člena organizátora vo webovej appke
> (Nastavenia → tím → pridať člena, rola „Check-in").

---

## 8. Riešenie problémov

- **Kamera sa nespustí / „nie je povolená":** chýba NSCameraUsageDescription
  (iOS) alebo CAMERA permission (Android) — časť 4. Na iOS aj skontroluj, či
  používateľ povolenie neodmietol (Nastavenia → Ticketio Scan → Kamera).
- **Android: skener chvíľu „nič nevidí" po inštalácii:** chýba `meta-data`
  DEPENDENCIES (časť 4) — MLKit model sa sťahoval za behu. Po doplnení sa
  predinštaluje.
- **„Neprihlásený" pri skenovaní:** vypršala session bez siete — prihlás sa
  znova (v1 je online-only). Token sa inak auto-obnovuje.
- **Biely pruh v safe area (hore/dole):** natívne pozadie webview, nie CSS —
  pozri časť 4b. Ak sa vráti, over, že storyboard ukazuje na `MainViewController`
  a že `contentInset` je `never`.
- **Zlý API cieľ:** skontroluj `VITE_API_BASE` v `.env` (musí byť
  `https://ticketio.sk`) a rebuildni (`npm run sync`).
