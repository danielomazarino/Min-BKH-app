# Min BKH — Produktbeskrivning

## Syfte

Min BKH är en liten, snabb och pålitlig mobilapp (PWA) för supportrar av BK Häckens
herrlag. Appen svarar på två frågor:

1. **"Vad behöver jag veta om Häcken just nu?"** — nästa match, senaste resultatet,
   varnings-/avstängningsläget, senaste herrnyheterna.
2. **"Vad har hänt med mina gamla Häcken-spelare sedan sist?"** — bevakningslista
   för tidigare Häcken-spelare: nuvarande klubb, säsongstatistik, kontraktsstatus,
   övergångar och relevanta nyheter.

## Målgrupp

- Supportrar av BK Häckens herrlag.
- Primär enhet: iPhone 13 (390×844), används även utomhus i kallt väder.
- Ingen inloggning, inget konto, ingen betalning.

## MVP-omfattning

### Herrlaget
- Nästa match (motståndare, tävling, datum, tid, hemma/borta).
- Varnings-/avstängningsöversikt (kärnfunktion):
  - Avstängda för nästa match.
  - En varning från avstängning.
  - Vilken tävling/säsong statusen gäller.
- Senaste resultatet (motståndare, score, tävling, datum).
- Senaste relevanta herrnyheterna (3–5 stycken).
- Spelarstatistik från senaste spelade matchen.
- Tabellposition när tillförlitliga data finns.

### Tidigare spelare
- Kuraterat register över tidigare Häcken-spelare.
- Nuvarande klubb, liga/land, säsongstatistik (matcher, starter, minuter, mål,
  assist, kort).
- Kontraktsstatus med verifieringsnivå (bekräftat / rapporterat / overifierat /
  okänt) och källhänvisning.
- Relevanta karriärnyheter (övergång, lån, kontraktsförlängning m.m.).
- Favoritmarkering som sparas lokalt (localStorage), utan inloggning.

## Icke-mål (medvetet exkluderat)

- xG, heatmaps, löpdistans, GPS-spårning.
- Subjektiva spelarbetyg eller "formkurvor".
- Livehändelser under pågående match.
- Betting, fantasy, onödiga sociala funktioner.
- Dekorativ AI-genererat innehåll eller synlig "AI-assistent".
- Generisk fotbollsstatistikplattform.

## Framtida utbyggnad (ej implementerat)

- Rikare bevakning av tidigare spelare.
- Push-notiser för avstängningar/övergångar.
- Fler tävlingar (Svenska Cupen, Europa).
- Veckodigest genererat av LLM med mänsklig granskning.

## Arkitektur i korthet

```
Externa källor (API-Football, RSS, Firecrawl Keyless)
        │  GitHub Actions (pipeline)
        ▼
Normaliserad statisk JSON (public/data/*.json)
        │
        ▼
React PWA (svenska UI, svart/gul identitet)
        │
        ▼
GitHub Pages (statisk hosting)
```

Webbläsaren läser endast statisk JSON som genererats av pipelinen. Inga
API-nycklar i frontend. Senaste kända goda data bevaras vid källfel.
