# UX-specifikation — Min BKH

## Identitet

- **BK Häcken: svart + gult.** Design tokens i `app/theme.css`.
- `--bkh-black: #0a0a0a` (primära ytor), `--bkh-yellow: #ffd200` (accent/aktion),
  `--bkh-yellow-dark: #b89700` (accent på ljus bakgrund), neutrala stödytor i
  mörkgrå toner, rött endast för avstängning/fel, grönt endast för positiva
  tillstånd (t.ex. "spelför".
- Ingen generisk blå/lila AI-känsla. Gult används medvetet, inte överallt.
- Logotyp/ikon: svart-gul emblem med Göteborgskran, häck och fotboll
  (`public/icons/`), används som PWA-ikon och i appens sidhuvud.

## Layout & navigation

- Mobil-först. Bottenflikar: **Hem · Matcher · Nyheter · Spelare**.
- Bottenligan är fix, 64px hög, minst 48×48 px träffytor per flik, ikon + kort
  svensk etikett (universiellt begripliga ikoner: House, CalendarDays,
  Newspaper, Users).
- Hem skärm (ordning):
  1. Nästa match (tävling, motståndare, datum/tid, hemma/borta) — mest framträdande.
  2. Varningsläget (avstängda + "en varning från avstängning").
  3. Senaste resultatet.
  4. Senaste herrnyheterna (3–5).
  5. Tabellposition när data finns.
- Inga hero-bilder, ingen karusell, inga dekorationer.

## Typografi & ytor

- Systemtypsnitt (SF Pro/Roboto-stack), 16px bas.
- Rubriker i gult accent eller vitt på svart; brödtext vit/mörkgrå.
- Listor och rader före kort; `shadcn/ui`-liknande komponenter är
  egna enkla komponenter (Badges, rader) — inga tunga bibliotek.
- Tabeller endast där de verkligen är lättare att skanna (senaste matchens
  spelarstatistik).

## Rörelse (touch)

- Primära interaktiva kontroller ≥ 48×48 CSS px.
- En hand: viktig information och primära åtgärder i nedre 2/3 av skärmen.
- Fungerar på 320px bredd utan horisontell scroll.

## Tillstånd

- **Laddar**: skelett som bevarar layout.
- **Tom**: kort förklaring ("Inga nyheter just nu") — aldrig tom skärm.
- **Fel**: förklarar vad som misslyckats + förslag ("Försök igen senare").
- **Gammal data**: "Senast uppdaterad 23 sep 18:42"; vid hög ålder:
  "Data kan vara inaktuell" — subtilt, ingen skrämselbild.

## Tillgänglighet (WCAG 2.2 AA-mål)

- Semantisk HTML, tangenter, synlig fokusmarkering, aria-labels på
  ikonknappar, kontrast ≥ 4.5:1 för text (gult #ffd200 på svart ≈ 14:1).
- axe-core (Playwright) körs på huvudskärmarna.
- Inga ikonkontroller utan tillgängligt namn.

## Anti-bloat-principer

- Informationstäthet utan visuell täthet: många fakta, få element.
- Ingen dekorationsgrad: inga gradienter, inga stockfotbollsbilder,
  inga skugg-orgier, inga excessivt runna kort.
- Kort svensk etikett ("Nästa match", "Avstängd", "En varning kvar").
- Svenska i hela UI:t (målgrupp: svenska supportrar).
