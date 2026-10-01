#!/usr/bin/env node
/**
 * Authenticated app screenshot runner (puppeteer-core + system chromium).
 *
 * Logs into a KANAP tenant and captures product pages, for blog and feature
 * screenshots. Unlike shoot.mjs (marketing site), this needs a real session.
 *
 * Usage:
 *   APP_EMAIL=you@example.com APP_PASSWORD=... node scripts/shoot-app.mjs \
 *     --base https://fromage.dev.kanap.net --out public/screenshots/blog
 *
 *   node scripts/shoot-app.mjs chargeback-global chargeback-company
 *   node scripts/shoot-app.mjs --all
 *   node scripts/shoot-app.mjs --inspect-fixed        # debug floating elements
 *
 * Output is 2000x1050 CSS px at deviceScaleFactor 2 (4000x2100 PNG), matching
 * the existing blog screenshots.
 *
 * Requirements:
 *   - chromium at /usr/bin/chromium (override with CHROMIUM_PATH)
 *   - APP_EMAIL / APP_PASSWORD in the environment (never committed)
 */

import puppeteer from 'puppeteer-core';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CHROME_PATH = process.env.CHROMIUM_PATH || '/usr/bin/chromium';
const args = process.argv.slice(2);
const flag = (name, def) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? def : args[i + 1];
};
const has = (name) => args.includes('--' + name);

const BASE = flag('base', 'https://fromage.dev.kanap.net');
const OUT_DIR = resolve(flag('out', 'public/screenshots/blog'));
const THEME = flag('theme', 'light');
const WIDTH = Number(flag('width', 2000));
const HEIGHT = Number(flag('height', 1050));
const EMAIL = process.env.APP_EMAIL;
const PASSWORD = process.env.APP_PASSWORD;

// Sample data used by the shot definitions (Fromage demo tenant).
const ALLOC_ITEM_ID = '97ed5331-5cf0-4ba1-bfa7-8e13fa3b3cb4'; // SAP S/4HANA, Headcount
const ANALYTICS_ITEM_ID = '9f2f0c3f-fc65-441b-b22b-cfeefdd27086'; // OPX-8 AWS Cloud Hosting, Infrastructure
const COMPANY_NAME = 'Fromage & Co SA';

if (!EMAIL || !PASSWORD) {
  console.error('APP_EMAIL and APP_PASSWORD are required (never hardcode them).');
  process.exit(2);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Dashboard widgets load independently; wait until the last skeleton is gone.
const waitForWidgets = (page) =>
  page
    .waitForFunction(() => !document.querySelector('.MuiSkeleton-root'), { timeout: 45000 })
    .catch(() => {});

const PAGES = {
  dashboard: { path: '/', waitFor: 'main', prepare: waitForWidgets },
  // Same dashboard, after opening a few records: "Recently viewed" is kept in
  // localStorage by each workspace page, so it is only filled within this browser
  // session. Refs (PRJ-6, T-2...) resolve in the URL; last visited shows first.
  'dashboard-rich': {
    path: '/',
    waitFor: 'main',
    visit: [
      '/it/applications/APP-8', // SAP S/4HANA
      '/portfolio/projects/PRJ-12', // Customer 360 Data Contracts
      '/portfolio/requests/REQ-6', // Cave climate sensors dashboard
      '/portfolio/tasks/T-2', // SAP Cheddar vendor selection
      '/portfolio/projects/PRJ-3', // Fromage-as-a-Service
      '/portfolio/projects/PRJ-6', // SAP Cheddar Migration
    ],
    prepare: waitForWidgets,
  },
  plaid: { path: '/ai', waitFor: 'main' },
  'chargeback-global': { path: '/ops/reports/chargeback/global', waitFor: 'main' },
  'chargeback-company': {
    path: '/ops/reports/chargeback/company',
    waitFor: 'main',
    async prepare(page) {
      // The autocomplete is disabled until the company lookup resolves.
      await page.waitForFunction(
        () => {
          const el = document.querySelector('.MuiAutocomplete-root input');
          return el && !el.disabled;
        },
        { timeout: 20000 },
      );
      const input = await page.$('.MuiAutocomplete-root input');
      await input.click();
      await sleep(200);
      await page.keyboard.type(COMPANY_NAME, { delay: 20 });
      await page.waitForSelector('li[role="option"]', { timeout: 15000 });
      const options = await page.$$('li[role="option"]');
      for (const option of options) {
        const text = await option.evaluate((el) => el.textContent?.trim() || '');
        if (text.startsWith(COMPANY_NAME)) {
          await option.click();
          break;
        }
      }
      await page.waitForFunction(
        () => !document.body.innerText.includes('Select a company to explore'),
        { timeout: 20000 },
      );
    },
  },
  'opex-allocations': { path: `/ops/opex/${ALLOC_ITEM_ID}/allocations?year=2026`, waitFor: 'main' },
  'allocation-default': { path: '/ops/operations/allocation-default', waitFor: 'main' },
  'budget-operations': { path: '/ops/operations', waitFor: 'main' },
  'reports-landing': { path: '/ops/reports', waitFor: 'main' },
  'opex-list': { path: '/ops/opex', waitFor: 'main' },
  'analytics-dimensions': { path: '/master-data/analytics', waitFor: 'main' },
  'analytics-opex-item': { path: `/ops/opex/${ANALYTICS_ITEM_ID}`, waitFor: 'main' },
  'analytics-report': { path: '/ops/reports/analytics', waitFor: 'main' },
  'analytics-report-range': {
    path: '/ops/reports/analytics',
    waitFor: 'main',
    async prepare(page) {
      // Widen the range to previous year -> next year so the chart switches to lines.
      const year = new Date().getFullYear();
      const pickYear = async (selectIndex, label) => {
        const selects = await page.$$('.MuiSelect-select');
        await selects[selectIndex].click();
        await page.waitForSelector('li[role="option"]', { timeout: 10000 });
        const options = await page.$$('li[role="option"]');
        for (const option of options) {
          const text = await option.evaluate((el) => el.textContent?.trim() || '');
          if (text === String(label)) {
            await option.click();
            break;
          }
        }
        await sleep(800);
      };
      await page.waitForSelector('.MuiSelect-select', { timeout: 20000 });
      await pickYear(0, year - 1);
      await pickYear(1, year + 1);
      await sleep(1500); // let the chart redraw
    },
  },
};

const positional = args.filter((a) => !a.startsWith('--'));
const selected = has('all') || positional.length === 0
  ? PAGES
  : Object.fromEntries(positional.filter((k) => PAGES[k]).map((k) => [k, PAGES[k]]));

mkdirSync(OUT_DIR, { recursive: true });

// Behind an outbound proxy (CI, sandboxes), chromium needs it passed explicitly.
// Credentials embedded in the URL go through page.authenticate(), which chromium
// does not read from --proxy-server. A MITM proxy also means its CA is unknown
// to chromium, hence --ignore-certificate-errors (screenshots only).
const PROXY_URL = (() => {
  const raw = process.env.HTTPS_PROXY || process.env.https_proxy || '';
  try { return raw ? new URL(raw) : null; } catch { return null; }
})();
const browser = await puppeteer.launch({
  executablePath: CHROME_PATH,
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--hide-scrollbars',
    ...(PROXY_URL
      ? [`--proxy-server=${PROXY_URL.protocol}//${PROXY_URL.host}`, '--ignore-certificate-errors']
      : []),
  ],
});

try {
  const page = await browser.newPage();
  if (PROXY_URL?.username) {
    await page.authenticate({
      username: decodeURIComponent(PROXY_URL.username),
      password: decodeURIComponent(PROXY_URL.password),
    });
  }
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 });

  if (has('inspect-fixed')) {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate((theme) => window.localStorage.setItem('themeMode', theme), THEME);
    await page.type('input[type="text"]', EMAIL);
    await page.type('input[type="password"]', PASSWORD);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {}),
      page.click('button[type="submit"]'),
    ]);
    const found = await page.evaluate(() =>
      [...document.querySelectorAll('*')]
        .filter((el) => {
          const cs = getComputedStyle(el);
          if (cs.position !== 'fixed' && cs.position !== 'sticky') return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && r.bottom > innerHeight - 220 && r.right > innerWidth - 220;
        })
        .map((el) => ({
          tag: el.tagName.toLowerCase(),
          cls: el.className?.toString?.().slice(0, 120),
          label: el.getAttribute('aria-label'),
          text: (el.textContent || '').trim().slice(0, 60),
        })),
    );
    console.log(JSON.stringify(found, null, 2));
    await browser.close();
    process.exit(0);
  }

  // Sign in once; the SPA keeps the token for the whole run.
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate((theme) => window.localStorage.setItem('themeMode', theme), THEME);
  await page.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), THEME);
  await page.type('input[type="text"]', EMAIL);
  await page.type('input[type="password"]', PASSWORD);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await sleep(1500);
  if (page.url().includes('/login')) {
    throw new Error(`Login failed, still on ${page.url()}`);
  }
  console.log(`logged in as ${EMAIL} (${page.url()})`);

  // Keep the shot clean: the dev build mounts the TanStack Query devtools button.
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.textContent = '.tsqd-open-btn-container{display:none!important}';
    document.head.appendChild(style);
  });

  for (const [name, def] of Object.entries(selected)) {
    // Open the listed records first; each one writes a fresh entry to the
    // kanap-recent-views:* localStorage key once its data has loaded.
    for (const path of def.visit || []) {
      const since = Date.now();
      await page.goto(`${BASE}${path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page
        .waitForFunction(
          (t0) =>
            Object.keys(localStorage)
              .filter((k) => k.startsWith('kanap-recent-views:'))
              .some((k) => (JSON.parse(localStorage.getItem(k) || '[]')[0]?.viewedAt || 0) >= t0),
          { timeout: 20000 },
          since,
        )
        .catch(() => console.warn(`not recorded as recently viewed: ${path}`));
    }
    // domcontentloaded + explicit wait: the SPA keeps polling, so networkidle0
    // never reliably settles.
    await page.goto(`${BASE}${def.path}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector(def.waitFor || 'main', { timeout: 20000 }).catch(() => {});
    // Re-apply the theme + hide rules after a full navigation.
    await page.evaluate((theme) => {
      document.documentElement.setAttribute('data-theme', theme);
      const style = document.createElement('style');
      style.textContent = '.tsqd-open-btn-container{display:none!important}';
      document.head.appendChild(style);
    }, THEME);
    if (def.prepare) await def.prepare(page);
    await sleep(2500); // let charts and AG Grid settle
    const out = `${OUT_DIR}/${name}.png`;
    await page.screenshot({ path: out, fullPage: has('full') });
    console.log(out);
  }
} finally {
  await browser.close();
}
