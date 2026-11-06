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
| `Data/WidgetBridge.swift` | předává widgetu nadcházející závody a oblíbené přes App Group |
| `../ZavodyAutWidget/` | widget „Další závod“ (WidgetKit, samostatný target `ZavodyAutWidgetExtension`) |
| `Map/` | MapLibre mapa (`RaceMapView`), záložka Mapa, dešťový radar (`RadarMapView`) |

## Chování

- **Uložení bez účtu:** filtry, oblíbené a můj kraj jen v `UserDefaults` zařízení (klíč `prefs-v1`), na server se nic neposílá. Oblíbené se zapomenou 60 dní po závodě.
- **Offline:** každá úspěšná odpověď API se uloží do Application Support. Bez signálu appka ukáže uloženou kopii se štítkem „Bez signálu · uložená data z …“.
- **Závody v zařízení** (`OfflineStore`, obdoba service workeru webu): samy se ukládají závody od dneška do neděle (max. 8, oblíbené první, bez zrušených), nejvýš jednou za 6 h a vždy po návratu signálu. V detailu „Uložit offline“ pro libovolný jiný závod. U každého: detail, MapLibre offline balíček okolí (±6 km, zoom 9–14, světlý i tmavý styl), dokumenty pro diváky (harmonogram, mapa, divácká místa, propozice, plakát) přes `GET /api/events/<id>/doc?url=…`. Navíc celá ČR v zoomu 5–8. Bez signálu se dokument otevře z telefonu (Quick Look), se signálem web pořadatele. Proběhlé závody se smažou i s dlaždicemi a dokumenty. Uložené mají v seznamu zelenou ikonku.
- **Živě ze závodu** (`UI/LiveView.swift`, `Model/Live.swift`, obdoba `web/src/LivePage.tsx`): den před závodem a během něj (ne zrušené a odložené) velké tlačítko v detailu, které vyjmenuje, co stránka má. Počasí Open-Meteo (teď a 12 h, den předem denní hodiny dne závodu, sloupce šance na déšť), dešťový radar RainViewer přes MapLibre (poslední snímek, přehrání a posuvník posledních 2 h, vrstva snímku se načte až při zobrazení), odkazy na výsledky a přenos (výsledky nestahujeme). Předpověď uložených závodů je i offline.
- **Nejblíž mně:** ikona polohy v liště seřadí závody podle vzdálenosti vzdušnou čarou a ukáže ji na kartě. Poloha (asi na kilometr) se zjistí jen na požádání a zůstává v zařízení.
- **Mapa:** dole pás karet jako na webu (`web/src/MapView.tsx`). Klepnutí na špendlík posune pás na závod, swipe pásu přeletí kamerou na závod uprostřed: náklon 60°, 1,5 km nad místem, 3D budovy (ve stylu Dark je doplňuje appka) jako detail stadionu ve Football Diary. S „Omezit pohyb“ bez letu. Tlačítko „Celá ČR“ vrátí rovný přehled. Glóbus a 3D terén nativní MapLibre neumí. Vlastní poloha se na mapě ukáže jen po povolení přes „Nejblíž mně“, Mapa se na ni sama neptá.
- **Swipe mezi závody:** v detailu přejetí doleva/doprava otevře další/předchozí závod v pořadí seznamu, nad hlavičkou jsou jejich názvy.
- **Odkazy z webu (Universal Links):** `https://www.zavody-aut.cz/zavod/<id>` a `…/zive` otevře nainstalovaná appka rovnou na detailu (případně na Živě ze závodu). Worker servíruje `/.well-known/apple-app-site-association` (`src/appLinks.ts`) na všech adresách a bez přesměrování; entitlement `applinks:` je v `ios/ZavodyAut.entitlements`. Widget otevírá appku přes `zavodyaut://zavod/<id>`.
- **Widget „Další závod“:** nejbližší oblíbený závod (jinak nejbližší) s odpočtem dní; malý a střední na plochu, obdélníkový a řádkový na zamčenou obrazovku. Data z API, bez signálu ze snímku, který appka ukládá do App Group `group.cz.zavodyaut.app` (tam jsou i oblíbené, zůstávají v zařízení). Obnova o půlnoci a každých 6 h.
- **Přidání do kalendáře:** systémový formulář EventKitUI s vyplněnou celodenní událostí. Nepotřebuje oprávnění ke kalendáři.
- **Navigace:** otevře Apple Mapy s trasou k bodu trati (nebo ke středu obce, detail na to upozorní).
- **Motion:** úvod se startovními světly a haptikou (vykreslení silnice, vlajka, pět párů světel, zhasnutí), karta se při otevření rozroste do detailu (zoom přechod), karty při scrollu jemně mizí, pohyblivé barevné pozadí (mesh gradient), pružné hvězdičky a filtry s haptikou. Vše respektuje „Omezit pohyb“.

## Postup (kroky)

1. ✅ Kostra: seznam, hledání, filtry, detail, mapa, oblíbené, kalendář, sdílení, nový motion, iPhone + iPad + Mac.
2. ✅ Nativní offline: automatické uložení závodů od dneška do neděle (detail, MapLibre offline balíček okolí, dokumenty pro diváky), tlačítko „Uložit offline“, mazání proběhlých.
3. ✅ Živě ze závodu: počasí (Open-Meteo), dešťový radar (RainViewer), odkazy na výsledky a přenos. Swipe mezi závody, „Nejblíž mně“.
4. ✅ App Store: Universal Links, widget „Další závod“, stránka soukromí a podpory (`/soukromi.html`), texty, App Privacy a postup vydání v `docs/APP-STORE.md`. Zbývá na Macu: screenshoty, TestFlight.

## App Store poznámky

- **4.2 (Minimum Functionality):** appka je nativní (SwiftUI, MapLibre, EventKitUI, haptika), offline u trati a widget ji odliší od webu.
- **Privacy:** žádné účty, žádná analytika, poloha jen v zařízení (popis v `Info.plist`). Privacy manifest `PrivacyInfo.xcprivacy` deklaruje `UserDefaults` (CA92.1) a čas souborů v kontejneru appky (C617.1). App Privacy label: „Data Not Collected“.
- **Cizí značky (4.1(a), 5.2.1):** v metadatech App Storu nepoužívat názvy seriálů a pořadatelů ani jejich loga. Data v appce jsou odkazy a fakta z veřejných kalendářů.
