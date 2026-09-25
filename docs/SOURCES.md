# Källor och proveniens — Min BKH-app

Senaste fullständiga källgranskning: **2026-09-25**.

## Använda källor

| Käll | URL/flöde | Typ | Proveniensroll | Ger | Auth | Kostnad | Ratelimit | Verifierad | Begränsningar | Duplicering | Proveniensbeteende |
|---|---|---|---|---|---|---|---|---|---|---|---|
| BK Häcken | `https://bkhacken.se/feed` | OFFICIELL | **Primär** — klubbens egna uttalanden | Klubbnyheter, matchtrupper, biljettinfo | Ingen | Gratis | Ej publikt angivet | 2026-09-25 | Blandar dam/herr/akademi → klassificering krävs | Källor som citerar Häcken kan duplicera | `role: primary`; publisher = BK Häcken |
| Allsvenskan | `https://allsvenskan.se/feed/` | OFFICIELL | **Primär** — tävlingskanal | Tävlingsnyheter, omgångsinfo | Ingen | Gratis | Ej publikt angivet | 2026-09-25 | Täcker hela serien, ej Häcken-specifikt | Samma EventType kan rapporteras av media | `role: primary` |
| Sportbladet Fotboll | `https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/fotboll/` | NYHET | **Sekundär** — stor redaktion, oftast bevakning av andras uppgifter | Svensk fotboll, övergångar | Ingen | Gratis | Ej publikt angivet | 2026-09-25 | Korta rubriker; sparsamma beskrivningar ("Enastående smaklös") | Ofta först med bevakning, sedan citerad | `role: secondary` |
| Expressen Fotboll | `https://feeds.expressen.se/sport/fotboll/` | NYHET | **Sekundär** | Svensk fotbollsnyhet | Ingen | Gratis | Ej publikt angivet | 2026-09-25 | Blandar in internationella nyheter | Citerar ofta Sportbladet | `role: secondary` |
| SVT Sport | `https://www.svt.se/sport/rss.xml` | NYHET | **Sekundär** | Allmän sporthäntelse | Ingen | Gratis | Ej publikt angivet | 2026-09-25 | Bredd, lite Allsvenskan-djup | — | `role: secondary` |
| Bollsvenskan | `https://www.bollsvenskan.se/feed/` | NYHET | **Sekundär** (artikelnivå varierar) | Allsvenskan-fokus, ibland egen rapportering | Ingen | Gratis | Ej publikt angivet | 2026-09-25 | WordPress-flöde med `content:encoded`; beskrivningar innehåller "The post … appeared first on" (ingen sammanfattning) | Egen rapportering kan vara primär på artikelnivå | `role: secondary` — per-artikel attribuering kan höja till primär när bevis finns |
| **SportoMedia GraphQL** | `https://gql.sportomedia.se/graphql` | OFFICIELL | **Primär för AKTUELL matchdata** — datatjänsten bakom allsvenskan.se | Spelschema, resultat, tabell, händelser (mål/assist/kort/byten), startelvor, spelarstatistik — säsong 2026 | Ingen | Gratis | Ej publikt angivet; 6 snabba anrop OK (2026-09-25) | 2026-09-25 | Ingen publicerad API-licens (status: oklar, klass B); låg frekvens krävs; lineups via rootfrågan `lineups()`; gameTime i sekunder | Samma underlag som allsvenskan.se visar — ingen dubblett med RSS | provider, publicSite, provenance, retrievedAt, season, dataStatus, queryVersion |
| API-Football | `https://v3.football.api-sports.io` | STATISTIK | **HISTORISK** — endast säsonger 2022–2024 | Historiska resultat, tabeller, statistik | `API_FOOTBALL_KEY` (endast GitHub Actions Secret) | Gratis (100 anrop/dag) | 10/min | 2026-09-25 | Free-plan låser säsong 2025–2026; **team-ID 367 = Häcken, 363 = Hammarby (FEL för Häcken)** | — | provider, season, competition, retrievedAt — alltid märkt historisk |
| Firecrawl Keyless | `POST https://api.firecrawl.dev/v2/search`, `/v2/scrape` | UPPTÄCKT | **Upptäckts-/inhämtningsverktyg — aldrig källa** | Hittar artiklar (t.ex. om tidigare spelare), kan hämta artikeltext för sammanfattning | Ingen nyckel (Keyless) | Gratis ~1 000 credits/mån; search: 2 credits/10 resultat; scrape: 1 credit/sida | Ej publikt angivet | 2026-09-25 | Credits-begränsad; målartiklar kan blockera | Resultat kan dubbletteras med RSS | `discoveredVia: firecrawl`; artikeln är alltid källan |

### Provenienskedja

**Aktuell fotbollsdata (säsong 2026):**

```
SvFF/Fogis (officiellt tävlingsunderlag)
        ↓
SportoMedia (datatjänst)
        ↓
allsvenskan.se (officiell tävlingswebbplats — använder samma GraphQL-tjänst)
        ↓
GitHub Actions (nattlig hämtning, 3 anrop)
        ↓
public/data/app.json (statisk, med proveniens-metadata)
        ↓
GitHub Pages PWA
```

**Nyheter:**

```
UPPTÄCKTSMETOD (RSS / Firecrawl / API)
        ↓
ARTIKEL (källan: BK Häcken, Sportbladet, …)
        ↓
PÅSTÅENDEN (fakta i artikeln)
        ↓
NYHETSHÄNDELSE (deduplicerad, flera källor = en story)
        ↓
UI (ett kort + källpiller → originalartikel)
```

UI-visning:

- `role: primary` → gul pil (`pill-primary`), t.ex. BK Häcken.
- `role: secondary` → neutral pil.
- Firecrawl visas aldrig som källa — endast som "Upptäckt via firecrawl".

## Utredda och avvisade källor

| Käll | URL testad | Resultat | Orsak till avvis | Datum |
|---|---|---|---|---|
| Fotbollskanalen | `https://www.fotbollskanalen.se/rss/`, `/rss`, `/feed`, `/feed/`, `/api/rss`, `/api/feed/rss`, `/rss.xml`, HTML head autodiscovery, `sitemap.xml` | Alla feed-URL:er → 404; ingen autodiscovery-länk i HTML; sitemap finns men inget feedmönster | **Inget användbart RSS/Atom-flöde hittades** (systematiskt testat 2026-09-24 och 2026-09-25). Sajten verkar ha bytt teknikplattform. | 2026-09-25 |
| Göteborgs-Posten | `https://www.gp.se/rss` (fungerar, gzip), `https://www.gp.se/rss/sport` (200 men 0 `<item>` — endast UI-ikoner), `https://www.gp.se/rss/1.978717` (HTML, ej RSS) | Huvudflödet innehåller artiklar men `/rss/sport` är tomt | Huvudflödet (allmän GP) är för brett för Häcken-fokus; sportflödet saknar artiklar. Kan läggas till senare med filtrering. | 2026-09-25 |
| Fotbolltransfers | `https://fotbolltransfers.com/rss` → 200 men returnerar HTML, ej XML; `/feed` → 404 | RSS slutpunkt returnerar HTML-sida | **Inget fungerande flöde**. Sajten kan ändå användas via Firecrawl för spelarresearch. | 2026-09-25 |
| SvFF/svenskfotboll.se | `https://www.svenskfotboll.se/rss/`, `/feed/`, `https://www.sverigesfotboll.se/rss`, `/feed`, `https://www.svenskfotboll.se/nyheter/rss` | Alla → 404 | Inget offentligt flöde. | 2026-09-25 |
| Expressen (gammal URL) | `https://feeds.expressen.se/nyheter/sport/` | 404 | Ersatt av `https://feeds.expressen.se/sport/fotboll/` som fungerar. | 2026-09-24 |

## Om Bollsvenskan (djupdyk 2026-09-25)

- WordPress-baserad sajt med titeln "100% Fokus på Allsvenskan".
- Flödet innehåller `content:encoded` men beskrivningarna är WordPress-standard
  ("The post … appeared first on Bollsvenskan") — alltså **ingen** äkta
  sammanfattning i flödet.
- Inga externa källänkar i flödets artikeltext — attribueringsbeteende måste
  bedömas per artikel vid ev. framtida djupanalys.
- Klassificerad som `secondary` som publicering; enskilda artiklar kan vara
  originalrapportering och kan då höjas till `primary` i per-artikel-modellen.

## Om Sverigesfotboll.se (2026-09-25)

- Drivs av SvFF (Svensk Fotboll) — officiellt federationsmaterial.
- Inget RSS-flöde hittades.
- Används idag inte som nyhetskäll; tjänar som referens för tävlingsregler
  (se `pipeline/src/rules/allsvenskan.json` → `ruleSourceUrl`).

## Uppdateringspolicy

- Nattlig pipeline (03:30 UTC) hämtar alla RSS-källor (gratis, inga gränser i praktiken).
- SportoMedia GraphQL anropas restriktivt (tabell + matcher + detaljer för färdigspelade matcher, ~300 ms mellanrum).
- API-Football anropas restriktivt (~15–25 anrop/körning) för att hålla sig under 100/dag — och ENDAST för historiska säsonger (2022–2024). Aldrig för aktuell säsong.
- Firecrawl Keyless används endast som upptäcktsverktyg för tidigare spelare — aldrig som källa. Status 2026-09-25: keyless-anrop utan API-nyckel får 429 (rate-limited), så klubb-/kontraktsdata för tidigare spelare är oftast tom med `clubVerified: false`. Artiklar som hittas visas alltid med artikelns egen källa, aldrig "Firecrawl".

## Produktregler för data (2026-09-25)

- Aktuell säsong = 2026 (SportoMedia). Historiska säsonger får ALDRIG tyst ersätta 2026-data; om 2026-data saknas visas explicit banner (`currentDataUnavailable`).
- Varnings-/avstängningsstatus byggs ENDAST av verifierade kortdata per match (SportoMedia-händelser) — aggregerade "gula kort"-siffror räcker inte som bevis för avstängning.
- Nyhetsrelevans kräver entitet: officiell Häcken-källa, explicit Häcken-nämnning eller känd person. Generiska ord ("klubb", "förening") räcker aldrig.
- Spelaridentitet: canonical id (`fogis:N` när Fogis-id finns, annars `name:normaliserat-namn`). Registret för tidigare spelare exkluderar spelare som finns i aktuell trupp.
