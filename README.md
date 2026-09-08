# UCL Pick'em

A private Champions League prediction pool. Friends join a pool, pick every
fixture round by round, and the app scores it automatically from a live results
feed.

Live at **https://ucl-pickem.ffhistorian.com**

## How it works

**Two pool formats**, chosen at creation — but they only differ during the
league phase:

- **Full choice** — home / draw / away on every match.
- **Against the spread** — pick which side covers a goal handicap, frozen at
  08:00 ET the Monday before the round.

Once the knockouts begin both formats are identical: one pick per tie, pick who
advances.

**Scoring**

| Round | Units | Points each | Total |
|---|---|---|---|
| MD1–MD8 (league phase) | 18 matches each | 1 | 144 |
| Knockout play-offs | 8 ties | 3 | 24 |
| Round of 16 | 8 ties | 4 | 32 |
| Quarter-finals | 4 ties | 5 | 20 |
| Semi-finals | 2 ties | 6 | 12 |
| Final | 1 match | 8 | 8 |
| | | | **240** |

League matches are graded on the **90-minute** result. Knockout ties are graded
on who advances — aggregate, then extra time, then penalties. There is no
away-goals rule.

**Locking**

- League contests lock at kickoff.
- Knockout ties lock at the **first leg's** kickoff.
- Pools close to new members at the competition's first kickoff.

Lock enforcement is server-side on every write. A missed cron can never let a
late pick through.

## Architecture

One Cloudflare Worker serves both the React SPA and the API.

```
React 19 + Vite ──► Hono API ──► D1 (SQLite) via Drizzle
                       │
                       ├─ KV: sessions, API cache, rate limits
                       ├─ Email Sending binding (magic links)
                       └─ Cron: results polling, schedule sync, odds lock
```

The load-bearing idea is **`contests`**: the single pickable unit. A league match
produces one `fixture` contest; a knockout tie produces one `tie` contest
spanning both legs. Picks, locking, grading and standings therefore have exactly
one code path regardless of round.

Sides are `side_a` / `side_b` rather than home/away, because "home" is
meaningless for a two-legged tie.

Data comes from [football-data.org](https://www.football-data.org) (fixtures,
results, crests) and [The Odds API](https://the-odds-api.com) (handicaps, league
phase only).

## Local development

```bash
npm install
npx wrangler types            # generates worker-configuration.d.ts (gitignored)
cp .dev.vars.example .dev.vars
# fill in FOOTBALL_DATA_TOKEN; leave MAIL_TRANSPORT=console
npx wrangler d1 migrations apply ucl-pickem --local
npm run dev
```

With `MAIL_TRANSPORT=console`, magic links print to the dev server log instead of
emailing anyone. Copy the link from there to sign in.

Populate fixtures locally:

```bash
curl -X POST http://localhost:5173/api/admin/sync -H "x-admin-token: $ADMIN_TOKEN"
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite + Workers runtime |
| `npm run build` | Production build |
| `npm run deploy` | Build and deploy |
| `npm test` | Scoring engine tests |
| `npm run typecheck` | App + worker + node configs |
| `npm run db:generate` | Generate a migration from the schema |
| `npm run db:local` / `db:remote` | Apply migrations |
| `npm run shots` | Screenshot the running app via Playwright |

## Operations

Maintenance endpoints are gated by the `ADMIN_TOKEN` secret (constant-time
compared, fails closed). They exist to bootstrap and repair the competition,
including before any account exists.

| Endpoint | Purpose |
|---|---|
| `POST /api/admin/sync` | Pull teams, fixtures, ties and contests |
| `POST /api/admin/score` | Settle contests, grade picks, rebuild standings |
| `POST /api/admin/refresh-rounds` | Recompute round timing and status |
| `GET /api/admin/status` | Season snapshot |

Two cron triggers run in production: a five-minute tick (lock states, result
polling during match windows) and an hourly job that acts only when the wall
clock in `America/New_York` matches — so the Monday odds freeze and the daily
sync do not drift when the US changes clocks.

### Gotchas worth knowing

- **D1 caps bound parameters at 100 per query**, not rows. Bulk inserts are
  chunked by table width in `worker/db/batch.ts` — never hand-count columns,
  generated ids are bound too.
- **`drizzle.config.ts` and `worker/db/index.ts` must agree on `casing`.**
  If they diverge, columns whose names are inferred from the property generate
  as camelCase but are queried as snake_case: the table exists, the column does
  not.
- **The Workers runtime caps PBKDF2 at 100,000 iterations** and throws
  `NotSupportedError` above it — and the *local* runtime does not enforce that
  cap. A higher work factor therefore passes every local test and fails only
  once deployed. `worker/lib/crypto.test.ts` pins the constant, and
  `GET /api/health?deep=1` exercises the KDF against the real runtime after a
  deploy.
- **Password hashing still wants Workers Paid.** Even at 100k iterations the
  KDF exceeds the Free plan's 10ms CPU budget. Magic links do not.
- **`Date.now()` does not advance during CPU work** on Workers — the clock
  moves only on I/O. Timing pure computation with it always yields zero.
