# App Store: Závody aut

Podklady pro App Store Connect (iOS appka v `ios/`, viz `docs/IOS.md`). V metadatech ani na screenshotech nesmí být názvy seriálů, pořadatelů a jejich loga (4.1(a), 5.2.1). Obecná slova jako rally, závod do vrchu nebo autokros jsou v pořádku.

## Základ

| Pole | Hodnota |
| --- | --- |
| Název | Závody aut |
| Podtitul (CZ, max. 30) | Kalendář rally, vrchů a okruhů |
| Podtitul (EN) | Czech motorsport calendar |
| Bundle ID | `cz.zavodyaut.app` (widget `cz.zavodyaut.app.widget`) |
| SKU | zavodyaut-ios |
| Kategorie | Sport (vedlejší: Navigace) |
| Věkové hodnocení | 4+ |
| Cena | zdarma, bez nákupů v aplikaci |
| Zásady ochrany soukromí | https://www.zavody-aut.cz/soukromi.html |
| Podpora | https://www.zavody-aut.cz/soukromi.html#podpora |
| Marketing URL | https://www.zavody-aut.cz |
| Copyright | 2026 Jakub Sankot |

## Klíčová slova (max. 100 znaků)

CZ: `rally,rallye,závody,vrch,autokros,okruh,slalom,drift,motorsport,kalendář,auta,RZ,radar,historické`

EN: `rally,racing,motorsport,hill climb,autocross,circuit,slalom,drift,calendar,czech,stages,events`

## Popis (CZ)

```
Všechny závody aut v Česku na jednom místě: rally, rallysprinty, závody do vrchu, autokros, autoslalom, okruhy, drift i historická vozidla. Od mistrovství po regionální a amatérské závody.

• Kalendář nadcházejících závodů s hledáním a filtry podle disciplíny, úrovně a kraje
• Mapa všech závodů a řazení „Nejblíž mně“
• Detail závodu: termín, trať, pořadatel, dokumenty pro diváky (harmonogram, mapa, divácká místa, propozice)
• Uzavřené silnice: časy rychlostních zkoušek a uzavírek podle dokumentů pořadatele
• Funguje i bez signálu u trati: závody nejbližšího víkendu se samy uloží i s mapou okolí a dokumenty
• Živě ze závodu: počasí v místě, dešťový radar a odkazy na výsledky a přenos
• Navigace k trati, přidání do kalendáře, oblíbené závody
• Widget s odpočtem do dalšího závodu na ploše i zamčené obrazovce

Bez registrace a bez reklam. Oblíbené a nastavení zůstávají jen ve vašem zařízení.

Data pocházejí z veřejných kalendářů a webů pořadatelů, u každého závodu je odkaz na zdroj. Aktuální stav vždy ověřte u pořadatele.
```

## Popis (EN)

```
Every car race in the Czech Republic in one place: rallies, rally sprints, hill climbs, autocross, slalom, circuit racing, drifting and historic cars. From national championships to regional and amateur events.

• Calendar of upcoming races with search and filters by discipline, level and region
• Map of all races and "Nearest to me" sorting
• Race details: dates, track, organizer, documents for spectators (schedule, map, spectator areas, regulations)
• Closed roads: stage and road closure times from the organizer's documents
• Works without signal at the track: the coming weekend's races are saved with the map and documents
• Race day: local weather, rain radar and links to results and live streams
• Directions to the track, add to Calendar, favorite races
• Countdown widget for the home and lock screen

No sign-up, no ads. Favorites and settings stay on your device. The app is in Czech.

Data comes from public calendars and organizers' websites, each race links to its source. Always check the current status with the organizer.
```

## Co je nového (1.0)

```
První verze: kalendář, mapa, offline u trati, Živě ze závodu a widget s odpočtem.
```

## App Privacy (nutriční štítek)

**Data Not Collected.** Appka nemá účty ani analytiku. Poloha zůstává v zařízení (Apple ji za sběr nepovažuje, když neopustí zařízení). Privacy manifesty: `ios/ZavodyAut/PrivacyInfo.xcprivacy` (UserDefaults CA92.1 a 1C8F.1, časy souborů C617.1), `ios/ZavodyAutWidget/PrivacyInfo.xcprivacy` (UserDefaults 1C8F.1).

## Poznámka pro recenzenty (App Review)

```
The app is a calendar of car races in the Czech Republic (UI in Czech). No account is needed.
Native features: offline storage of the coming weekend's races incl. MapLibre offline map tiles and PDF documents (works in Airplane mode), home/lock screen widget, add to Calendar via EventKitUI, Universal Links from www.zavody-aut.cz/zavod/…, haptics.
"Živě ze závodu" (race day: weather, rain radar, results links) appears in a race's detail only the day before and during a race.
```

## Screenshoty

Potřeba: iPhone 6,9" (1320 × 2868) a iPad 13" (2064 × 2752), protože appka podporuje iPad. Stačí ze simulátoru (iPhone 17 Pro Max, iPad Pro 13"), ⌘S.

1. Seznam s kartou „Nejbližší závod“ (světlý režim)
2. Detail rally s uzavřenými silnicemi a RZ
3. Mapa s filtrem disciplíny
4. Živě ze závodu: počasí a radar (vybrat závod v den konání)
5. Detail se štítkem „Uloženo v zařízení“ v režimu letadlo
6. Widget na ploše a tmavý režim

Na screenshotech ani v popiscích nesmí být loga seriálů a pořadatelů. Názvy závodů v datech jsou v pořádku.

## Postup vydání

1. developer.apple.com → Identifiers: `cz.zavodyaut.app` s capabilities **App Groups** (`group.cz.zavodyaut.app`) a **Associated Domains**; `cz.zavodyaut.app.widget` s App Groups. S automatickým podepisováním to Xcode založí sám při prvním buildu na zařízení.
2. Nasadit Worker s `/.well-known/apple-app-site-association` (merge do `main`), ověřit: `curl -i https://www.zavody-aut.cz/.well-known/apple-app-site-association` vrátí 200 a JSON. Apple si soubor stahuje přes vlastní CDN, změna se projeví do 24 h.
3. App Store Connect → Apps → + → New App: iOS, název „Závody aut“, jazyk čeština, Bundle ID `cz.zavodyaut.app`, SKU výše.
4. Xcode: Any iOS Device (arm64) → Product → Archive → Distribute App → App Store Connect.
5. TestFlight: interní testování na iPhonu, iPadu a Macu (offline v režimu letadlo, widget, odkaz z Poznámek na `https://www.zavody-aut.cz/zavod/<id>`).
6. Vyplnit metadata výše, App Privacy, věkové hodnocení, odeslat ke kontrole.
