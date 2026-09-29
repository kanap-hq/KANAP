#!/usr/bin/env node
/**
 * Home Open Graph card (public/og-image.png, 1200x630, plus the 2x retina file).
 *
 * Composes the brand headline with a fresh product screenshot, so the card
 * never shows a stale UI or a real user name. Take the screenshot first with
 * shoot-app.mjs (dashboard, Fromage demo tenant, neutral user), then:
 *
 *   CHROMIUM_PATH=/usr/bin/chromium node scripts/og-home.mjs \
 *     /tmp/shots/dashboard.png public/og-image.png public/og-image-retina.png
 *
 * Honours HTTPS_PROXY like shoot-app.mjs. Keep the headline in sync with the
 * home page title.
 */
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
const [shot, out, outRetina] = process.argv.slice(2);
const logo = 'data:image/svg+xml;base64,' + readFileSync('public/logo.svg').toString('base64');
const dash = 'data:image/png;base64,' + readFileSync(shot).toString('base64');
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px;overflow:hidden}
body{font-family:'Liberation Sans','Helvetica Neue',Arial,sans-serif;color:#fff;
 background:linear-gradient(135deg,#0d49a3 0%,#1460bb 60%,#1a6fd0 100%);position:relative}
.dots{position:absolute;inset:0;background-image:radial-gradient(rgba(255,255,255,.10) 1.5px,transparent 1.5px);background-size:26px 26px;opacity:.6}
.left{position:absolute;left:64px;top:0;height:630px;width:520px;display:flex;flex-direction:column;justify-content:center}
.brand{display:flex;align-items:center;gap:18px;margin-bottom:34px}
.brand .disc{width:72px;height:72px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center}
.brand img{width:52px;height:52px}
.brand span{font-size:34px;font-weight:700;letter-spacing:.14em}
h1{font-size:50px;line-height:1.08;font-weight:700;letter-spacing:-.01em}
h1 em{font-style:normal;color:#f8b133}
.sub{margin-top:22px;font-size:22px;line-height:1.4;color:#dbe7fb}
.tags{margin-top:30px;font-size:15px;letter-spacing:.22em;text-transform:uppercase;color:#bcd0f2}
.card{position:absolute;left:600px;top:60px;width:900px;border-radius:14px;overflow:hidden;
 box-shadow:0 30px 60px rgba(0,0,0,.35);background:#fff}
.card img{display:block;width:900px}
</style></head><body><div class="dots"></div>
<div class="left">
 <div class="brand"><div class="disc"><img src="${logo}"></div><span>KANAP</span></div>
 <h1>The <em>open source</em><br>IT governance platform.</h1>
 <div class="sub">Budget, application landscape, project portfolio and documentation in one record, with Plaid, a built-in AI agent.</div>
 <div class="tags">Open source · Self-hosted · AGPL v3</div>
</div>
<div class="card"><img src="${dash}"></div>
</body></html>`;
const PROXY = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
const browser = await puppeteer.launch({ executablePath: process.env.CHROMIUM_PATH, headless: 'new',
  args: ['--no-sandbox','--disable-dev-shm-usage', ...(PROXY ? [`--proxy-server=${PROXY.protocol}//${PROXY.host}`] : [])] });
const page = await browser.newPage();
for (const [path, dsf] of [[out, 1], [outRetina, 2]]) {
  await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: dsf });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log(path);
}
await browser.close();
