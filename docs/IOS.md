# iOS aplikace (SwiftUI)

Nativní appka pro iPhone, iPad a Mac (Apple Silicon, režim „Designed for iPad“) ve složce `ios/`. Píše se ve SwiftUI, s webem sdílí jen read-only API (`https://www.zavody-aut.cz/api/*`), ne kód. Nové animace (motion) jsou jen v appce, web zůstává beze změny.

- **Bundle ID:** `cz.zavodyaut.app` (po vydání do App Store už nejde změnit)
- **Tým:** stejný Apple Developer tým jako Football Diary (`Z7H5MA4BBC`)
- **Název pod ikonou:** Závody aut
- **Minimální systém:** iOS / iPadOS 18
- **Mapa:** MapLibre Native (Swift Package `maplibre-gl-native-distribution`) s dlaždicemi OpenFreeMap, světlý styl Liberty a tmavý Dark jako na webu. MapLibre umí offline balíčky dlaždic, proto ne Apple MapKit.
- **Projekt:** `ios/project.yml` (XcodeGen). `ZavodyAut.xcodeproj` se generuje a necommituje.

## Spuštění na Macu

```bash
brew install xcodegen
```

```bash
cd ~/zavody-kalendar && git pull
```

```bash
cd ios && xcodegen && open ZavodyAut.xcodeproj
```

V Xcode vyber simulátor (iPhone, iPad) nebo „My Mac (Designed for iPad)“ a ▶ Run. Při prvním buildu Xcode stáhne balíček MapLibre. Po přidání nebo přejmenování souboru ve `ios/ZavodyAut/` znovu spusť `xcodegen`.

Ikona appky (`AppIcon-1024.png`) se generuje z loga webu (`web/src/logo.ts`) příkazem `npm run icons`.

## Struktura

| Složka | Obsah |
| --- | --- |
| `App/` | vstup appky, taby (na iPadu a Macu boční panel) |
| `Model/` | modely API (`src/shared/types.ts`), české popisky a barvy disciplín, formát dat |
| `Data/` | `API` (síť s limitem 6 s, jinak uložená kopie), `AppModel` (seznam, filtry, oblíbené, můj kraj) |
| `UI/` | seznam, karta závodu, detail, filtry, úvod se startovními světly, pozadí, logo |
| `Map/` | MapLibre mapa (`RaceMapView`) a záložka Mapa |

## Chování

- **Uložení bez účtu:** filtry, oblíbené a můj kraj jen v `UserDefaults` zařízení (klíč `prefs-v1`), na server se nic neposílá. Oblíbené se zapomenou 60 dní po závodě.
- **Offline (krok 1):** každá úspěšná odpověď API se uloží do Application Support. Bez signálu appka ukáže uloženou kopii se štítkem „Bez signálu · uložená data z …“. Ukládání závodů nadcházejícího víkendu dopředu, mapových dlaždic a dokumentů přijde v kroku 2.
- **Přidání do kalendáře:** systémový formulář EventKitUI s vyplněnou celodenní událostí. Nepotřebuje oprávnění ke kalendáři.
- **Navigace:** otevře Apple Mapy s trasou k bodu trati (nebo ke středu obce, detail na to upozorní).
- **Motion:** úvod se startovními světly a haptikou (vykreslení silnice, vlajka, pět párů světel, zhasnutí), karta se při otevření rozroste do detailu (zoom přechod), karty při scrollu jemně mizí, pohyblivé barevné pozadí (mesh gradient), pružné hvězdičky a filtry s haptikou. Vše respektuje „Omezit pohyb“.

## Postup (kroky)

1. ✅ Kostra: seznam, hledání, filtry, detail, mapa, oblíbené, kalendář, sdílení, nový motion, iPhone + iPad + Mac.
2. Nativní offline: automatické uložení závodů od dneška do neděle (detail, MapLibre offline balíček okolí, dokumenty pro diváky do souborů), tlačítko „Uložit offline“, mazání proběhlých.
3. Živě ze závodu: počasí (Open-Meteo), dešťový radar (RainViewer), odkazy na výsledky a přenos. Swipe mezi závody, „blízko mě“.
4. App Store: Universal Links (`/.well-known/apple-app-site-association` z Workeru), widget „Další závod“ (WidgetKit), screenshoty, texty, App Privacy, TestFlight.

## App Store poznámky

- **4.2 (Minimum Functionality):** appka je nativní (SwiftUI, MapLibre, EventKitUI, haptika), offline u trati a widget ji odliší od webu.
- **Privacy:** žádné účty, žádná analytika, poloha jen v zařízení (popis v `Info.plist`). Privacy manifest `PrivacyInfo.xcprivacy` deklaruje `UserDefaults` (CA92.1) a čas souborů v kontejneru appky (C617.1). App Privacy label: „Data Not Collected“.
- **Cizí značky (4.1(a), 5.2.1):** v metadatech App Storu nepoužívat názvy seriálů a pořadatelů ani jejich loga. Data v appce jsou odkazy a fakta z veřejných kalendářů.
