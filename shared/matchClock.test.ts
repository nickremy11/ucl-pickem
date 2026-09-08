import { describe, it, expect } from "vitest";
import { matchClock } from "./matchClock";

const KICKOFF = "2026-09-08T16:45:00Z";
const at = (minutesAfterKickoff: number) =>
  new Date(KICKOFF).getTime() + minutesAfterKickoff * 60_000;

describe("matchClock", () => {
  it("shows nothing before kickoff", () => {
    const c = matchClock(KICKOFF, "scheduled", at(-30));
    expect(c.period).toBe("PRE");
    expect(c.live).toBe(false);
    expect(c.label).toBe("");
  });

  it("counts the first half", () => {
    expect(matchClock(KICKOFF, "live", at(1)).label).toBe("~1'");
    expect(matchClock(KICKOFF, "live", at(37)).label).toBe("~37'");
    expect(matchClock(KICKOFF, "live", at(45)).label).toBe("~45'");
  });

  it("treats the whole interval window as half-time", () => {
    // We cannot distinguish first-half stoppage from the break itself.
    expect(matchClock(KICKOFF, "live", at(48)).period).toBe("HT");
    expect(matchClock(KICKOFF, "live", at(59)).label).toBe("HT");
  });

  it("resumes the count in the second half, discounting the break", () => {
    // 61 minutes elapsed - 15 of interval = about the 46th minute.
    expect(matchClock(KICKOFF, "live", at(61)).label).toBe("~46'");
    expect(matchClock(KICKOFF, "live", at(80)).label).toBe("~65'");
    expect(matchClock(KICKOFF, "live", at(80)).period).toBe("2H");
  });

  it("caps at 90+ rather than inventing stoppage minutes", () => {
    expect(matchClock(KICKOFF, "live", at(105)).label).toBe("90+");
    expect(matchClock(KICKOFF, "live", at(140)).label).toBe("90+");
  });

  it("reports full time once the match is finished", () => {
    const c = matchClock(KICKOFF, "finished", at(120));
    expect(c.label).toBe("FT");
    expect(c.live).toBe(false);
  });

  it("does not go negative if the provider marks it live early", () => {
    expect(matchClock(KICKOFF, "live", at(-2)).minute).toBe(1);
  });

  it("never reports a postponed match as live", () => {
    expect(matchClock(KICKOFF, "postponed", at(30)).live).toBe(false);
  });
});
