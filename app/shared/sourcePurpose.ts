/**
 * What each data source actually does, in plain Swedish.
 *
 * WHY THIS FILE EXISTS
 *   The settings sheet lists sources by technical name — `rss:bkhacken.se`,
 *   `article-text`, `sportomedia` — and reports whether each returned "OK".
 *   That answers "did it answer", which is not the question a supporter or a
 *   maintainer actually has. The question is "what does this thing DO for the
 *   app, and what happens to my news if it stops working?"
 *
 *   Answering that from the code requires knowing that `article-text` fetches
 *   each article's web page because RSS descriptions are truncated, that
 *   `sportomedia` is the club's own match-data server, and that `openrouter`
 *   runs nightly but has its answer THROWN AWAY. None of that is visible in a
 *   hostname, so it is written down here instead.
 *
 * WHY PLAIN LANGUAGE
 *   This app's audience reads Swedish, not GraphQL. Every string below is
 *   written to be read by someone who does not know what an API is. Where a
 *   technical word is unavoidable, the sentence explains it in the same breath.
 *
 * FALLBACK IS DELIBERATE
 *   An unrecognised source gets a generic sentence that is still true, rather
 *   than nothing. A new source added next year must not render as a blank row,
 *   and must never render a wrong claim about a source nobody has described.
 */

/** One source, explained. */
export interface SourcePurpose {
  /** What the app gets from this source. Plain Swedish, one or two sentences. */
  what: string;
  /** What happens to the app if it stops working. */
  ifBroken: string;
  /**
   * True when the answer is fetched, measured, and then DISCARDED.
   *
   * This is a genuinely different state from "off" and from "on", and the
   * OpenRouter nightly is exactly this case: one request per night, logged in
   * full, with the response thrown away so it cannot silently become the news
   * feed. Rendering it as "Påslagen" would imply its output reaches the app.
   */
  measureOnly?: boolean;
}

/** The services that are not news feeds. */
const SERVICES: Record<string, SourcePurpose> = {
  /**
   * The ROLLED-UP feed group. Not a real service name — this is the single row
   * that stands in for all eight feeds, so it needs its own text rather than
   * being described by whichever publisher happened to sort first.
   */
  rss: {
    what: "Åtta tidningar och sajter som appen läser nyheter från varje natt. Varje källa läses en gång, och det är bara artiklar som handlar om Häcken som tas med.",
    ifBroken: "Varje källa redovisas för sig, så det syns direkt vilken som slutat bidra — utan påverkan på de övriga flödena.",
  },
  "article-text": {
    what: "Läser själva texten i varje artikel. Nyhetsflödena innehåller bara rubrik och några ord, så appen hämtar artiklarnas egna webbsidor för att kunna läsa vad de handlar om.",
    ifBroken: "Artiklarna visas fortfarande med rubrik och bild, men appen kan inte avgöra vad de gäller och kan därför inte gruppera dem.",
  },
  sportomedia: {
    what: "Klubbens egen matchdataserver. Härifrån kommer truppen, spelschemat, resultat och tabellen — allt om själva fotbollen.",
    ifBroken: "Match- och truppdata står kvar från senaste körning som fungerade. Nyhetsflödena påverkas inte.",
  },
  gemini: {
    what: "En AI-tjänst från Google som läser artiklarna och föreslår vilka som handlar om samma sak, så att fem artiklar om ett byte kan visas som ett enda nyhetsuppdrag.",
    ifBroken: "Ingen påverkan just nu. Tjänsten är avstängd och nyheterna grupperas utan AI:n.",
    measureOnly: false,
  },
  openrouter: {
    what: "En alternativ AI-tjänst som gör samma uppdrag som Google-modellen. Varje natt skickas exakt en fråga för att mäta hur den svarar — men svaret sparas inte och används inte av appen.",
    ifBroken: "Ingen påverkan alls. Ingenting i appen bygger på den.",
    measureOnly: true,
  },
};

/** The news feeds, by publisher name. */
const PUBLISHERS: Record<string, SourcePurpose> = {
  "BK Häcken": {
    what: "Klubbens eget nyhetsflöde. Matchrapporter och beskedisheder direkt från klubben.",
    ifBroken: "Resten av nyheterna fungerar, men vi kan inte visa klubbens egna rapporter.",
  },
  Sportbladet: {
    what: "Sportbladets fotbollskrivning. En av Sveriges större sporttidningar.",
    ifBroken: "Övriga källor fungerar, men vi kan inte visa deras fotbollsartiklar.",
  },
  Expressen: {
    what: "Expressens fotbollskrivning. Skriver ofta först och snabbast om transfer och skador.",
    ifBroken: "Övriga källor fungerar, men vi kan inte visa deras fotbollsartiklar.",
  },
  "SVT Sport": {
    what: "SVT:s sportflöde. Publicist i allmänhet och granskande.",
    ifBroken: "Övriga källor fungerar, men vi kan inte visa deras sportartiklar.",
  },
  Allsvenskan: {
    what: "Allsvenskans eget flöde. Ligans egna beskedisheder.",
    ifBroken: "Ingen påverkan på själva nyheterna.",
  },
  Bollsvenskan: {
    what: "Bollsvenskans flöde. Litet flöde som huvudsakligen handlar om svensk fotboll överlag.",
    ifBroken: "Ingen nämnvärd påverkan — Bidraget är normalt mycket litet.",
  },
  Fotbolltransfers: {
    what: "Fotbolltransfers clubb-flöde. Specialiserat på spelare som flyttar till eller från just klubben.",
    ifBroken: "Ingen påverkan på nyheterna från de större källorna.",
  },
  "Göteborgs-Posten": {
    what: "Göteborgs-Postens lokala nyhetsflöde. Ger lokalkontext kring föreningen.",
    ifBroken: "Ingen påverkan på nyheterna från övriga källor.",
  },
};

/** Generic fallback. True for anything, so never a blank row. */
const UNKNOWN: SourcePurpose = {
  what: "En datakälla som inte är beskriven här än. Namnet i parentes visar vilken server appen läser.",
  ifBroken: "Okänt — den här källan är inte dokumenterad. Uppdatera den här filen.",
};

/**
 * Look up a source by the exact key used in the data.
 *
 * Accepts both shapes the app encounters: `rss:Sportbladet` from the
 * measurement log and `Sportbladet` from the source-count map. Matching is
 * exact — a near miss would show the wrong source's purpose, which is worse
 * than showing none.
 */
export function sourcePurpose(key: string): SourcePurpose {
  const direct = SERVICES[key] ?? PUBLISHERS[key];
  if (direct) return direct;
  if (key.startsWith("rss:")) return sourcePurpose(key.slice(4));
  return UNKNOWN;
}

/** True when we have written a real description rather than the fallback. */
export function hasPurpose(key: string): boolean {
  return key in SERVICES || key in PUBLISHERS;
}

/** Every described source, for the tests that keep this file honest. */
export const DESCRIBED_SOURCES: string[] = [...Object.keys(SERVICES), ...Object.keys(PUBLISHERS)];