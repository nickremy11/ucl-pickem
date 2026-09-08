// Drives the running dev server with a real browser and captures screenshots.
// Usage: LOG=<path-to-dev-server-log> SHOTS=<output-dir> node scripts/screenshot.mjs
// Signs in through the magic link the dev server prints to its log.

import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const LOG = process.env.LOG;
const SHOTS = process.env.SHOTS;
const B = "http://localhost:5173";

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2 });
// Wait for every <img> to finish decoding before capturing, otherwise a
// full-page screenshot races the crest downloads and looks broken.
const settleImages = async () => {
  await page.evaluate(async () => {
    const imgs = [...document.images];
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((res) => {
              img.addEventListener("load", res, { once: true });
              img.addEventListener("error", res, { once: true });
            }),
      ),
    );
  });
};

const shot = async (name) => {
  await page.waitForTimeout(400);
  await settleImages();
  await page.waitForTimeout(200);
  const stats = await page.evaluate(() => {
    const imgs = [...document.images];
    return {
      total: imgs.length,
      loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      failed: imgs.filter((i) => i.complete && i.naturalWidth === 0).length,
    };
  });
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });
  console.log(`shot: ${name}  images ${stats.loaded}/${stats.total} loaded, ${stats.failed} failed`);
};

page.on("pageerror", (e) => console.log("PAGE ERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE ERROR:", m.text()); });

await page.goto(B, { waitUntil: "networkidle" });
await shot("1-login");

// Request a magic link for the seeded account.
await page.fill('input[type="email"]', "nick@example.com");
await page.click('button[type="submit"]');
await page.waitForTimeout(1500);
await shot("2-link-sent");

const link = [...readFileSync(LOG, "utf8").matchAll(/http:\/\/localhost:5173\/api\/auth\/callback\?token=[A-Za-z0-9_-]+/g)].pop()?.[0];
if (!link) { console.log("NO MAGIC LINK FOUND"); await browser.close(); process.exit(1); }
await page.goto(link, { waitUntil: "networkidle" });
await shot("3-dashboard");

// Into the pool
const poolLink = page.locator('a[href^="/p/"]').first();
if (await poolLink.count()) {
  await poolLink.click();
  await page.waitForLoadState("networkidle");
  await shot("4-pool-rounds");

  const round = page.locator('a[href*="/r/MD1"]').first();
  if (await round.count()) {
    await round.click();
    await page.waitForLoadState("networkidle");
    await shot("5-round-picks");
  } else { console.log("no MD1 link"); }

  await page.goBack(); await page.waitForLoadState("networkidle");
  const st = page.locator('a[href$="/standings"]').first();
  if (await st.count()) {
    await st.click();
    await page.waitForLoadState("networkidle");
    await shot("6-standings");
  } else { console.log("no standings link"); }
} else { console.log("no pool link on dashboard"); }

await browser.close();
console.log("done");
