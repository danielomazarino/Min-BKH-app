# Min BKH

Supporter-PWA för BK Häckens herrlag. Byggd med React + TypeScript + Vite,
distribuerad som statisk webbplats på GitHub Pages.

**Funktioner**

- Nästa match, senaste resultatet och senaste matchens spelarstatistik.
- Varnings-/avstängningsöversikt per tävling och säsong (kärnfunktion).
- Herrnyheter från BK Häckens officiella RSS med klassificering och deduplicering.
- Bevakningslista för tidigare Häcken-spelare med favoritmarkering (localStorage,
  inget konto), kontraktsstatus med verifieringsnivå och källproveniens.

**Utveckling**

```bash
npm install
npm run dev            # utvecklingsserver
npm test               # enhetstester (Vitest)
npm run test:e2e       # e2e + tillgänglighet (Playwright + axe-core)
npm run build          # produktionsbygge till dist/
npm run pipeline       # kör datapipelinen (skriver public/data/*.json)
npm run pipeline:validate  # validera genererad data mot scheman
```

**Arkitektur**

```
Externa källor (API-Football, RSS, Firecrawl Keyless)
        │  GitHub Actions (.github/workflows/data-update.yml)
        ▼
Normaliserad statisk JSON (public/data/*.json)
        ▼
React PWA (svenskt UI, svart/gul BK Häcken-identitet)
        ▼
GitHub Pages
```

Inga API-nycklar i frontend. `API_FOOTBALL_KEY` finns endast som GitHub Actions
Secret. Firecrawl används nyckelfritt (Keyless) endast som kompletterande
upptäcktskälla — aldrig som sanningskälla.

Dokumentation: [docs/](docs/) — produkt, datakällor, UX-specifikation och
acceptanstester.
