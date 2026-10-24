import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LineupSection } from "./MatchSheet";
import type { LineupOutcome } from "../players/lineupLookup";

const { fetchLineupOnDemand } = vi.hoisted(() => ({
  fetchLineupOnDemand: vi.fn(),
}));

vi.mock("../players/lineupLookup", () => ({ fetchLineupOnDemand }));

describe("LineupSection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
    vi.clearAllMocks();
  });

  it("fetches the lineup automatically and displays it when available", async () => {
    const outcome: LineupOutcome = {
      kind: "ok",
      lineups: {
        homeTeam: {
          abbrv: "BKH",
          formation: "4-3-3",
          starting: [{ givenName: "Test", surName: "Player", shirtNumber: 10 }],
          substitutes: [],
        },
        visitingTeam: null,
      },
    };
    vi.mocked(fetchLineupOnDemand).mockResolvedValue(outcome);

    await act(async () => {
      root.render(<LineupSection matchId={6530023} />);
    });

    expect(fetchLineupOnDemand).toHaveBeenCalledTimes(1);
    expect(fetchLineupOnDemand).toHaveBeenCalledWith(6530023);
    expect(container.textContent).toContain("Test Player");
    expect(container.textContent).toContain("Bortalag: Startelva ej tillgänglig");
    expect(container.querySelector("button")).toBeNull();
  });

  it("states when no lineup is available", async () => {
    vi.mocked(fetchLineupOnDemand).mockResolvedValue({ kind: "not-published" });

    await act(async () => {
      root.render(<LineupSection matchId={6530023} />);
    });

    expect(fetchLineupOnDemand).toHaveBeenCalledTimes(1);
    expect(fetchLineupOnDemand).toHaveBeenCalledWith(6530023);
    expect(container.textContent).toContain("Startelva ej tillgänglig");
  });

  it("does not duplicate the automatic request in React StrictMode", async () => {
    vi.mocked(fetchLineupOnDemand).mockResolvedValue({ kind: "not-published" });

    await act(async () => {
      root.render(
        <StrictMode>
          <LineupSection matchId={6530023} />
        </StrictMode>,
      );
    });

    expect(fetchLineupOnDemand).toHaveBeenCalledTimes(1);
  });
});
