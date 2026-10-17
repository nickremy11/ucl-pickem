import { describe, it, expect } from "vitest";
import { contestVenues, groundFor } from "./venues";

const grounds: Record<string, { stadium: string; city: string }> = {
  A: { stadium: "Stadium A", city: "City A" },
  B: { stadium: "Stadium B", city: "City B" },
};
const base = {
  sideATeamId: "A",
  sideBTeamId: "B",
  singleLeg: false,
  groundOf: (id: string) => grounds[id] ?? null,
  countryOf: (id: string) => (id === "A" ? "Spain" : "Italy"),
};
const d = (day: number) => new Date(`2027-03-${String(day).padStart(2, "0")}T20:00:00Z`);

describe("contestVenues", () => {
  it("a league fixture is hosted by its home team", () => {
    expect(contestVenues({ ...base, legs: [{ homeTeamId: "A", kickoffAt: d(3) }] })).toEqual([
      { leg: null, host: "SIDE_A", stadium: "Stadium A", city: "City A", country: "Spain" },
    ]);
  });

  it("a two-legged tie has each side host once, in kickoff order", () => {
    const v = contestVenues({
      ...base,
      // Deliberately out of order: leg numbering follows kickoff, not input.
      legs: [
        { homeTeamId: "B", kickoffAt: d(10) },
        { homeTeamId: "A", kickoffAt: d(3) },
      ],
    });
    expect(v.map((x) => [x.leg, x.host])).toEqual([
      [1, "SIDE_A"],
      [2, "SIDE_B"],
    ]);
  });

  it("derives the host from the fixture, not the side order", () => {
    const v = contestVenues({ ...base, legs: [{ homeTeamId: "B", kickoffAt: d(3) }] });
    expect(v[0].host).toBe("SIDE_B");
  });

  it("returns nothing for a single-leg neutral venue", () => {
    expect(
      contestVenues({ ...base, singleLeg: true, legs: [{ homeTeamId: "A", kickoffAt: d(3) }] }),
    ).toEqual([]);
  });

  it("skips a host with no known ground rather than guessing", () => {
    expect(contestVenues({ ...base, legs: [{ homeTeamId: "Z", kickoffAt: d(3) }] })).toEqual([]);
  });
});

describe("groundFor", () => {
  it("knows Real Madrid and not Shakhtar", () => {
    expect(groundFor(86)?.city).toBe("Madrid");
    expect(groundFor(1887)).toBeNull();
    expect(groundFor(undefined)).toBeNull();
  });
});
