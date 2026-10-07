/**
 * Trupp — the current men's squad.
 *
 * This destination exists because the squad was fully present in app.json
 * (squadStats, 27 players with season statistics) yet completely invisible:
 * the previous build had grouping helpers that nothing imported. The product
 * rule that was previously enforced as "the current squad is never a list"
 * now reads as "the current squad is never mixed into former players", and
 * this screen is where the squad lives.
 *
 * Discipline shown here is scoped to this same squad, so a player who has
 * left the club never appears as a current suspension risk.
 */
import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { AppDataState } from "../data";
import type { PlayerDiscipline, SeasonPlayerStat } from "../../pipeline/src/types";
import type { SquadEnrichment } from "../../pipeline/src/squadEnrichment";
import { PlayerCard } from "../shared/PlayerCard";
import {
  cstatFor,
  currentSquadDiscipline,
  squadByPosition,
  urgentDiscipline,
} from "../shared/format";
import { idFromSearch } from "../shared/nav";

export default function Squad({ state }: { state: AppDataState }) {
  const { search } = useLocation();
  const navigate = useNavigate();

  const data = state.status === "ready" ? state.data : null;
  const squad = data?.squadStats ?? [];
  const threshold = data?.disciplineRule?.threshold ?? 3;

  // EVERY hook runs before any early return.
  //
  // A cold load of #/trupp renders `loading` first and `ready` a tick later.
  // If any hook sat below the early returns, the hook count would differ
  // between those two renders and React would throw #310 ("Rendered more
  // hooks than during the previous render"), unmounting the whole app. The
  // squad is a primary destination, so a deep link must survive a refresh.
  const byId = useMemo(() => new Map(squad.map((p) => [p.playerId, p])), [squad]);
  const card = useMemo(() => {
    const m = new Map<string, PlayerDiscipline>();
    for (const d of currentSquadDiscipline(data?.discipline, squad)) m.set(d.playerId, d);
    return m;
  }, [data?.discipline, squad]);
  const urgentIds = useMemo(
    () => new Set(urgentDiscipline(currentSquadDiscipline(data?.discipline, squad)).map((d) => d.playerId)),
    [data?.discipline, squad],
  );

  if (state.status === "loading") {
    return (
      <div className="layer" aria-busy="true" aria-label="Laddar" data-testid="squad-page">
        <div className="module">
          <div className="skeleton" style={{ height: 260 }} />
        </div>
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className="layer" data-testid="squad-page">
        <div className="empty" role="status">
          <strong>Kunde inte läsa truppen</strong>
          Försök igen om en stund.
        </div>
      </div>
    );
  }

  const groups = squadByPosition(squad);
  const openId = idFromSearch(search);
  const open = openId ? (byId.get(openId) ?? null) : null;

  return (
    <div className="layer" data-testid="squad-page">
      <h1 className="sr-only">Aktuell herrtrupp — BK Häcken</h1>

      {squad.length === 0 ? (
        <div className="module">
          <div className="mod-label">Aktuell trupp</div>
          <p className="empty" data-testid="squad-empty">
            <strong>Truppdata saknas</strong>
            Aktuell matchdata kunde inte hämtas just nu.
          </p>
        </div>
      ) : (
        <>
          <section className="module">
            <h2 className="mod-label">
              Aktuell trupp
              <span className="count"> · {squad.length} spelare</span>
            </h2>
            <p className="small dim" style={{ marginTop: 0 }} data-testid="squad-competition">
              {squad[0].competition ?? "Aktuell säsong"}
            </p>
          </section>

          {groups.map((g) => (
            <section className="module" key={g.group} aria-labelledby={`grp-${g.group}`} data-testid={`squad-group-${g.group}`}>
              <h2 className="mod-label" id={`grp-${g.group}`}>
                {g.label}
                <span className="count"> · {g.players.length}</span>
              </h2>
              <div className="squad-list">
                {g.players.map((p) => (
                  <SquadRow
                    key={p.playerId}
                    p={p}
                    card={card.get(p.playerId)}
                    urgent={urgentIds.has(p.playerId)}
                    threshold={threshold}
                    onOpen={() => navigate(`/trupp?id=${encodeURIComponent(p.playerId)}`)}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}

      {open && (
        <SquadPlayerCard
          p={open}
          card={card.get(open.playerId)}
          enrichment={data?.squadEnrichment?.[open.playerId] ?? null}
          threshold={threshold}
          onClose={() => navigate("/trupp")}
        />
      )}
    </div>
  );
}

/**
 * One squad row. The name leads; the numbers are secondary and tabular so a
 * column of rows can be scanned vertically. A yellow edge marks a player who
 * is one card away from a suspension, and the row always carries the word
 * "avstängd" / "varning" in the detail sheet, so colour is never the only cue.
 */
function SquadRow({
  p,
  card,
  urgent,
  threshold,
  onOpen,
}: {
  p: SeasonPlayerStat;
  card?: PlayerDiscipline;
  urgent: boolean;
  threshold: number;
  onOpen: () => void;
}) {
  const cs = card ? cstatFor(card, threshold) : null;
  return (
    <button
      type="button"
      className={`srow${urgent ? " flagged" : ""}`}
      onClick={onOpen}
      data-testid="squad-player"
      data-player={p.playerId}
      aria-label={`${p.playerName}, ${POSITION_SHORT[p.positionGroup]}. ${p.matchesPlayed} matcher, ${p.goals} mål. Visa detaljer.`}
    >
      <span className="srow-name">
        {p.playerName}
        {cs && urgent ? <span className="srow-flag">{cs.severity === "suspended" ? "Avstängd" : cs.state}</span> : null}
      </span>
      <span className="srow-nums" aria-hidden="true">
        <b>{p.matchesPlayed}</b>
        <em>M</em>
        <b>{p.goals}</b>
        <em>Mål</em>
        <b>{p.assists}</b>
        <em>A</em>
      </span>
    </button>
  );
}

const POSITION_SHORT: Record<string, string> = {
  goalkeepers: "målvakt",
  defenders: "försvarare",
  midfields: "mittfältare",
  forwards: "anfallare",
};

/**
 * Current-player detail — now the SHARED card (user, 2026-10-07: "use the new
 * player card for the current squad too").
 *
 * The squad-unique data (season totals, kortläge) is passed as `squadFacts`
 * and renders in the card's TOP area, ahead of the Wikidata/Wikipedia layers.
 * The Wikidata side is resolved from the player's NAME — squad ids are fogis
 * ids, not Q-IDs — and when Wikidata has nothing trustworthy the card still
 * renders with the squad facts alone. The old minimal sheet showed only six
 * numbers; this shows the same numbers PLUS everything the search card shows.
 */
function SquadPlayerCard({
  p,
  card,
  enrichment,
  threshold,
  onClose,
}: {
  p: SeasonPlayerStat;
  card?: PlayerDiscipline;
  enrichment?: SquadEnrichment | null;
  threshold: number;
  onClose: () => void;
}) {
  const cs = card ? cstatFor(card, threshold) : null;
  return (
    <PlayerCard
      name={p.playerName}
      enrichment={enrichment}
      squadFacts={{
        positionLabel: POSITION_LABEL_LONG[p.positionGroup],
        competition: p.competition,
        matchesPlayed: p.matchesPlayed,
        matchesStarted: p.matchesStarted,
        goals: p.goals,
        assists: p.assists,
        yellowCards: p.yellowCards,
        redCards: p.redCards,
        cardState: cs ? `${cs.state} · ${card!.warningCount} varningar denna säsong` : null,
      }}
      onClose={onClose}
    />
  );
}

const POSITION_LABEL_LONG: Record<string, string> = {
  goalkeepers: "Målvakt",
  defenders: "Försvarare",
  midfields: "Mittfältare",
  forwards: "Anfallare",
};
