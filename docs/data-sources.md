# Datakällor

Alla källor verifierades 2026-09-24 (se "Verifiering" nedan).

| Käll | Syfte | Primär/fallback | Autentisering | Gratisgräns | Uppdatering | Fält som används | Kända begränsningar | Proveniens | Felbeteende |
|---|---|---|---|---|---|---|---|---|---|
| BK Häcken RSS (`https://bkhacken.se/feed`) | Klubbnyheter (herr/dam/akademi/klubb) | Primär för klubbenyheter | Ingen | Obegränsad (offentlig RSS) | Varje pipeline-körning | title, link, pubDate, description, enclosure | Feed innehåller dam/herr/klubb blandat — klassificering krävs | publisher=BK Häcken, sourceUrl, publishedAt | Hoppas över; tidigare data behålls |
| Sportbladet Fotboll RSS (`https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/fotboll/`) | Svensk fotbollsnyhet (övergångar m.m.) | Sekundär för nyheter | Ingen | Obegränsad (offentlig RSS) | Varje pipeline-körning | title, link, pubDate, description | Endast rubrik/DIT-nivå; klassificering krävs | publisher=Sportbladet, sourceUrl, publishedAt | Hoppas över; tidigare data behålls |
| API-Football (`https://v3.football.api-sports.io`) | Allsvenskan fixtures, resultat, tabell, lineups, händelser, spelarstatistik, kort | Primär för strukturerad fotbollsdata | `API_FOOTBALL_KEY` (endast GitHub Actions Secret) | 100 förfrågningar/dag, 10/min (Free) | Nattlig + pre-match | fixtures, standings, events, lineups, players | Free-planen begränsar historiska säsonger; 2026-säsongen verifieras vid första körningen | provider=API-Football, season, competition, retrievedAt | Källstatus sparas; senaste goda data behålls; appen blir aldrig tom |
| Firecrawl Keyless (`https://api.firecrawl.dev/v2/search`) | Webbsökning för bevakade tidigare spelare (övergångar/kontrakt) | Kompletterande discovery | Ingen nyckel (Keyless) | ~1 000 credits/månad, 2 credits per 10 sökresultat | Vid pipeline-körning (restriktivt, endast favoriter) | web-results: url, title, description | Discovery-mekanism — aldrig sanningskälla; resultat kräver källa | discoveredVia=firecrawl (alltid synlig i UI) | Avaktiveras tyst; RSS och strukturerad data fortsätter |
| LLM (valfritt) | Klassificering av nyhetsrelevans, extraktion av kontrakts-/övergångsclaim, deduplicering | Kompletterande | Se nedan | Måste vara gratis | Vid pipeline-körning | Strukturerad JSON ut | LLM uppfinner aldrig fakta; varje claim behåller källproveniens | claim+status+source behålls alltid | Deterministisk pipeline fungerar utan LLM |

## Verifiering (2026-09-24)

- **BK Häcken RSS**: `GET https://bkhacken.se/feed` → 200, giltig RSS 2.0 med
  `pubDate`, `link`, `enclosure`. Innehåller både dam- och herrartiklar
  (t.ex. "HERR"-märkta och damartiklar i samma feed) — därför krävs
  klassificering, se `pipeline/src/classify.ts`.
- **Sportbladet Fotboll RSS**: `GET https://rss.aftonbladet.se/rss2/small/pages/sections/sportbladet/fotboll/`
  → 200, RSS 2.0 "Fotboll - Senaste nyheterna om allt som rör fotboll".
- **Fotbollskanalen RSS**: **HITTAS INTE.** `fotbollskanalen.se/rss`, `/feed/`,
  `/api/feed/rss` → 404. Fotbollskanalen används därför inte i MVP.
- **Expressen RSS**: `feeds.expressen.se/nyheter/sport/` → 404. Används inte.
- **Firecrawl Keyless**: `POST https://api.firecrawl.dev/v2/search` utan
  API-nyckel → 200 `{"success":true,...}` med `creditsUsed: 2` för 2 resultat.
  Dokumenterad kostnad: 2 credits per 10 resultat. Keyless ger ~1 000 gratis-
  credits/månad enligt officiell dokumentation (docs.firecrawl.dev). Ingen
  kontoregistrering krävs för Keyless-bruk.
- **API-Football**: Free-tier gränser (100 req/dag) verifierade mot officiell
  dokumentation. Nyckeln läggs i GitHub Actions Secrets vid driftsättning.
  Vid saknad nyckel hoppar pipelinen över API-Football och appen visar
  senast kända goda data.

## Tävlingens varningsregler (Allsvenskan 2026)

Varnings-/avstängningslogiken modelleras i `pipeline/src/warnings.ts` enligt
SvFF:s tävlingsbestämmelser: tre varningar i olika matcher i samma tävling
(samma säsong) ger en matchers avstängning i samma tävling. Regeln är
konfigurerbar i `pipeline/src/rules/allsvenskan.json` — inte hårdkodad — så att
den kan uppdateras om SvFF ändrar bestämmelserna.

Källreferens: SvFF tävlingsbestämmelser (stor herrfotboll), dokumenterad i
`pipeline/src/rules/allsvenskan.json` med `ruleSource`-fält. Pipelinen markerar
 alltid vilken regelversion som användes.

## Nyckelhantering

- `API_FOOTBALL_KEY` — endast GitHub Actions Secret. Aldrig i frontend, statisk
  JSON, Git-historik eller loggar.
- Firecrawl Keyless — ingen nyckel.
- LLM (om aktiverad) — valfri nyckel endast som Actions Secret; pipelinen
  fungerar utan.

## Uppdateringsfrekvens

- GitHub Action "Data update": 1 gång/natt (03:30 UTC) + manuell dispatch.
- Nattlig körning håller API-Football under free-gränsen (~15–25 anrop/körning
  med aggressiv caching).
- Pipeline committar aldrig tomma dataset — vid totalt misslyckande behålls
  föregående `public/data/*.json` orörda och källstatus loggas.
