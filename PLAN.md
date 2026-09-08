# Champions League Pick-'em — Build Plan

> **Status: shipped.** Live at https://ucl-pickem.ffhistorian.com — auth, pools,
> ingestion, picks, scoring and standings are all working against live data.
> See [README.md](README.md) for how it actually turned out; this document is
> the original plan and is kept for the reasoning behind each decision.
>
> Still outstanding: odds/simple mode (§6 "Odds lock"), reminder and digest
> emails, Turnstile, and the pool admin UI.

## 1. Product summary

A web app where friends form private pools and predict Champions League results,
round by round, from the 8-matchday league phase through the final. Picks lock at
kickoff, scoring is automated from a results feed, and every pool keeps a running
per-round and cumulative standings table.

Two pool formats, chosen at pool creation — **but they only differ during the
league phase**:

- **Full choice** — 3-way pick per match: home / draw / away.
- **Simple choice** — 2-way pick against a betting handicap ("who covers the
  goal spread"), using odds frozen Monday 8:00 AM ET before the round.

Once the knockouts start, **both modes are identical**: one pick per tie, pick
the team that advances.

## 2. Decisions locked in

| Area | Decision |
|---|---|
| Hosting / stack | Cloudflare full stack: React + Vite SPA, Hono API on Workers, D1 (SQLite), KV for sessions/cache, Workers Cron for jobs, R2 for backups |
| Fixtures & results | football-data.org API (competition code `CL`), free tier |
| Betting lines | The Odds API (`soccer_uefa_champs_league`, `spreads`) — league phase only |
| Auth | Email magic link (primary) + optional password; optional username; no third-party IdP |
| Email delivery | Cloudflare Email Sending via the `send_email` Worker binding — no API key to manage. Sends from `onboarding@ffhistorian.com` |
| Bot protection | Cloudflare Turnstile on signup / login / forgot-password |
| Competition timezone | `America/New_York` — odds lock is Monday **8:00 AM ET**; times displayed in each user's local zone |
| Knockout picks | **One pick per tie**, pick who advances. Same in both modes. Locks at first-leg kickoff |
| Final | Scored on who lifts the trophy (after ET / penalties) |
| Pool joining | Pools close to new members at the competition's first kickoff. No late joins, no backfill — everyone is scored from round 1 |
| Pick mode | Locked once round 1 opens |
| Visibility | Private only — invite link or pool name + password |

## 3. Competition model (2024-25 format onward)

| Round | Pickable units | Pick type | Points each | Round total |
|---|---|---|---|---|
| MD1–MD8 (league phase) | 18 matches each | 3-way (full) / 2-way vs handicap (simple) | 1 | 144 |
| Knockout play-offs | 8 ties | who advances | 3 | 24 |
| Round of 16 | 8 ties | who advances | 4 | 32 |
| Quarter-finals | 4 ties | who advances | 5 | 20 |
| Semi-finals | 2 ties | who advances | 6 | 12 |
| Final | 1 match | who lifts the trophy | 8 | 8 |
| | | | | **240** |

League phase 144 (60%), knockouts 96 (40%) — the bracket swings the standings
without the league phase becoming irrelevant.

Rounds are seeded up front with `code`, `points_per_pick`, `sequence`, and their
known window dates. Knockout rounds exist from day one with no contests inside
them; the daily sync creates ties once each draw is published. Point values live
in the `rounds` table, so rebalancing later is a data change — but it rewrites
every total, so it must be settled before the first pool exists.

## 4. Architecture

```
┌─────────────┐     ┌──────────────────────── Cloudflare Worker ───────────────┐
│  React SPA  │◄───►│  Hono router                                             │
│ (Workers    │     │   /api/auth/*   /api/pools/*   /api/rounds/*             │
│  Assets)    │     │   /api/picks/*  /api/standings/*  /api/admin/*           │
└─────────────┘     │                                                          │
                    │  Services: auth, pools, ingestion, odds, scoring, mail    │
                    └───┬─────────┬──────────┬───────────┬─────────────────────┘
                        │         │          │           │
                     D1 (SQLite)  KV      Cron Triggers  R2 (D1 backups)
                                  (sessions,
                                   API cache,
                                   rate limits)
                        │
        External:  football-data.org   ·   The Odds API   ·   Resend
```

- **One Worker** serves the SPA (Workers static assets) and `/api/*`.
- **Drizzle ORM** over D1; migrations via `wrangler d1 migrations`.
- **Sessions**: opaque token in an HttpOnly, Secure, SameSite=Lax cookie; token →
  `user_id` record in KV with a sliding 30-day TTL.
- **Password hashing**: PBKDF2-SHA256 (WebCrypto, ≥310k iterations) or Argon2id
  via `hash-wasm`. Same for pool join passwords.
- **External API calls** go through a cached client: raw responses stored in KV
  with a short TTL to respect rate limits (football-data.org free = 10 req/min;
  The Odds API free = 500 req/month, and one request returns every fixture's
  odds — comfortable).

## 5. Data model (D1)

The key idea: **`contests` is the single pickable unit.** A league-phase contest
wraps one fixture; a knockout contest wraps a tie (one or two legs). Every pick
references a contest, so scoring and standings have exactly one code path.

```
users            id, email(unique), username(unique,null), password_hash(null),
                 email_verified_at, timezone, notif_prefs(json), created_at

auth_tokens      id, user_id, kind(magic_link|password_reset), token_hash,
                 expires_at, consumed_at, request_ip

competitions     id, provider_code('CL'), season, display_tz('America/New_York'),
                 first_kickoff_at

pools            id, slug(unique), name, invite_code(unique), join_password_hash,
                 pick_mode(full|simple), mode_locked(bool),
                 competition_id, owner_user_id,
                 join_closes_at,          -- defaults to competition.first_kickoff_at
                 tiebreakers(json), created_at

pool_members     pool_id, user_id, role(owner|admin|member), display_name(null),
                 joined_at                              [PK: pool_id, user_id]

rounds           id, competition_id, code(MD1..MD8,KO_PLAYOFF,R16,QF,SF,FINAL),
                 name, kind(league|knockout), points_per_pick, sequence,
                 picks_open_at, odds_lock_at(null), first_kickoff_at,
                 status(scheduled|open|locked|scored)

teams            id, provider_team_id, name, short_name, crest_url

fixtures         id, round_id, tie_id(null), leg(1|2|null),
                 provider_fixture_id, home_team_id, away_team_id, kickoff_at,
                 status(scheduled|live|finished|postponed),
                 home_score_90(null), away_score_90(null),
                 home_score_ft(null), away_score_ft(null)   -- incl. ET
                 winner_after_pens_team_id(null)

ties             id, round_id, team_a_id, team_b_id, single_leg(bool),
                 leg1_fixture_id, leg2_fixture_id(null),
                 agg_a(null), agg_b(null), winner_team_id(null)

contests         id, round_id, kind(fixture|tie),
                 fixture_id(null), tie_id(null),      -- exactly one set
                 side_a_team_id, side_b_team_id,
                 locks_at,                            -- kickoff, or first-leg kickoff
                 status(scheduled|open|locked|settled),
                 outcome(SIDE_A|SIDE_B|DRAW|null), settled_at
                 -- DRAW is only ever set for league-phase full-mode contests

odds_snapshots   id, contest_id, bookmaker, captured_at, is_locked(bool),
                 side_a_point, side_b_point, side_a_price, side_b_price

picks            id, pool_id, user_id, contest_id,
                 selection(SIDE_A|SIDE_B|DRAW),
                 line_at_pick(null),                  -- handicap, simple mode only
                 created_at, updated_at, locked_at(null),
                 is_correct(null), points_awarded(null)
                 [unique: pool_id, user_id, contest_id]

standings_rounds pool_id, user_id, round_id, points, cumulative_points, rank,
                 picks_made, picks_possible, updated_at

audit_log        id, actor_user_id, pool_id(null), action, target,
                 before(json), after(json), created_at
```

`side_a` / `side_b` rather than home / away, because "home" is meaningless for a
two-legged tie. For a league fixture, side A is the home team.

Standings are materialised (`standings_rounds`) so the weekly table and movement
arrows are a single indexed read; the scoring job rewrites the affected rows.

## 6. Core flows

### Auth
1. Enter email → Turnstile → magic link email (token hashed at rest, 15-min
   single-use expiry). The link signs the user in and creates the session.
2. First sign-in prompts for an optional username and optional password.
3. Password users get email+password login plus forgot-password (same token
   table, `kind=password_reset`).
4. Rate limit: per-email and per-IP counters in KV on every auth endpoint.

### Create a pool (wizard)
1. Pool name → generated `slug` + `invite_code` + shareable link
   `/<slug>/join?code=…`.
2. Set a join password (required; shown once, hashed at rest).
3. Choose **full** or **simple** pick mode — with a warning that it locks once
   round 1 opens.
4. Optional: tiebreaker order, `join_closes_at` override.
5. Creator becomes `owner` and lands on the pool dashboard.

### Join a pool
`join` asks for **pool name (or slug/link)** + **password**. Rejected once
`now >= pool.join_closes_at`, which defaults to the competition's first kickoff.
Every member is therefore scored from round 1 — there is no backfill or
partial-season logic anywhere in the model.

### Making picks
- Round view: the round's contests with crests, lock time in the user's timezone,
  and a live countdown.
- League phase, full mode: three buttons (Side A / Draw / Side B).
- League phase, simple mode: two buttons showing the frozen handicap, e.g.
  `Real Madrid −1.5` vs `Opponent +1.5`.
- Knockouts, both modes: two buttons — pick the team that advances. One pick for
  the whole tie, locking at **first-leg kickoff**.
- Save is idempotent; a pick can be changed until its contest's `locks_at`.
- **Lock enforcement is server-side**: any pick write is rejected when
  `now >= contest.locks_at`; `locked_at` is stamped by the server, client
  timestamps are ignored. A per-minute cron flips `contest.status` to `locked`
  for the UI, but correctness never depends on that job running.

### Odds lock (simple pools, league phase only)
- Because knockouts are "who advances" in both modes, handicaps are only ever
  needed for MD1–MD8. No Asian-handicap-to-two-legged-tie mapping problem.
- Cron **Mondays 8:00 AM ET**: for every league round whose `first_kickoff_at`
  falls in the coming week, pull The Odds API, resolve one reference line per
  contest, write `odds_snapshots` with `is_locked=true`, set `round.odds_lock_at`.
- **Bookmaker resolution**: first available of `draftkings` → `fanduel` →
  `betmgm` → `pinnacle`, per contest. DraftKings and FanDuel are the highest-
  volume US books (matching the ET audience); Pinnacle is the backstop because
  it has the most reliable soccer handicap coverage. This is one config
  constant, easy to change.
- Simple-mode pick UI for a round stays disabled until its snapshot exists.
- DST: Workers cron is UTC, so run this hourly and gate on
  `Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York' })` reporting
  Monday 08:00. Never hardcode 12:00/13:00 UTC.

### Scoring
- Cron **every 15 min** (a no-op outside match windows): pull football-data.org
  results and update `fixtures`.
- Settle contests:
  - **League fixture** → `outcome` from the **90-minute** result.
  - **Knockout tie** → `outcome` is the side that advances: aggregate over both
    legs, then extra time, then penalties. Populate `ties.winner_team_id`.
  - **Final** → modelled as a single-leg tie; winner is the trophy lifter.
- Grade picks for every settled contest across every pool:
  - Full mode, league phase: `selection == outcome`. A 1-1 draw scores `DRAW`.
  - Simple mode, league phase: `SIDE_A` at `−1.5` is correct iff
    `home_score_90 − away_score_90 > 1.5`. Prefer quarter-goal handicaps so
    pushes are rare; a genuine push scores 0 for both sides.
  - Knockouts, both modes: `selection == advancing side`.
  - Points = `round.points_per_pick` when correct, else 0.
- Rewrite `standings_rounds` for affected pools: round points, cumulative, rank.
- Admin can override a fixture result or a tie winner and trigger a re-score;
  every override lands in `audit_log`.

### Standings
- Tabs: **Total** plus one per round. Each row shows points, cumulative, rank,
  movement vs the previous round, and picks-made / possible.
- Default tiebreakers (pool-configurable order): total points → correct knockout
  picks → correct picks in the latest round → head-to-head pick agreement →
  earliest average submission time.

### Admin panel (pool owner/admin)
Member list, role changes, removal, pool settings, manual result override and
re-score, invite link / password regeneration, audit log view.

## 7. Scheduled jobs (Workers Cron Triggers)

| Schedule (UTC) | Job |
|---|---|
| `*/15 * * * *` | Results sync → settle contests → score → rebuild standings |
| `0 10 * * *` | Schedule sync: teams, fixtures, knockout draws → build ties + contests; round status transitions |
| `0 * * * *` | Odds lock — fires hourly, acts only at Monday 08:00 `America/New_York` |
| `* * * * *` | Flip `contest.status` to `locked` at `locks_at` (UI only) |
| `0 16 * * *` | Reminder emails: unsubmitted picks for a contest locking within 24h |
| `0 13 * * *` | Post-round digest: standings + movers, once a round is fully scored |
| `0 7 * * *` | D1 export → R2 (retain 14 days) |

## 8. External integrations

### football-data.org
- `GET /v4/competitions/CL/matches` → matchday, stage, kickoff, status, and the
  score breakdown (regular / extra time / penalties).
- Map `stage`: `LEAGUE_STAGE` → MD1–8 (by `matchday`), `PLAYOFFS` → KO_PLAYOFF,
  `LAST_16` → R16, `QUARTER_FINALS` → QF, `SEMI_FINALS` → SF, `FINAL` → FINAL.
- Knockout rounds: group matches by team pair into a `tie`, set `leg`, then
  create one contest per tie with `locks_at` = leg 1 kickoff.
- If the feed is slow to publish a draw, an admin can enter the ties by hand.

### The Odds API
- `GET /v4/sports/soccer_uefa_champs_league/odds?markets=spreads&oddsFormat=decimal`.
- One request covers all upcoming fixtures. Match to contests by normalised team
  name + kickoff date; unmatched contests are flagged for admin review rather
  than silently skipped.

## 9. Frontend

- React 18 + Vite + TypeScript, React Router, TanStack Query, Tailwind +
  shadcn/ui, `date-fns-tz` for timezone display.
- PWA manifest, installable, mobile-first (picks and standings are the two
  screens people will open on a phone during a match). No native app in v1.
- Screens: landing / auth, dashboard (my pools), pool home, round picks,
  standings, pool admin, profile & notifications.
- Optimistic pick updates with server reconciliation; explicit upcoming /
  locked / settled states, and an empty state for knockout rounds whose draw
  hasn't happened yet.

## 10. Security & abuse

- Turnstile + KV rate limits on auth; magic-link and reset tokens hashed,
  single-use, short-lived.
- Pool join passwords hashed; brute-force throttled per pool.
- Every pick and admin write re-checks membership, role, and lock time
  server-side. Client timestamps are never trusted.
- `audit_log` for every admin override and role change.
- Secrets (`FOOTBALL_DATA_TOKEN`, `ODDS_API_KEY`, `RESEND_API_KEY`,
  `SESSION_SECRET`) via `wrangler secret`.

## 11. Testing

- Unit: the scoring engine (league full, league handicap, push, tie aggregate,
  ET, penalties, final), tiebreakers, lock enforcement, odds matching, and the
  DST-safe Monday-8AM-ET gate — Vitest with `@cloudflare/vitest-pool-workers`
  and Miniflare D1.
- Integration: auth flow, pool create/join, `join_closes_at` enforcement, pick
  lifecycle against a seeded synthetic competition.
- E2E: Playwright happy paths.
- Dev tooling: seed script with a synthetic competition, plus a dev-only "time
  travel" endpoint to simulate lock times, odds snapshots, and results.

## 12. Milestones

1. **Foundations** — repo, Worker + Assets, D1 + Drizzle + migrations,
   magic-link + password auth, sessions, Turnstile, email interface + Resend,
   profile.
2. **Pools** — create wizard, join, `join_closes_at`, membership, roles, admin
   panel skeleton.
3. **Ingestion** — football-data.org client, teams/fixtures/rounds sync, contest
   construction for the league phase, round lifecycle state machine.
4. **Picks (full choice)** — round view, pick CRUD, server lock enforcement,
   status cron, countdowns.
5. **Scoring + standings** — results cron, contest settlement, grading,
   materialised standings, tiebreakers, standings UI, admin override + re-score.
6. **Simple choice** — The Odds API client, Monday 8 AM ET snapshot, bookmaker
   fallback chain, handicap pick UI, spread scoring, push handling.
7. **Knockouts** — tie construction from the draw, per-tie contests, aggregate /
   ET / penalties settlement, final, round point values.
8. **Notifications & polish** — reminder + digest emails, PWA, timezones, edge
   states.
9. **Hardening** — rate limits, audit log surfacing, monitoring (Workers
   Analytics / Logpush), D1 backups to R2, load check.

## 13. Tonight's critical path

Target: a real pool playing MD1 tomorrow. Build in this order and stop when the
matches kick off — everything below the line still works without the rest.

**Must ship before first kickoff**
1. Worker + Vite + D1 + Drizzle scaffold, migrations applied.
2. Magic-link auth + sessions (password login can wait; the link is enough).
3. Pool create + join, `join_closes_at` enforcement.
4. football-data.org ingestion → teams, MD1–MD8 fixtures, league contests.
5. Round view + pick CRUD + server-side lock at `contest.locks_at`.

**Can land after MD1 kicks off, before results matter**
6. Results cron, contest settlement, grading, standings.

**Can land any time before February**
7. Knockouts (draw is months away — ties, aggregate/ET/penalties, final).
8. Simple mode / odds (see caveat below).
9. Reminder + digest emails, PWA, admin panel, hardening.

**Odds caveat:** the Monday 8:00 AM ET lock for MD1 had already passed by the
time the app existed, so MD1 has no legitimate frozen line and runs
full-choice. Simple mode can open from MD2, whose lock lands Monday 12 October.
