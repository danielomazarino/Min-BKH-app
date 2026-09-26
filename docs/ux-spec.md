# UX-specifikation — Min BKH

Uppdaterad 2026-09-26 efter ombyggnaden till "Brief + Sheets"-modellen.
Speglar det som faktiskt är implementerat, inte en aspiration.

## Produktmodell

Min BKH är ett **supporterkompanjon för ett lag**, inte en statistikapp.
Kärnan är: *vad händer med Häcken just nu?*

Tvåpopulationer, aldrig blandade:

| | Betydelse | Var den syns |
|---|---|---|
| **Aktuella spelare (2026)** | Tillhör säsongens upplevelse | Matchhändelser, kort/varningar, avstängningar, uppställning |
| **Tidigare Häcken-spelare** | Sök- och minnesupplevelse | Egen vy: sök, favoriter, A–Z, senast sökta |

Den kompletta 2026-truppen listas **inte** som en katalog. En test
(`e2e/former-players.spec.ts`) låser det.

## Identitet

- Svart + gult. `--yellow: #ffd200` är reserverad för **Häckens egna data**:
  Häckens namn, Häckens resultat, Häckens kortmätare, Häckens scorare.
- Gult används **inte** till chrome, sektionsetiketter, kontrolltilstånd eller
  fokusringar — med ett undantag: den aktiva fliken i bottenfältet.
- Delning sker med whitespace och en hairline (`rgba(255,255,255,0.08)`),
  aldrig med fyllda kort + ramar.
- Ikon: crane/hedge/football/BKH alla bevarade, med en **genuint separat**
  maskable-variant (icke byte-identisk, inom 80 % säker cirkel).

## Navigation — "Brief + Sheets"

Permanent bottenfält har **två** destinationer:

1. **Brief** — hela supporterbriefen
2. **Tidigare** — sök efter tidigare spelare

Matcher och Inställningar är **kontextuella**: moduletikett med chevron
respektive rubrikikon. De är arkiv och referensytor, inte dagliga mål.

### Lager (Home)

Tre lager i en horisontell pager: **Översikt · Nyheter · Mer**.

- Pager-punkter (32 px träffyta, 6 px visuell pip) och piltangenter är
  **alltid** tillgängliga. Svepet är en genväg, aldrig enda vägen.
- Off-screen lager får `inert` som **DOM-egenskap** (React 18 släpper
  `inert`-propen) och `aria-hidden`, så de är både osynliga och otabbbara.

## Hem — Översikt

Prioritering och mål: **en kompakt skärm** (verifierat ≤ 1,5 skärmar; den
gamla layouten var 2,6).

1. **Nästa match** — enda "hero": tävling, countdown ("Om 16 dagar"), lagen,
   datum, arena, formguide (5 punkter)
2. **Senast** — resultat (Häcken-sidan först), motståndare, datum, scorare
3. **Kortläget** — bara avstängda och de som är *en varning kvar*
4. **Tabellen** — en rad
5. Nyheter och säsongens matcher på de andra lagren

### Kortläget

Två regler som inte får brytas:

- Texten härleds ur **`warningsUntilSuspension`**, inte säsongstotalen. En
  spelare med 5 varningar som redan avtjänat en avstängning får inte sägas
  vara "en varning från avstängning" bredvid "5 varningar".
- Kortmätaren visar notchar mot `disciplineRule.threshold`, så avståndet till
  avstängning är begripligt utan förklaring.

Den fullständiga SvFF-regeln ligger **inte** i briefen — den ligger i
Inställningar bakom en disclosure.

## Matcher

- Arkiv med W/D/L som **färgad kant OCH bokstav** (aldrig färg ensam),
  H/B-monogram, datum, motståndare.
- Bara **senaste matchen** har händelsedata, så bara den öppnar ett ark.
- **Händelsetidslinje** (mål/kort/byten) i ett ark — den data fanns redan i
  `app.json` och visas nu för första gången.
- Ingen rubrik för spelarstatistik som saknar data (`playerStats` är `[]`).

## Nyheter

- **Snap-spår** med 4 redigerade kort (16:9-bild, rubrik, faktisk sammanfattning,
  källpunkt) — de 4 första + 8 som komprimerade enrader under "Tidigare".
  Rail och lista får **aldrig** visa samma artikel.
- Bilder: `imageUrl` bärs nu från lead-artikeln i pipeline steget.
- **Flera källor visas bara när data faktiskt har flera källor.** Varje händelse
  har i dag exakt en källa, så UI:t säger "BK Häcken", inte "flera källor".
- Firecrawl visas aldrig som källa — bara som upptäcktsverktyg.
- Källroller uttrycks rumsligt: fylld punkt = primär, ihålig = sekundär.

## Tidigare spelare

- Sök först: 38 px fält överst, inget som listas före sökning eller browsning.
- Favoriter (chips) och senast sökta (`localStorage`) ovanför A–Z.
- Alias visas: "även känd som marek".
- **Ärlighet:** där pipelinen saknar verifierad data står det som det är —
  "Ingen verifierad klubbuppgift finns just nu". UI:t får aldrig antyda data
  som inte finns. Datakvaliteten är en separat arbetsström.

## Ark (sheets)

En enda detalj- och avslagsyta.

- Fokus **flyttas in** när den öppnas och **återställs** till öppnaren när den
  stängs (tidigare: ingen fälla, ingen återställning).
- Tab cyklas **inom** arket.
- Escape, bakdropp (riktig `<button>` med namn), drag ner, och iOS bakåtgester
  stänger — ingen gester är enda väg ut.
- Stängknappen har ett **namn** (`aria-label="Stäng …"`), aldrig en naken glyf.

## Rörelse

Endast där den förklarar något: lagerbyte (rumslig kontinuitet), ark in/ut
(modality), tryckbekräftelse. `prefers-reduced-motion` kollapsar allt till
korta opacitetsövergångar; ingen information går förlorad eftersom
pager-punkterna fortfarande visar position.

## Tillgänglighet (WCAG 2.2 AA)

- `focus-visible` på **alla** interaktiva element.
- `inert` satt som DOM-egenskap för off-screen lager.
- `role="img"` på formguide så `aria-label` är tillåten.
- Kontrast verifierad per token på varje yta: `--text-3` är 58 % vitt
  (4,5:1+ på #000, #0e0e0e, #161616, #1e1e1e). 45 % föll under gränsen.
- Varje gester har en synlig motsvarighet.
- axe-core kör på alla ytor **och på öppnade ark**.

## Tester som lassar produktreglerna

- `pipeline/src/discipline.test.ts` — `warningsUntilSuspension`
- `app/shared/format.test.ts` — resultatordning, kortstatus, tidslinje
- `e2e/brief.spec.ts` — kompakthet, lager, arkets fokusfälla, ingen SvFF i main
- `e2e/former-players.spec.ts` — ingen trupp läcker in, alias, favoriter
- `e2e/news.spec.ts` — inga dubbletter, en källa ≠ "flera källor", Firecrawl dold
- `e2e/layout.spec.ts` — inget horisontellt overflow 320–1024, chrome-kollision
- `e2e/offline.spec.ts` — cachad data när hämtningen fallerar

## Anti-bloat

Informationstäthet utan visuell täthet. Inga dekorativa kort, inga
hero-bilder, inga stockfoton, inga skuggorgier, inga onödiga knappar.
Varje element måste hjälpa användaren förstå eller göra något.
