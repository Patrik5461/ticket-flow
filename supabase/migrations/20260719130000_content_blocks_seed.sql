-- Phase 18 Block 2 — seed content_blocks with the current static-page texts.
-- `on conflict (key) do nothing` so re-running never clobbers later admin edits.

insert into public.content_blocks (key, title, body) values
('obchodne-podmienky', 'Obchodné podmienky', $md$Toto je predbežné znenie. Finálne obchodné podmienky pripravuje právnik a budú doplnené pred spustením.

## 1. Prevádzkovateľ a rozsah

Ticketio je sprostredkovateľ predaja vstupeniek medzi organizátorom podujatia a kupujúcim. Zmluva o návšteve podujatia vzniká medzi kupujúcim a organizátorom.

## 2. Objednávka a platba

Objednávka drží rezerváciu kapacity po obmedzený čas. Platba prebieha cez platobnú bránu GoPay. Po úspešnej platbe dostane kupujúci vstupenky s QR kódom e-mailom.

## 3. Storno a reklamácie

Podmienky vrátenia vstupného a prípadné zrušenie podujatia určuje organizátor v súlade s platnými právnymi predpismi. Reklamácie k platbe riešime v spolupráci s organizátorom.

## 4. Provízia platformy

Ticketio si účtuje transparentnú províziu z predaja podľa aktuálneho cenníka. Provízia sa nepripočítava kupujúcemu nad rámec ceny vstupenky, pokiaľ nie je uvedené inak.

## 5. Ochrana osobných údajov

Spracúvanie osobných údajov sa riadi zásadami ochrany osobných údajov (GDPR).$md$),

('gdpr', 'Ochrana osobných údajov', $md$Ako spracúvame vaše osobné údaje (GDPR).

Toto je predbežné znenie. Finálne zásady ochrany osobných údajov pripravuje právnik a budú doplnené pred spustením.

## Aké údaje spracúvame

Pri objednávke spracúvame e-mail, prípadne meno a telefón kupujúceho, a údaje potrebné na vystavenie vstupenky a dokladu. Fakturačné údaje spracúvame len ak kupujete na firmu.

## Účel a právny základ

Údaje používame na spracovanie objednávky, doručenie vstupeniek a plnenie zákonných povinností. Analytické a marketingové nástroje spúšťame len s vaším súhlasom (viď nastavenia cookies).

## Príjemcovia

Údaje sprístupňujeme organizátorovi podujatia (na účel odbavenia) a poskytovateľom platby a e-mailu v nevyhnutnom rozsahu.

## Vaše práva

Máte právo na prístup, opravu a vymazanie údajov, obmedzenie spracúvania a namietanie. Kontaktujte nás na [hello@ticketio.sk](mailto:hello@ticketio.sk).$md$),

('cookies', 'Cookies', $md$Cookies sú malé súbory, ktoré nám pomáhajú prevádzkovať stránku a s vaším súhlasom aj merať návštevnosť a zobrazovať relevantnejší obsah. Svoj súhlas môžete kedykoľvek zmeniť.

## Nutné cookies

Potrebné pre základný chod stránky — prihlásenie, udržanie obsahu košíka a bezpečnosť. Bez nich by stránka nefungovala, preto ich nemožno vypnúť. (Vždy aktívne.)

## Analytické cookies

Pomáhajú nám pochopiť, ako sa stránka používa (napr. Google Analytics), aby sme ju mohli zlepšovať. Spúšťajú sa len s vaším súhlasom.

## Marketingové cookies

Umožňujú meranie konverzií a remarketing (napr. Meta Pixel). Spúšťajú sa len s vaším súhlasom.$md$),

('ako-to-funguje', 'Ako to funguje', $md$Od vytvorenia podujatia po odbavenie na vstupe — za pár minút.

## 1. Vytvorte podujatie

Zadajte názov, termín, miesto a typy vstupeniek s cenami a kapacitou. Môžete pridať zľavové kupóny aj vlastné polia formulára.

## 2. Predávajte online

Zdieľajte odkaz na podujatie. Kupujúci zaplatia kartou cez GoPay a vstupenky s QR kódom im prídu okamžite e-mailom (aj do Apple/Google Wallet).

## 3. Peniaze máte priebežne

Vďaka priebežnému payoutu cez GoPay máte tržby na účte hneď — nie až po evente. Provízia platformy je transparentná a nízka.

## 4. Odbavujte cez mobil

Na vstupe skenujete QR kódy webovým alebo mobilným skenerom. Odbavenie je idempotentné — opakovaný sken bezpečne oznámi „už použitá".

[Pozrite si cenník a kalkulačku →](/cennik)$md$),

('kontakt', 'Kontakt', $md$Radi vám pomôžeme — organizátorom aj kupujúcim.

## E-mail

[hello@ticketio.sk](mailto:hello@ticketio.sk)

## Podpora pre kupujúcich

Ak máte otázku k objednávke alebo vstupenke, napíšte nám a uveďte číslo objednávky z potvrdzovacieho e-mailu.

## Pre organizátorov

Chcete predávať vstupenky cez Ticketio? Ozvite sa nám a pomôžeme vám s rozbehom prvého podujatia.

## Sídlo

Bratislava, Slovensko$md$)

on conflict (key) do nothing;
