import { describe, it, expect } from "vitest";
import { buildForm } from "./teamContext";
import type { FdMatch } from "./footballData";

const T = (id: number, name = `T${id}`) => ({ id, name, shortName: name, tla: name, crest: null });

function match(over: {
  day: number;
  home: number;
  away: number;
  hs: number | null;
  as: number | null;
  status?: FdMatch["status"];
  winner?: FdMatch["score"]["winner"];
}): FdMatch {
  return {
    id: over.day * 1000 + over.home,
    utcDate: `2026-10-${String(over.day).padStart(2, "0")}T19:00:00Z`,
    status: over.status ?? "FINISHED",
    stage: "LEAGUE_STAGE",
    matchday: 1,
    homeTeam: T(over.home),
    awayTeam: T(over.away),
    score: {
      winner: over.winner ?? null,
      duration: "REGULAR",
      fullTime: { home: over.hs, away: over.as },
      halfTime: { home: null, away: null },
    },
  };
}

const comp = () => "X";

describe("buildForm", () => {
  it("reads results from the team's own point of view", () => {
    const form = buildForm(1, [match({ day: 1, home: 1, away: 2, hs: 3, as: 1 }), match({ day: 2, home: 3, away: 1, hs: 2, as: 2 }), match({ day: 3, home: 4, away: 1, hs: 1, as: 0 })], comp);
    expect(form.map((f) => f.result)).toEqual(["W", "D", "L"]);
    expect(form[0]).toMatchObject({ opponent: "T2", home: true, score: "3-1" });
    expect(form[2]).toMatchObject({ opponent: "T4", home: false, score: "0-1" });
  });

  it("keeps the most recent five, oldest first", () => {
    const ms = [1, 2, 3, 4, 5, 6, 7].map((day) => match({ day, home: 1, away: 9, hs: day, as: 0 }));
    const form = buildForm(1, ms, comp);
    expect(form.map((f) => f.date)).toEqual(
      ["03", "04", "05", "06", "07"].map((d) => `2026-10-${d}`),
    );
  });

  it("sorts across competitions by date, not input order", () => {
    const form = buildForm(1, [match({ day: 9, home: 1, away: 2, hs: 1, as: 0 }), match({ day: 2, home: 1, away: 3, hs: 0, as: 1 })], comp);
    expect(form.map((f) => f.result)).toEqual(["L", "W"]);
  });

  it("ignores unfinished matches and other teams' games", () => {
    const form = buildForm(
      1,
      [
        match({ day: 1, home: 1, away: 2, hs: null, as: null, status: "SCHEDULED" }),
        match({ day: 2, home: 5, away: 6, hs: 1, as: 0 }),
        match({ day: 3, home: 1, away: 2, hs: 1, as: 0 }),
      ],
      comp,
    );
    expect(form).toHaveLength(1);
  });

  it("judges on the full-time score, not a shoot-out winner", () => {
    const m = match({ day: 1, home: 1, away: 2, hs: 1, as: 1, winner: "AWAY_TEAM" });
    expect(buildForm(1, [m], comp)[0].result).toBe("D");
  });

  it("labels each result with its competition", () => {
    const ucl = match({ day: 1, home: 1, away: 2, hs: 1, as: 0 });
    const form = buildForm(1, [ucl], (m) => (m === ucl ? "UCL" : "PL"));
    expect(form[0].competition).toBe("UCL");
  });
});
