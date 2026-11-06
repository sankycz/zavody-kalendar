# iOS aplikace (SwiftUI)

Nativní appka pro iPhone, iPad a Mac (Apple Silicon, režim „Designed for iPad“) ve složce `ios/`. Píše se ve SwiftUI, s webem sdílí jen read-only API (`https://www.zavody-aut.cz/api/*`), ne kód. Nové animace (motion) jsou jen v appce, web zůstává beze změny.

- **Bundle ID:** `cz.zavodyaut.app` (po vydání do App Store už nejde změnit)
- **Tým:** stejný Apple Developer tým jako Football Diary (`Z7H5MA4BBC`)
- **Název pod ikonou:** Závody aut
- **Minimální systém:** iOS / iPadOS 18
- **Mapa:** MapLibre Native (Swift Package `maplibre-gl-native-distribution`) s dlaždicemi OpenFreeMap, světlý styl Liberty a tmavý Dark jako na webu. MapLibre umí offline balíčky dlaždic, proto ne Apple MapKit.
- **Projekt:** `ios/ZavodyAut.xcodeproj`. Složka `ios/ZavodyAut/` je v Xcode synchronizovaná: nový soubor v ní Xcode zahrne sám, projekt se kvůli tomu nemění.

## Spuštění na Macu

```bash
cd ~/zavody-kalendar && git pull
```

```bash
open ios/ZavodyAut.xcodeproj
```

V Xcode vyber simulátor (iPhone, iPad) nebo „My Mac (Designed for iPad)“ a ▶ Run. Při prvním buildu Xcode stáhne balíček MapLibre. Na vlastním zařízení: target ZavodyAut → Signing & Capabilities → Team.

Ikona appky (`AppIcon-1024.png`) se generuje z loga webu (`web/src/logo.ts`) příkazem `npm run icons`.

## Struktura

| Složka | Obsah |
| --- | --- |
| `App/` | vstup appky, taby (na iPadu a Macu boční panel) |
| `Model/` | modely API (`src/shared/types.ts`), české popisky a barvy disciplín, formát dat |
| `Data/` | `API` (síť s limitem 6 s, jinak uložená kopie), `AppModel` (seznam, filtry, oblíbené, můj kraj), `OfflineStore` (závody v zařízení), `Connectivity` (signál) |
| `UI/` | seznam, karta závodu, detail, filtry, úvod se startovními světly, pozadí, logo |
| `Map/` | MapLibre mapa (`RaceMapView`) a záložka Mapa |

## Chování

- **Uložení bez účtu:** filtry, oblíbené a můj kraj jen v `UserDefaults` zařízení (klíč `prefs-v1`), na server se nic neposílá. Oblíbené se zapomenou 60 dní po závodě.
- **Offline:** každá úspěšná odpověď API se uloží do Application Support. Bez signálu appka ukáže uloženou kopii se štítkem „Bez signálu · uložená data z …“.
- **Závody v zařízení** (`OfflineStore`, obdoba service workeru webu): samy se ukládají závody od dneška do neděle (max. 8, oblíbené první, bez zrušených), nejvýš jednou za 6 h a vždy po návratu signálu. V detailu „Uložit offline“ pro libovolný jiný závod. U každého: detail, MapLibre offline balíček okolí (±6 km, zoom 9–14, světlý i tmavý styl), dokumenty pro diváky (harmonogram, mapa, divácká místa, propozice, plakát) přes `GET /api/events/<id>/doc?url=…`. Navíc celá ČR v zoomu 5–8. Bez signálu se dokument otevře z telefonu (Quick Look), se signálem web pořadatele. Proběhlé závody se smažou i s dlaždicemi a dokumenty. Uložené mají v seznamu zelenou ikonku.
- **Přidání do kalendáře:** systémový formulář EventKitUI s vyplněnou celodenní událostí. Nepotřebuje oprávnění ke kalendáři.
- **Navigace:** otevře Apple Mapy s trasou k bodu trati (nebo ke středu obce, detail na to upozorní).
- **Motion:** úvod se startovními světly a haptikou (vykreslení silnice, vlajka, pět párů světel, zhasnutí), karta se při otevření rozroste do detailu (zoom přechod), karty při scrollu jemně mizí, pohyblivé barevné pozadí (mesh gradient), pružné hvězdičky a filtry s haptikou. Vše respektuje „Omezit pohyb“.

## Postup (kroky)

1. ✅ Kostra: seznam, hledání, filtry, detail, mapa, oblíbené, kalendář, sdílení, nový motion, iPhone + iPad + Mac.
2. ✅ Nativní offline: automatické uložení závodů od dneška do neděle (detail, MapLibre offline balíček okolí, dokumenty pro diváky), tlačítko „Uložit offline“, mazání proběhlých.
3. Živě ze závodu: počasí (Open-Meteo), dešťový radar (RainViewer), odkazy na výsledky a přenos. Swipe mezi závody, „blízko mě“.
4. App Store: Universal Links (`/.well-known/apple-app-site-association` z Workeru), widget „Další závod“ (WidgetKit), screenshoty, texty, App Privacy, TestFlight.

## App Store poznámky

- **4.2 (Minimum Functionality):** appka je nativní (SwiftUI, MapLibre, EventKitUI, haptika), offline u trati a widget ji odliší od webu.
- **Privacy:** žádné účty, žádná analytika, poloha jen v zařízení (popis v `Info.plist`). Privacy manifest `PrivacyInfo.xcprivacy` deklaruje `UserDefaults` (CA92.1) a čas souborů v kontejneru appky (C617.1). App Privacy label: „Data Not Collected“.
- **Cizí značky (4.1(a), 5.2.1):** v metadatech App Storu nepoužívat názvy seriálů a pořadatelů ani jejich loga. Data v appce jsou odkazy a fakta z veřejných kalendářů.
