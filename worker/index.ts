import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { type AppEnv, withDb } from "./lib/app";
import { authRoutes } from "./routes/auth";
import { poolRoutes } from "./routes/pools";
import { adminRoutes } from "./routes/admin";
import { pickRoutes } from "./routes/picks";
import { standingsRoutes } from "./routes/standings";
import { runScheduled } from "./services/jobs";

const app = new Hono<AppEnv>();

app.use("*", withDb);

app.route("/api/auth", authRoutes);
app.route("/api/pools", poolRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/pools", pickRoutes);
app.route("/api/pools", standingsRoutes);

app.get("/api/health", (c) => c.json({ ok: true, now: new Date().toISOString() }));

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
