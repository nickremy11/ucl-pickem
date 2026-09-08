/**
 * Domain vocabulary shared by the Worker and the React client.
 *
 * "Side A" / "Side B" rather than home/away: a two-legged knockout tie has no
 * home team, so every pickable thing is expressed as two sides. For a
 * league-phase match, side A is the home team.
 */

export const SELECTIONS = ["SIDE_A", "SIDE_B", "DRAW"] as const;
export type Selection = (typeof SELECTIONS)[number];

export const PICK_MODES = ["full", "simple"] as const;
export type PickMode = (typeof PICK_MODES)[number];

export const ROUND_KINDS = ["league", "knockout"] as const;
export type RoundKind = (typeof ROUND_KINDS)[number];

export const ROUND_STATUSES = ["scheduled", "open", "locked", "scored"] as const;
export type RoundStatus = (typeof ROUND_STATUSES)[number];

export const CONTEST_KINDS = ["fixture", "tie"] as const;
export type ContestKind = (typeof CONTEST_KINDS)[number];

export const CONTEST_STATUSES = ["scheduled", "open", "locked", "settled"] as const;
export type ContestStatus = (typeof CONTEST_STATUSES)[number];

export const FIXTURE_STATUSES = ["scheduled", "live", "finished", "postponed"] as const;
export type FixtureStatus = (typeof FIXTURE_STATUSES)[number];

export const POOL_ROLES = ["owner", "admin", "member"] as const;
export type PoolRole = (typeof POOL_ROLES)[number];

export const ROUND_CODES = [
  "MD1", "MD2", "MD3", "MD4", "MD5", "MD6", "MD7", "MD8",
  "KO_PLAYOFF", "R16", "QF", "SF", "FINAL",
] as const;
export type RoundCode = (typeof ROUND_CODES)[number];

/**
 * Round definitions, including scoring weight.
 *
 * League phase = 144 pts (60%), knockouts = 96 pts (40%). These values live in
 * the `rounds` table at seed time; changing them after a pool exists rewrites
 * every historical total, so treat this table as frozen once play starts.
 */
export interface RoundDef {
  code: RoundCode;
  name: string;
  kind: RoundKind;
  sequence: number;
  pointsPerPick: number;
}

export const ROUND_DEFS: readonly RoundDef[] = [
  { code: "MD1", name: "Matchday 1", kind: "league", sequence: 1, pointsPerPick: 1 },
  { code: "MD2", name: "Matchday 2", kind: "league", sequence: 2, pointsPerPick: 1 },
  { code: "MD3", name: "Matchday 3", kind: "league", sequence: 3, pointsPerPick: 1 },
  { code: "MD4", name: "Matchday 4", kind: "league", sequence: 4, pointsPerPick: 1 },
  { code: "MD5", name: "Matchday 5", kind: "league", sequence: 5, pointsPerPick: 1 },
  { code: "MD6", name: "Matchday 6", kind: "league", sequence: 6, pointsPerPick: 1 },
  { code: "MD7", name: "Matchday 7", kind: "league", sequence: 7, pointsPerPick: 1 },
  { code: "MD8", name: "Matchday 8", kind: "league", sequence: 8, pointsPerPick: 1 },
  { code: "KO_PLAYOFF", name: "Knockout Play-offs", kind: "knockout", sequence: 9, pointsPerPick: 3 },
  { code: "R16", name: "Round of 16", kind: "knockout", sequence: 10, pointsPerPick: 4 },
  { code: "QF", name: "Quarter-finals", kind: "knockout", sequence: 11, pointsPerPick: 5 },
  { code: "SF", name: "Semi-finals", kind: "knockout", sequence: 12, pointsPerPick: 6 },
  { code: "FINAL", name: "Final", kind: "knockout", sequence: 13, pointsPerPick: 8 },
];

/** football-data.org `stage` -> our round code. Matchdays resolve separately. */
export const STAGE_TO_ROUND: Record<string, RoundCode> = {
  PLAYOFFS: "KO_PLAYOFF",
  LAST_16: "R16",
  QUARTER_FINALS: "QF",
  SEMI_FINALS: "SF",
  FINAL: "FINAL",
};

/**
 * Bookmaker preference for simple-mode handicaps, most preferred first.
 * DraftKings and FanDuel carry the most US volume; Pinnacle is the backstop
 * because its soccer handicap coverage is the most consistently populated.
 */
export const BOOKMAKER_PRIORITY = ["draftkings", "fanduel", "betmgm", "pinnacle"] as const;

/** Which selections are legal for a contest. Draws only exist in league full-mode. */
export function allowedSelections(kind: ContestKind, mode: PickMode): Selection[] {
  if (kind === "tie") return ["SIDE_A", "SIDE_B"];
  return mode === "full" ? ["SIDE_A", "SIDE_B", "DRAW"] : ["SIDE_A", "SIDE_B"];
}
