# Acceptanstester — Min BKH

Varje krav nedan är kopplat till ett exekverbart test (Vitest/Playwright) där
det är möjligt. "Manuell" = verifieras av produktägaren.

## Hem
- [ ] Hem laddar och visar nästa match (motståndare, tävling, datum, hemma/borta). — `e2e/home.spec.ts`
- [ ] Senaste resultatet visas med score och tävling. — `e2e/home.spec.ts`
- [ ] Varningsstatus visas (avstängda + "en varning från avstängning"). — `e2e/home.spec.ts`
- [ ] Senaste herrnyheterna (3–5) visas med datum och källa. — `e2e/home.spec.ts`

## Matcher
- [ ] Matchersidan listar herrlagsmatcher med datum/tävling/motståndare. — `e2e/matches.spec.ts`
- [ ] Senaste matchens spelarstatistik (minuter/mål/assist/kort) visas. — `e2e/matches.spec.ts`

## Nyheter
- [ ] Nyhetssidan visar klassificerade herrnyheter med källattribuering. — `e2e/news.spec.ts`
- [ ] Dam-/akademiartiklar filtreras bort från herrvyn. — `unit/classify.test.ts`

## Spelare (tidigare Häcken-spelare)
- [ ] Listan över tidigare spelare visas. — `e2e/players.spec.ts`
- [ ] Favorit kan läggas till och syns som följd. — `e2e/players.spec.ts`
- [ ] Favorit består efter omladdning (localStorage). — `e2e/players.spec.ts`
- [ ] Spelardetalj visar klubb, säsongstatistik och kontraktsstatus. — `e2e/players.spec.ts`
- [ ] Kontraktsproveniens (källa + verifieringsstatus) är synlig. — `e2e/players.spec.ts`
- [ ] Källänkor fungerar (href till originalartikel). — `e2e/players.spec.ts`

## Varningslogik (enhetstester)
- [ ] 2 relevanta varningar, ingen avstängning → "En varning från avstängning". — `unit/warnings.test.ts`
- [ ] Tröskel nådd → avstängd när avstängningen gäller. — `unit/warnings.test.ts`
- [ ] Varningar från annan tävling påverkar inte Allsvenskan-status. — `unit/warnings.test.ts`
- [ ] Säsonggräns: gamla säsongers varningar bärs inte över. — `unit/warnings.test.ts`
- [ ] Avstängning kopplas till rätt nästa match i rätt tävling. — `unit/warnings.test.ts`

## Data & proveniens
- [ ] Genererad JSON validerar mot zod-scheman. — `pipeline/src/validate.ts` + CI
- [ ] Nyhetsdeduplicering slår ihop samma händelse. — `unit/dedupe.test.ts`
- [ ] Kontraktsstatus: overifierad data visas aldrig som bekräftat datum. — `unit/contract.test.ts`
- [ ] Gammal-data-logik: tröskel ger "Data kan vara inaktuell". — `unit/stale.test.ts`
- [ ] Favoritpersistens-logik. — `unit/favorites.test.ts`

## UX & tillgänglighet
- [ ] Appen fungerar vid 320px bredd utan horisontell overflow. — `e2e/layout.spec.ts`
- [ ] Appen fungerar vid 390×844. — `e2e/layout.spec.ts`
- [ ] axe-core: inga kritiska fel på Hem/Matcher/Nyheter/Spelare. — `e2e/a11y.spec.ts`
- [ ] Offline: senast cachade data visas (service worker). — `e2e/offline.spec.ts`

## Skärmregression
- [ ] Playwright-skärmdumpar: Hem, Varningar, Matcher, Nyheter, Spelarlista,
      Spelardetalj. — `e2e/screenshots.spec.ts` (dynamiska tidsstämplar maskas)

## Bygge & drift
- [ ] Produktionsbygge (`npm run build`) lyckas. — CI
- [ ] Data-pipeline validerar JSON och bevarar senast goda data vid källfel. — CI + pipeline
- [ ] Ingen API-nyckel i frontend/statisk JSON (grep-check i CI). — CI
