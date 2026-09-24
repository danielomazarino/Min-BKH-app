# Arkitektur — Min BKH-app

## Översikt

```
Externa källor
  ├─ RSS (BK Häcken, Allsvenskan, Sportbladet, Expressen, SVT, Bollsvenskan)
  ├─ API-Football (fixtures, resultat, tabell, spelarstatistik)
  └─ Firecrawl Keyless (upptäckt av spelarartiklar)
        │
        ▼
GitHub Actions ("Data update", nattlig + dispatch)
  ├─ Hämtning (pipeline/src/rss.ts, apifootball.ts, firecrawl.ts)
  ├─ Klassificering (classify.ts: men/women/youth/club)
  ├─ Deduplicering (dedupe.ts: canonical URL + normaliserad titel ±3 dagar)
  ├─ Nyhetshändelser (newsEvents.ts: flera artiklar = EN händelse med källpiller)
  ├─ Varningslogik (warnings.ts + rules/allsvenskan.json)
  ├─ Normalisering (normalize.ts) + Validering (validate.ts: zod + secret-leak guard)
  └─ Last-known-good (stale.ts: aldrig skriv över giltig data med tom data)
        │
        ▼
Statisk JSON (public/data/app.json, former-players.json)
        │
        ▼
React PWA (app/) — läser endast statisk JSON
        │
        ▼
GitHub Pages (dist/)
```

## Nyhetsmodell: KÄLLA → ARTIKEL → PÅSTÅENDEN → HÄNDELSE → UI

```
KÄLLA (publisher)          UPPTÄCKTSMETOD
BK Häcken (primär)    ←    RSS direkt
Sportbladet (sekundär) ←   RSS direkt
Sportbladet-artikel   ←    Firecrawl hittar den   ← Firecrawl är INTE källan
        │
        ▼
ARTIKEL (url, titel, datum, beskrivning)
        │
        ▼
PÅSTÅENDEN (fakta i artikeln — sammanfattningen härleds ENDAST ur källtext)
        │
        ▼
NYHETSHÄNDELSE (NewsEvent)
  ├─ title: ledande artikels rubrik
  ├─ summary: längsta källhärledda beskrivningen (aldrig påhittad)
  └─ sources[]: { publisher, url, publishedAt, role, discoveredVia }
        │
        ▼
UI: ETT kort per händelse + källpiller (ett piller per källa → originalartikel)
```

### Rollmodell (sourceRole)

| Roll | Betydelse | Exempel |
|---|---|---|
| `primary` | Originalrapportering / officiellt uttalande | BK Häcken, Allsvenskan.se, SvFF |
| `secondary` | Bevakning av andras uppgifter | Sportbladet, Expressen, SVT, Bollsvenskan |
| `discovery` | Hittar/inhämtar innehåll — aldrig en källa | Firecrawl |
| `unknown` | Ej bedömt | — |

Roller per publicering finns i `pipeline/src/newsEvents.ts` (`PUBLISHER_ROLES`).
Modellen tillåter olika artiklar från samma publicering att ha olika roll
(t.ex. Bollsvenskan kan vara primär på en artikel med egen rapportering).

## Sammanfattningar (summaries)

- **Prioritet 1: källhärledd text.** Längsta RSS-beskrivningen bland händelsens
  källor används (`summaryMethod: "rss-description"`).
- **Prioritet 2: rubrikutdrag.** Om ingen beskrivning finns används rubriken
  (`summaryMethod: "excerpt"`).
- **Aldrig genererad text utan källbelägg.** Inga påhittade detaljer.
- Firecrawl scrape (`/v2/scrape`, 1 credit/sida) kan hämta artikeltext för
  framtida förbättrade utdrag — arkitekturen är förberedd men aktiveras
  restriktivt (kostnadskontroll).

## Matcher

- API-Football `fixtures?team=363&season=2026` (BK Häcken, Allsvenskan 2026).
- Player stats hämtas endast för senaste spelade matchen (kvotbesparing).
- Tävlingar skiljs åt: Allsvenskan / Svenska Cupen / Europa / annat — blands
  aldrig statistik över tävlingar utan märkning.
- Varningslogiken är strikt scoped per tävling + säsong.

## Reliability

- **Last-known-good:** om en käll misslyckas behålls föregående data per fält
  (`writeAppIfBetter` / `writeFormerIfBetter`).
- **Secret-skydd:** `validate.ts` stoppar bygg om nyckelmönster hittas i data.
- **Stale-indikering:** UI visar "Senast uppdaterad" och "Data kan vara
  inaktuell" efter 36 h.
