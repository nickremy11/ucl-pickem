import { describe, it, expect } from "vitest";
import {
  gradePick,
  resolveFixtureOutcome,
  resolveTieOutcome,
  type FixtureLike,
  type TieLike,
} from "./scoring";

const A = "team-a";
const B = "team-b";

function fx(over: Partial<FixtureLike> = {}): FixtureLike {
  return {
    homeTeamId: A,
    awayTeamId: B,
    status: "finished",
    kickoffAt: new Date("2027-02-17T20:00:00Z"),
    homeScore90: 0,
    awayScore90: 0,
    homeScoreFt: null,
    awayScoreFt: null,
    homePens: null,
    awayPens: null,
    ...over,
  };
}

const tie = (over: Partial<TieLike> = {}): TieLike => ({
  teamAId: A,
  teamBId: B,
  singleLeg: false,
  ...over,
});

describe("league fixture outcomes", () => {
  it("grades on the 90-minute score", () => {
    expect(resolveFixtureOutcome(fx({ homeScore90: 2, awayScore90: 1 }))?.selection).toBe("SIDE_A");
    expect(resolveFixtureOutcome(fx({ homeScore90: 0, awayScore90: 3 }))?.selection).toBe("SIDE_B");
    expect(resolveFixtureOutcome(fx({ homeScore90: 1, awayScore90: 1 }))?.selection).toBe("DRAW");
  });

  it("stays unresolved until the match is finished", () => {
    expect(resolveFixtureOutcome(fx({ status: "live", homeScore90: 1 }))).toBeNull();
    expect(resolveFixtureOutcome(fx({ homeScore90: null }))).toBeNull();
  });
});

describe("knockout tie outcomes", () => {
  const leg1 = (h: number, a: number, over: Partial<FixtureLike> = {}) =>
    fx({
      homeTeamId: A,
      awayTeamId: B,
      homeScore90: h,
      awayScore90: a,
      kickoffAt: new Date("2027-02-17T20:00:00Z"),
      ...over,
    });
  // Venues reverse in leg 2: side A is away.
  const leg2 = (h: number, a: number, over: Partial<FixtureLike> = {}) =>
    fx({
      homeTeamId: B,
      awayTeamId: A,
      homeScore90: h,
      awayScore90: a,
      kickoffAt: new Date("2027-02-24T20:00:00Z"),
      ...over,
    });

  it("adds both legs with venues reversed", () => {
    // A wins 2-1 at home, loses 1-0 away => 2-2... B wins on nothing, so check
    // a clear case: A 3-1, then B 1-0 => aggregate A 3-2.
    const out = resolveTieOutcome(tie(), [leg1(3, 1), leg2(1, 0)]);
    expect(out?.aggA).toBe(3);
    expect(out?.aggB).toBe(2);
    expect(out?.selection).toBe("SIDE_A");
    expect(out?.winnerTeamId).toBe(A);
  });

  it("counts extra time via the full-time score", () => {
    // Level 1-1 on aggregate after 90 in leg 2, then A scores in extra time.
    const out = resolveTieOutcome(tie(), [
      leg1(1, 0),
      leg2(1, 0, { homeScore90: 1, awayScore90: 0, homeScoreFt: 1, awayScoreFt: 2 }),
    ]);
    expect(out?.aggA).toBe(3);
    expect(out?.aggB).toBe(1);
    expect(out?.selection).toBe("SIDE_A");
  });

  it("has no away-goals rule — level aggregate goes to penalties", () => {
    const out = resolveTieOutcome(tie(), [
      leg1(0, 1),
      leg2(0, 1, { homePens: 2, awayPens: 4 }),
    ]);
    // Aggregate 1-1. B hosted leg 2 and lost the shootout 2-4, so A advances.
    expect(out?.aggA).toBe(1);
    expect(out?.aggB).toBe(1);
    expect(out?.selection).toBe("SIDE_A");
    expect(out?.winnerTeamId).toBe(A);
  });

  it("reads the shootout from the correct side when B hosts the decider", () => {
    const out = resolveTieOutcome(tie(), [
      leg1(1, 1),
      leg2(1, 1, { homePens: 5, awayPens: 3 }),
    ]);
    // B is home in leg 2 and won the shootout 5-3.
    expect(out?.selection).toBe("SIDE_B");
    expect(out?.winnerTeamId).toBe(B);
  });

  it("waits for the second leg", () => {
    expect(resolveTieOutcome(tie(), [leg1(2, 0)])).toBeNull();
  });

  it("waits for penalties when the aggregate is level and none are recorded", () => {
    expect(resolveTieOutcome(tie(), [leg1(1, 1), leg2(1, 1)])).toBeNull();
  });

  it("resolves a single-leg final on one fixture", () => {
    const out = resolveTieOutcome(tie({ singleLeg: true }), [
      leg1(0, 0, { homeScoreFt: 1, awayScoreFt: 2 }),
    ]);
    expect(out?.selection).toBe("SIDE_B");
  });

  it("resolves a single-leg final that goes to penalties", () => {
    const out = resolveTieOutcome(tie({ singleLeg: true }), [
      leg1(1, 1, { homeScoreFt: 1, awayScoreFt: 1, homePens: 4, awayPens: 2 }),
    ]);
    expect(out?.selection).toBe("SIDE_A");
  });
});

describe("pick grading", () => {
  const straight = (selection: "SIDE_A" | "SIDE_B" | "DRAW") => ({ selection, lineAtPick: null });

  it("compares straight picks to the outcome", () => {
    expect(gradePick(straight("SIDE_A"), "SIDE_A", null)).toBe(true);
    expect(gradePick(straight("DRAW"), "DRAW", null)).toBe(true);
    expect(gradePick(straight("SIDE_B"), "SIDE_A", null)).toBe(false);
  });

  it("grades a frozen handicap against the goal margin", () => {
    // Side A at -1.5 needs to win by two.
    const favourite = { selection: "SIDE_A" as const, lineAtPick: -1.5 };
    expect(gradePick(favourite, "SIDE_A", 2)).toBe(true);
    expect(gradePick(favourite, "SIDE_A", 1)).toBe(false);

    // Side B at +1.5 covers unless it loses by two or more.
    const underdog = { selection: "SIDE_B" as const, lineAtPick: -1.5 };
    expect(gradePick(underdog, "SIDE_A", 1)).toBe(true);
    expect(gradePick(underdog, "SIDE_B", -3)).toBe(true);
    expect(gradePick(underdog, "SIDE_A", 3)).toBe(false);
  });

  it("treats an exact push as no score for either side", () => {
    expect(gradePick({ selection: "SIDE_A", lineAtPick: -1 }, "SIDE_A", 1)).toBe(false);
    expect(gradePick({ selection: "SIDE_B", lineAtPick: -1 }, "SIDE_A", 1)).toBe(false);
  });

  it("ignores a stale handicap when the margin is unknown", () => {
    // Knockout ties carry no margin; the pick must fall back to the outcome.
    expect(gradePick({ selection: "SIDE_A", lineAtPick: -1.5 }, "SIDE_A", null)).toBe(true);
  });
});
