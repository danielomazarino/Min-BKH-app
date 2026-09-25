# Undersökning: Aktuell 2026-data för Min BKH-app

**Datum:** 2026-09-25 · **Status:** FASE A SLUTFÖRD → **GO** → IMPLEMENTERAD I PRODUKTION
**Uppdrag:** Hitta en gratis, aktuell (2026) datakälla för BK Häcken. Använd INTE API-Football Pro. Presentera inte 2024-data som aktuell.

**Implementeringsstatus (2026-09-25):** SportoMedia GraphQL är nu primär källa i produktion. Team-ID korrigerat (367). Tyst 2024-fallback borttagen. 73 enhetstester + 27 e2e-tester gröna. Se avsnitt L (implementering) nedan.

**Behörighetsklassificering (fas A, oberoende validering 2026-09-25): B — REASONABLY SUPPORTED.** Endpointen är allsvenskan.se:s egen publika datatjänst (refereras i dess sidkälla), inga förbud hittades (ingen robots.txt på endpointen, inga ToS som förbjuder), planerad användning är extremt lågfrekvent (3 anrop/natt). Inte klass A eftersom ingen explicit API-licens är publicerad.

---

## A. Sammanfattning av slutsatser (evidensbaserad)

1. **Kritisk bugg upptäckt i befintlig pipeline:** `BKH_TEAM_ID = 363` i API-Football är **Hammarby FF, inte BK Häcken**. Appen har visat Hammarbys matcher/resultat som om de vore Häckens. Korrekt ID är sannolikt **367** (bevis i avsnitt G).
2. **FootSam lämpar sig INTE som datakälla** — det är en vidarepublicerare av API-Sports-data (samma ID-rymd och logon som API-Football), utan API, utan användarvillkor, och med oklar automatiseringsstatus.
3. **BÄSTA KANDIDATEN: SportoMedia GraphQL** (`https://gql.sportomedia.se/graphql`) — den öppna GraphQL-tjänsten bakom **allsvenskan.se (officiell)**. Verifierad aktuell 2026-data: tabell, spelschema, resultat, händelser, lineups, spelarstatistik. Ingen nyckel, ingen känd rate limit, fungerar från GitHub Actions.
4. **API-Football Free kan inte leverera 2026-data** (planen begränsar säsonger till 2022–2024). Nyckeln är giltig; säsongen är problemet.
5. Rekommenderad arkitektur: **SportoMedia GraphQL som primär källa för matcher/tabell/spelarstatistik**, RSS som tidigare för nyheter, API-Football som valfri historisk källa — med tydlig säsongsmärkning.

---

## B. FootSam — vad sajten innehåller (verifierat 2026-09-25)

| URL | Status | Innehåll (observerat) |
|---|---|---|
| `https://footsam.com/lag/367` | 200 | BK Häcken-sida |
| `https://footsam.com/lag/367?sasong=2026` | 200 (421 KB) | **Aktuell 2026-data:** 22 spelade matcher, 36 poäng, 9–9–4, 39–30 i mål, form WDD LWW; full matchlista apr–nov 2026 inkl. kommande matcher (2026-10-11 vs Örgryte IS etc.); lagstatistik; toppscorare (G. Lindgren 12, J. Lindberg 7, A. Svanbäck 5) |
| `https://footsam.com/liga/113?sasong=2026` | 200 | Full Allsvenskan-tabell 2026 (Sirius 51, Hammarby 43, Häcken 5:a 36) |
| `https://footsam.com/match/1494188` | 200 | Matchdetalj: mål, assist, kort, byten, domare, matchstatistik |
| `https://footsam.com/spelare/161561?sasong=2026` | 200 | Spelarsidor med matcher/minuter/mål/assister/kort per säsong |

**Slutsats:** FootSam har genuint aktuell 2026-data. Detta är INTE i sig ett argument att använda den (se hård regel).

## C. FootSam — dataproviniens (VIKTIGT)

**FootSam är inte en ursprunglig källa. Evidens:**

1. **218 referenser till `api-sports.io`** i sidans RSC-payload — alla logotyper laddas från `media.api-sports.io/football/teams/<id>.png` och `media.api-sports.io/football/players/<id>.png`. Detta är API-Footballs (api-sports.io) CDN.
2. **FootSams ID-rymd = API-Sports ID-rymd:** FootSam Häcken = 367, Hammarby = 363, Brommapojkarna = 371 — med api-sports-logotyper som bekräftar mappningen (367.png = Häckens crest, 363.png = Hammarbys HIF-crest, 371.png = BP:s crest).
3. FootSams egen "Om"-sida (`/om-footsam`) säger endast: *"FootSam collects and structures football data about matches, players, teams, managers, referees, stadiums and transfers"* — **ingen ursprungskälla nämns**, men den tekniska fingerprinten (api-sports-ID:n + CDN) visar att grunddata kommer från API-Sports/API-Football.
4. **Klassificering: (D) vidarepublicerar en annan leverantörs data** (API-Sports), möjligen med egen beräkningslager (trender, prognoser). Svar F ("cannot be determined") gäller för detaljerna; api-sports-spåren är entydiga.

**Konsekvens:** Att hämta från FootSam = att hämta API-Football-data via en skrapad mellanhand — samma data vi redan har nyckel till, men utan villkor och med extra beroende.

## D. FootSam — åtkomst/villkor

- `robots.txt`: `Allow: /`, **`Disallow: /api/` och `/admin/`**, sitemap angiven. HTML-sidor är alltså tillåtna för crawlers; en intern `/api/` finns men är blockerad för crawlers.
- **Inga användarvillkor, ingen integritetspolicy och ingen licensinformation hittades** (inte i navigation, footer eller sitemap; endast cookie-banner med Google Analytics/PostHog).
- **Inget publikt API:** `/api`, `/graphql`, `/api-docs` m.fl. → 404. Skytteliga-tabellen är klientrenderad (hittades inte i SSR/RSC-payload).
- **Status för automatisering: oklar.** Publicerad HTML är inte automatiskt tillåten att återanvända; utan villkor finns ingen given licens för systematisk återanvändning i en annan produkt.

## E. Aktuell 2026-data — FootSam vs. verifierad korsvalidering

FootSam 2026 (observerat): Häcken 5:a, 36 poäng, 22 matcher, 9–9–4, 39–30; nästa match 2026-10-11 vs Örgryte IS; toppscorare G. Lindgren 12, J. Lindberg 7, A. Svanbäck 5.

Dessa siffror korsvaliderades mot **SportoMedia GraphQL** (se F) och **stämmer exakt** — två oberoende vägar till samma underlag.

## F. SportoMedia GraphQL — den officiella källan (huvudfynd)

**allsvenskan.se** (Svensk Elitfotboll, officiell tävlingsorganisatör) hämtar sin matchdata från `https://gql.sportomedia.se/graphql` (hittat i sidkällan). **Endpointen är öppen — ingen autentisering.**

**Testade frågor (alla 200 OK, 2026-09-25):**

| Fråga | Resultat |
|---|---|
| `seasons(configLeagueName:"allsvenskan")` | `allsvenskan-2026` finns (aktuell säsong!) |
| `standingsForLeague(..., type:"total")` | Full tabell, 16 rader — Häcken 5:a, 36 p (identisk med FootSam) |
| `matchesForTeam(abbrv:"BKH", 2026)` | 11 matcher sep–dec 2026: **nästa match 2026-10-11 BK Häcken–Örgryte IS**, plus 0–5 borta vs Kalmar m.fl. |
| `match(id:6530003)` | Kalmar FF 0–5 BK Häcken, Guldfågeln Arena, fogisId 6530003, **fulla händelser**: mål med assist, gula kort (WARNING), byten (in/ut), avslut, domslutstexter på svenska |
| `lineups(...)` | **Fulla startelvor + byten + formation** (Häcken 4-2-3-1: Berisha; Wembangomo, Hilvenius, Helander, Samuelsson; Doumbia, Seger; Svanbäck, Rygaard, Lindberg; Lindgren) |
| `squad(abbrv:"BKH")` | Trupp med position, födelsedatum, nationalitet, **fogisId**, `currentSeasonStats` |
| `currentSeasonStats` | Lindgren 12 mål, J. Lindberg 7+7, Svanbäck 5+6, Rygaard 2+5, Doumbia 6 gula — **aktuell 2026-statistik** |

**Datamodell-noteringar:** `MatchEvent` har typer som GOAL, WARNING (gult kort), SUBSTITUTION, SHOT, PERIOD_RESULT; `LineupPlayer` har till och med löpstatistik (maxSpeed, sprints, distance). `fogisId` på matcher och spelare pekar mot SvFF:s officiella Fogis-system som ursprung.

**Proviniens:** Sportomedia = *"Technical solutions for sports federations, leagues, teams and media"* (företagssida parkerad; kontakt info@sportomedia.se). De är **leverantör till allsvenskan.se/Svensk Elitfotboll** — dvs. dataflödet som den officiella tävlingswebbplatsen själv använder. Detta är närmast en "officiell" källa man kan komma utan avtal.

**Automation:** GET och POST fungerar, ingen nyckel, ingen observerad rate limit vid lätt användning (3 snabba anrop OK), körs på Google Frontend. Lämplig för GitHub Actions (nattlig körning = några få anrop). **Villkorsstatus: oklar** — ingen publicerad API-licens hittades; det är den interna tjänsten bakom den officiella sajten. Ansvarsfull användning: låg frekvens, cache, ingen vidareförsäljning.

## G. API-Football Free — begränsningar (verifierat) + kritisk ID-bugg

1. **Säsongslås:** `"Free plans do not have access to this season, try from 2022 to 2024."` — 2026 (och 2025) är låsta. Nyckeln i sig fungerar.
2. **KRITISK BUGG UPPTÄCKT:** `BKH_TEAM_ID = 363` i `pipeline/src/apifootball.ts` är **Hammarby FF, inte BK Häcken**.
   - Evidens 1: `media.api-sports.io/football/teams/363.png` renderar Hammarbys gröna HIF-crest; `367.png` renderar Häckens svart-gula crest.
   - Evidens 2: Fixturlistan vi hämtade för `team=363` (Västerås 1–0, Malmö 2–2, Sirius 0–3 … nov 2024) **matchar FootSams Hammarby-2024-matchlista exakt**.
   - Evidens 3: FootSams RSC-payload mappar 363→Hammarby FF, 367→BK Häcken.
   - Konsekvens: appens "Senaste resultatet" har visat **Hammarbys** matcher under Häckens namn. Tabellpositionen var korrekt eftersom den söktes i ligatabellen (alla lag), inte i team-frågan.
3. Slutsats: API-Football Free kan endast leverera historik (2022–2024) — och då för rätt lag-ID (367).

## H. Andra undersökta källor

| Källa | Resultat |
|---|---|
| `svenskfotboll.se` (SvFF) | Omstrukturerad; tävlingsdata bakom ny struktur/aktiva-portalen; ingen öppen matchdata-API hittad |
| `allsvenskan.se` | Officiell; data via SportoMedia GraphQL (se F) — **detta är guldet** |
| `api.everysport.com` | 401 Unauthorized — kräver token |
| `bolldata.se` | Har 2026-data (xG etc.) men JS-app utan hittad publik endpoint |
| Firecrawl Keyless | 403 från denna IP ("sign up for a free API key") — fungerar ej nyckellöst längre här |

## I. Rekommenderad arkitektur (förslag — ej implementerat)

```
KÄLLOR (produktion):
1. SportoMedia GraphQL  → matcher, tabell, händelser, lineups, spelarstatistik
   PROVENIENS: "Svensk Elitfotboll/allsvenskan.se (via SportoMedia)" — primär, officiell
2. RSS (som idag)       → nyheter (BK Häcken, Allsvenskan, Sportbladet, Expressen, SVT, Bollsvenskan)
3. Firecrawl            → endast upptäckt av spelarartiklar (som idag)

VALFRI/HISTORIK:
4. API-Football Free    → historik 2022–2024 med teamId 367 (rättat), tydligt märkt "historisk"

FÖRBJUDET:
- FootSam som källa (vidarepublicerad api-sports-data, inga villkor, oklar automatisering)
- Att visa 2024-data som aktuell
```

**Säsongshantering (ersätter nuvarande tysta fallback):**
- Pipeline frågar SportoMedia med `configSeasonStartYear: 2026`.
- Misslyckas det → appen visar explicit "Aktuell matchdata ej tillgänglig" — aldrig tyst 2024-ersättning.
- Historisk data (om hämtad) märks alltid med säsong, t.ex. "Allsvenskan 2024".

**Datamängd per nattlig körning (SportoMedia):** 1× standings + 1× matchesForTeam + ev. 1× squad ≈ 3 anrop — väl inom rimlighet.

## J. Exakta käll-URL:er

- FootSam lag: `https://footsam.com/lag/367?sasong=2026`
- FootSam liga: `https://footsam.com/liga/113?sasong=2026`
- FootSam match: `https://footsam.com/match/1494188` (Häcken–Hammarby 3–2, omg 10)
- FootSam om: `https://footsam.com/om-footsam` · robots: `https://footsam.com/robots.txt`
- **SportoMedia GraphQL: `https://gql.sportomedia.se/graphql`** (GET/POST, ingen nyckel)
- allsvenskan.se (konsument av GraphQL): `https://allsvenskan.se/matcher`
- API-Football: `https://v3.football.api-sports.io` (free: säsonger 2022–2024)
- Logotyper som bevisar ID-mappning: `https://media.api-sports.io/football/teams/363.png` (Hammarby), `.../367.png` (Häcken)

## K. Öppna frågor / osäkerheter (ärligt markerat)

1. **SportoMedias användarvillkor för programmatisk åtkomst: oklara.** Endpointen är öppen och är samma som den officiella sajten använder, men ingen API-licens är publicerad. Rekommendation: låg frekvens, cache, attribuering "Källa: allsvenskan.se/Sportomedia" — och beredskap att byta om de stänger den.
2. FootSams *beräknade* värden (prognoser, trender) är deras egna; rådata är api-sports. Detta påverkar inte oss eftersom FootSam inte rekommenderas.
3. Lineups var null på en match via `match.homeTeamLineup` men fullständiga via `lineups(...)`-rootfrågan — implementering bör använda rootfrågan.
4. `matchEvents.gameTime` verkar vara sekunder (5464 ≈ 91 min) — behöver konverteras.

---

## L. Implementering (fas B, 2026-09-25)

**VERIFIERAT — genomfört och deployat:**

| Åtgärd | Detalj |
|---|---|
| Team-ID korrigerat | `BKH_TEAM_ID = 367` i `pipeline/src/apifootball.ts`; `HAMMARBY_TEAM_ID = 363` dokumenterad som förbjuden |
| Tyst fallback borttagen | Ingen logik ersätter 2026 med 2024. Misslyckad hämtning → `currentDataUnavailable` i app.json → UI visar explicit banner |
| Ny källa | `pipeline/src/sportomedia.ts` (GraphQL-klient) + `pipeline/src/smNormalize.ts` (normalisering + identitetsvakter) |
| Pipeline | `collectCurrentFootballData()` i `run.ts`: 3 anrop (fixtures, standings, squad) + 1 matchdetalj för senaste spelade match |
| Proveniens | `footballSource`-metadata i app.json: provider, publicSite, provenance, sourceUrl, retrievedAt, season, dataStatus, queryVersion |
| Ny data | `squadStats` (27 spelare, aktuell 2026-statistik), `lastMatchDetail.events` (mål/assist/kort/byten) |
| UI | Home visar banner "Aktuell matchdata ej tillgänglig" när hämtning fallerar; Settings visar SportoMedia-status, säsong, datakälla och historisk status för API-Football |
| Validering | `validate.ts` utökad med MatchEvents, FootballSourceMeta, squadStats, currentDataUnavailable |
| Tester | 73 enhetstester (inkl. identitetsvakter: Hammarby ≠ Häcken, 367 ≠ 363) + 27 e2e — alla gröna |

**Kvarvarande risker (INFERENCE/UNKNOWN):**
- SportoMedias villkor för programmatisk åtkomst är oklara (klass B, inte A). Om tjänsten stängs eller begränsas: pipeline failar säkert och appen visar explicit "ej tillgänglig" — ingen tyst historik-substitution.
- FootSams lagtotal (44 gula kort) inkluderar spelare som lämnat klubben; SportoMedias squad-baserade total (36) täcker nuvarande trupp. Skillnaden dokumenterad, inte ett fel.
- Avstängningsregler finns inte i källan — appen beräknar enligt SvFF-regeln (3 varningar → 1 match) som är konfigurerad i `pipeline/src/rules/allsvenskan.json`, med regelkälla angiven i UI.