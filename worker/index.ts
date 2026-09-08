import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type AppEnv, withDb } from "./lib/app";
import { authRoutes } from "./routes/auth";
import { poolRoutes } from "./routes/pools";
import { adminRoutes } from "./routes/admin";
import { pickRoutes } from "./routes/picks";
import { standingsRoutes } from "./routes/standings";
import { runScheduled } from "./services/jobs";
import { hashPassword, verifyPassword } from "./lib/crypto";

const app = new Hono<AppEnv>();

app.use("*", withDb);

app.route("/api/auth", authRoutes);
app.route("/api/pools", poolRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/pools", pickRoutes);
app.route("/api/pools", standingsRoutes);

/**
 * `?deep=1` additionally exercises the password KDF.
 *
 * Worth a dedicated probe: the Workers runtime caps PBKDF2 iterations and the
 * local runtime does not enforce that cap, so a bad work factor passes every
 * local test and only fails once deployed. Cheap enough to run after a deploy,
 * so it is opt-in rather than on the default path.
 */
app.get("/api/health", async (c) => {
  const body: Record<string, unknown> = { ok: true, now: new Date().toISOString() };

  if (c.req.query("deep")) {
    try {
      const stored = await hashPassword("health-probe");
      // No timing reported: Workers advances the clock only on I/O, so
      // Date.now() deltas around pure CPU work always read zero.
      body.kdf = {
        ok: await verifyPassword("health-probe", stored),
        iterations: Number(stored.split("$")[1]),
      };
    } catch (err) {
      body.ok = false;
      body.kdf = { ok: false, error: String(err) };
    }
  }

  return c.json(body, body.ok ? 200 : 500);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: err.message }, err.status);
  }
  console.error("Unhandled error:", err);
  return c.json({ error: "Something went wrong on our end." }, 500);
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default {
  fetch: app.fetch,

  async scheduled(controller, env, ctx) {
    // waitUntil keeps the work alive past the handler returning; without it a
    // long sync can be cut off mid-write.
    ctx.waitUntil(
      runScheduled(env, controller.cron).catch((err) => {
        console.error("scheduled job failed:", controller.cron, err);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
