import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/sqlite-core";
import { newId } from "../lib/id";
import {
  SELECTIONS,
  PICK_MODES,
  ROUND_KINDS,
  ROUND_STATUSES,
  ROUND_CODES,
  CONTEST_KINDS,
  CONTEST_STATUSES,
  FIXTURE_STATUSES,
  POOL_ROLES,
} from "../../shared/domain";

const id = () => text("id").primaryKey().$defaultFn(() => newId());
const now = () => integer({ mode: "timestamp" }).notNull().$defaultFn(() => new Date());

// ---------------------------------------------------------------- identity

export const users = sqliteTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    username: text("username"),
    passwordHash: text("password_hash"),
    emailVerifiedAt: integer("email_verified_at", { mode: "timestamp" }),
    timezone: text("timezone").notNull().default("America/New_York"),
    notifPrefs: text("notif_prefs", { mode: "json" })
      .notNull()
      .$type<{ reminders: boolean; digests: boolean }>()
      .default({ reminders: true, digests: true }),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(sql`lower(${t.email})`),
    uniqueIndex("users_username_idx").on(sql`lower(${t.username})`),
  ],
);

export const authTokens = sqliteTable(
  "auth_tokens",
  {
    id: id(),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["magic_link", "password_reset"] }).notNull(),
    // Only the hash is stored: a leaked DB must not yield usable login links.
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    consumedAt: integer("consumed_at", { mode: "timestamp" }),
    requestIp: text("request_ip"),
    /**
     * Same-origin path to land on after the link is consumed. Stored on the
     * token rather than in a cookie so an invite survives the usual pattern of
     * requesting the link on one device and opening it on another.
     */
    redirectTo: text("redirect_to"),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("auth_tokens_hash_idx").on(t.tokenHash),
    index("auth_tokens_user_idx").on(t.userId, t.kind),
  ],
);

// ------------------------------------------------------------- competition

export const competitions = sqliteTable("competitions", {
  id: id(),
  providerCode: text("provider_code").notNull(), // "CL"
  season: text("season").notNull(), // "2026-27"
  displayTz: text("display_tz").notNull().default("America/New_York"),
  firstKickoffAt: integer("first_kickoff_at", { mode: "timestamp" }),
  createdAt: now(),
});

export const teams = sqliteTable(
  "teams",
  {
    id: id(),
    providerTeamId: integer("provider_team_id").notNull(),
    name: text("name").notNull(),
    shortName: text("short_name").notNull(),
    crestUrl: text("crest_url"),
  },
  (t) => [uniqueIndex("teams_provider_idx").on(t.providerTeamId)],
);

export const rounds = sqliteTable(
  "rounds",
  {
    id: id(),
    competitionId: text("competition_id").notNull().references(() => competitions.id, { onDelete: "cascade" }),
    code: text("code", { enum: ROUND_CODES }).notNull(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ROUND_KINDS }).notNull(),
    pointsPerPick: integer("points_per_pick").notNull(),
    sequence: integer("sequence").notNull(),
    picksOpenAt: integer("picks_open_at", { mode: "timestamp" }),
    oddsLockAt: integer("odds_lock_at", { mode: "timestamp" }),
    firstKickoffAt: integer("first_kickoff_at", { mode: "timestamp" }),
    status: text("status", { enum: ROUND_STATUSES }).notNull().default("scheduled"),
  },
  (t) => [
    uniqueIndex("rounds_comp_code_idx").on(t.competitionId, t.code),
    index("rounds_sequence_idx").on(t.competitionId, t.sequence),
  ],
);

export const fixtures = sqliteTable(
  "fixtures",
  {
    id: id(),
    roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
    tieId: text("tie_id"), // set for knockout legs; FK omitted to avoid a cycle with ties
    leg: integer("leg"),
    providerFixtureId: integer("provider_fixture_id").notNull(),
    homeTeamId: text("home_team_id").notNull().references(() => teams.id),
    awayTeamId: text("away_team_id").notNull().references(() => teams.id),
    kickoffAt: integer("kickoff_at", { mode: "timestamp" }).notNull(),
    status: text("status", { enum: FIXTURE_STATUSES }).notNull().default("scheduled"),
    // 90-minute score decides league-phase picks.
    homeScore90: integer("home_score_90"),
    awayScore90: integer("away_score_90"),
    // Full-time score includes extra time; penalties are separate.
    homeScoreFt: integer("home_score_ft"),
    awayScoreFt: integer("away_score_ft"),
    homePens: integer("home_pens"),
    awayPens: integer("away_pens"),
    updatedAt: now(),
  },
  (t) => [
    uniqueIndex("fixtures_provider_idx").on(t.providerFixtureId),
    index("fixtures_round_idx").on(t.roundId),
    index("fixtures_tie_idx").on(t.tieId),
    index("fixtures_kickoff_idx").on(t.kickoffAt, t.status),
  ],
);

export const ties = sqliteTable(
  "ties",
  {
    id: id(),
    roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
    teamAId: text("team_a_id").notNull().references(() => teams.id),
    teamBId: text("team_b_id").notNull().references(() => teams.id),
    singleLeg: integer("single_leg", { mode: "boolean" }).notNull().default(false),
    leg1FixtureId: text("leg1_fixture_id"),
    leg2FixtureId: text("leg2_fixture_id"),
    aggA: integer("agg_a"),
    aggB: integer("agg_b"),
    winnerTeamId: text("winner_team_id").references(() => teams.id),
  },
  (t) => [
    index("ties_round_idx").on(t.roundId),
    uniqueIndex("ties_round_pair_idx").on(t.roundId, t.teamAId, t.teamBId),
  ],
);

/**
 * The single pickable unit. A league match produces one `fixture` contest; a
 * knockout tie produces one `tie` contest spanning both legs. Everything
 * downstream — picks, locking, grading, standings — sees only contests, so
 * there is exactly one code path regardless of round.
 */
export const contests = sqliteTable(
  "contests",
  {
    id: id(),
    roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: CONTEST_KINDS }).notNull(),
    fixtureId: text("fixture_id").references(() => fixtures.id, { onDelete: "cascade" }),
    tieId: text("tie_id").references(() => ties.id, { onDelete: "cascade" }),
    sideATeamId: text("side_a_team_id").notNull().references(() => teams.id),
    sideBTeamId: text("side_b_team_id").notNull().references(() => teams.id),
    /** Match kickoff, or first-leg kickoff for a tie. The only lock that matters. */
    locksAt: integer("locks_at", { mode: "timestamp" }).notNull(),
    status: text("status", { enum: CONTEST_STATUSES }).notNull().default("scheduled"),
    outcome: text("outcome", { enum: SELECTIONS }),
    settledAt: integer("settled_at", { mode: "timestamp" }),
  },
  (t) => [
    index("contests_round_idx").on(t.roundId),
    index("contests_locks_idx").on(t.locksAt, t.status),
    uniqueIndex("contests_fixture_idx").on(t.fixtureId),
    uniqueIndex("contests_tie_idx").on(t.tieId),
    check(
      "contests_exactly_one_target",
      sql`(${t.fixtureId} IS NULL) <> (${t.tieId} IS NULL)`,
    ),
  ],
);

export const oddsSnapshots = sqliteTable(
  "odds_snapshots",
  {
    id: id(),
    contestId: text("contest_id").notNull().references(() => contests.id, { onDelete: "cascade" }),
    bookmaker: text("bookmaker").notNull(),
    capturedAt: now(),
    /** True once frozen by the Monday 08:00 ET job. Only locked rows grade picks. */
    isLocked: integer("is_locked", { mode: "boolean" }).notNull().default(false),
    sideAPoint: real("side_a_point").notNull(),
    sideBPoint: real("side_b_point").notNull(),
    sideAPrice: real("side_a_price"),
    sideBPrice: real("side_b_price"),
  },
  (t) => [
    index("odds_contest_idx").on(t.contestId),
    // Partial index: exactly one *locked* line per contest, while indicative
    // pre-lock snapshots may accumulate freely.
    uniqueIndex("odds_locked_idx").on(t.contestId).where(sql`${t.isLocked} = 1`),
  ],
);

// -------------------------------------------------------------------- pools

export const pools = sqliteTable(
  "pools",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    inviteCode: text("invite_code").notNull(),
    joinPasswordHash: text("join_password_hash").notNull(),
    pickMode: text("pick_mode", { enum: PICK_MODES }).notNull(),
    /** Flips true once round 1 opens; the mode is frozen from then on. */
    modeLocked: integer("mode_locked", { mode: "boolean" }).notNull().default(false),
    competitionId: text("competition_id").notNull().references(() => competitions.id),
    ownerUserId: text("owner_user_id").notNull().references(() => users.id),
    /** Defaults to the competition's first kickoff. No late joins, no backfill. */
    joinClosesAt: integer("join_closes_at", { mode: "timestamp" }).notNull(),
    tiebreakers: text("tiebreakers", { mode: "json" }).notNull().$type<string[]>()
      .default(["points", "knockout_correct", "latest_round", "submitted_earliest"]),
    createdAt: now(),
  },
  (t) => [
    uniqueIndex("pools_slug_idx").on(t.slug),
    uniqueIndex("pools_invite_idx").on(t.inviteCode),
    uniqueIndex("pools_name_idx").on(sql`lower(${t.name})`),
  ],
);

export const poolMembers = sqliteTable(
  "pool_members",
  {
    poolId: text("pool_id").notNull().references(() => pools.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: POOL_ROLES }).notNull().default("member"),
    displayName: text("display_name"),
    joinedAt: now(),
  },
  (t) => [
    primaryKey({ columns: [t.poolId, t.userId] }),
    index("pool_members_user_idx").on(t.userId),
  ],
);

export const picks = sqliteTable(
  "picks",
  {
    id: id(),
    poolId: text("pool_id").notNull().references(() => pools.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    contestId: text("contest_id").notNull().references(() => contests.id, { onDelete: "cascade" }),
    selection: text("selection", { enum: SELECTIONS }).notNull(),
    /** Handicap applied to side A at grading time; simple mode, league phase only. */
    lineAtPick: real("line_at_pick"),
    createdAt: now(),
    updatedAt: now(),
    /** Stamped by the server when graded. Never accepted from the client. */
    lockedAt: integer("locked_at", { mode: "timestamp" }),
    isCorrect: integer("is_correct", { mode: "boolean" }),
    pointsAwarded: integer("points_awarded"),
  },
  (t) => [
    uniqueIndex("picks_unique_idx").on(t.poolId, t.userId, t.contestId),
    index("picks_contest_idx").on(t.contestId),
    index("picks_pool_user_idx").on(t.poolId, t.userId),
  ],
);

export const standingsRounds = sqliteTable(
  "standings_rounds",
  {
    poolId: text("pool_id").notNull().references(() => pools.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roundId: text("round_id").notNull().references(() => rounds.id, { onDelete: "cascade" }),
    points: integer("points").notNull().default(0),
    cumulativePoints: integer("cumulative_points").notNull().default(0),
    rank: integer("rank"),
    picksMade: integer("picks_made").notNull().default(0),
    picksPossible: integer("picks_possible").notNull().default(0),
    updatedAt: now(),
  },
  (t) => [
    primaryKey({ columns: [t.poolId, t.userId, t.roundId] }),
    index("standings_pool_round_idx").on(t.poolId, t.roundId),
  ],
);

export const auditLog = sqliteTable(
  "audit_log",
  {
    id: id(),
    actorUserId: text("actor_user_id").references(() => users.id),
    poolId: text("pool_id").references(() => pools.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    target: text("target"),
    before: text("before", { mode: "json" }),
    after: text("after", { mode: "json" }),
    createdAt: now(),
  },
  (t) => [index("audit_pool_idx").on(t.poolId, t.createdAt)],
);
