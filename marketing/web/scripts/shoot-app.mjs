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
 * Output defaults to 2000x1050 CSS px at deviceScaleFactor 2 (4000x2100 PNG).
 * Site and blog standard (Fried, 2026-10-10): --width 1920 --height 1080 --scale 1
 * --lang en (1920 x 1080 PNG, English UI whatever the page language).
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
const SCALE = Number(flag('scale', 2)); // 1 for the site standard: 1920 x 1080 window, 1920 px PNG
const EMAIL = process.env.APP_EMAIL;
const PASSWORD = process.env.APP_PASSWORD;

// Sample data used by the shot definitions (Fromage demo tenant).
const ALLOC_ITEM_ID = 'OPX-2'; // SAP S/4HANA Maintenance, Headcount (refs resolve in the URL)
const ANALYTICS_ITEM_ID = '9f2f0c3f-fc65-441b-b22b-cfeefdd27086'; // OPX-8 AWS Cloud Hosting, Infrastructure
const COMPANY_NAME = 'Fromage & Co SA';
const LANG = flag('lang', ''); // UI language override, e.g. fr
// Budget demo data (Fromage & Co fixture with the budget files 26-30).
const STAFFING_ITEM_ID = flag('staffing-item', 'OPX-90'); // Régie · Product owner e-commerce · BOU-100
const SAAS_ITEM_ID = 'OPX-4'; // Salesforce (Sales + Service Cloud), account 612100
// OPEX list filter used by the budget articles: the two software accounts.
const SOFTWARE_ACCOUNTS = ['612100 - SaaS Subscriptions', '612200 - Software Licenses'];
// Analytics dimensions kept out of the shots (customer-specific names).
// Report filter controls to leave out of the shot, by label (local test dimensions):
// --hide "Dimension A,Dimension B".
const HIDDEN_DIMENSIONS = (flag('hide', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

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

// Click the first element matching `selector` whose text is exactly `text`.
const clickText = async (page, selector, text) => {
  for (const el of await page.$$(selector)) {
    if ((await el.evaluate((n) => n.textContent?.trim() || '')) === text) {
      await el.click();
      return true;
    }
  }
  console.warn(`'${text}' not found in ${selector}`);
  return false;
};

// MUI select placed after a plain text label (report and operations forms);
// `nth` picks a later select in the same group (e.g. the Columns pairs).
const pickSelect = async (page, label, option, nth = 1) => {
  const [select] = await page.$$(`xpath/.//*[normalize-space(text())="${label}"]/following::*[contains(@class,"MuiSelect-select")][${nth}]`);
  if (!select) return console.warn(`select '${label}' not found`);
  await select.click();
  await page.waitForSelector('li[role="option"]', { timeout: 10000 });
  await sleep(400); // let the menu finish opening, or the click lands on a neighbour
  if (!(await clickText(page, 'li[role="option"]', option))) await page.keyboard.press('Escape');
  await sleep(800);
  const shown = await select.evaluate((n) => n.textContent?.trim());
  if (shown !== option) console.warn(`select '${label}' shows '${shown}', not '${option}'`);
};

// Hide the filter controls of the given analytics dimensions (label + field).
const hideControls = (page, labels) =>
  page.evaluate((labels) => {
    for (const el of document.querySelectorAll('main label, main p, main span, main div')) {
      if (el.children.length || !labels.includes(el.textContent?.replace('*', '').trim())) continue;
      let box = el;
      while (box.parentElement && !box.querySelector('.MuiFormControl-root, .MuiSelect-select')) box = box.parentElement;
      box.style.display = 'none';
    }
  }, labels);

// Collapse the item Properties side panel. The state is kept in localStorage
// (this browser only), so it may already be closed by an earlier shot.
const closeProperties = async (page) => {
  const close = 'button[aria-label="Close properties"], button[aria-label="Fermer les propriétés"]';
  const open = 'button[aria-label="Open properties"], button[aria-label="Ouvrir les propriétés"]';
  await page.waitForSelector(`${close}, ${open}`, { timeout: 30000 });
  if (await page.$(close)) {
    await page.click(close);
    await sleep(800);
  }
};

// Reports draw once their query answers: wait for a table row or a chart.
const waitForReport = (page) =>
  page
    .waitForFunction(() => document.querySelector('main table tbody tr, main .ag-row, main .ag-charts-wrapper canvas'), { timeout: 40000 })
    .catch(() => console.warn('report still empty'));

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
  'chargeback-global': {
    path: '/ops/reports/chargeback/global',
    waitFor: 'main',
    prepare: (page) => page.waitForFunction(() => /Overall total\s+[\d,  ]{3,}/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 }),
  },
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
  // Budget presentation set: one item across years and columns, costed lines, organisation, settings, reports.
  'budget-item-tab': {
    path: `/ops/opex/${STAFFING_ITEM_ID}/budget?year=2026`,
    waitFor: 'main',
    prepare: (page) => page.waitForSelector('button[aria-label="Quantité et prix"], button[aria-label="Quantity and price"]', { timeout: 30000 }),
  },
  'budget-item-lines': {
    path: `/ops/opex/${STAFFING_ITEM_ID}/budget?year=2026`,
    waitFor: 'main',
    prepare: async (page) => {
      const sel = 'button[aria-label="Quantité et prix"], button[aria-label="Quantity and price"]';
      await page.waitForSelector(sel, { timeout: 30000 });
      await closeProperties(page); // keeps the analytics dimensions out of the shot
      await page.click(sel);
      await page.mouse.move(700, 300); // drop the button tooltip
      await sleep(2000);
    },
  },
  'budget-cost-centers': { path: '/master-data/cost-centers', waitFor: 'main' },
  'budget-calendars': { path: '/master-data/working-day-calendars', waitFor: 'main' },
  'budget-columns': { path: '/ops/operations/columns', waitFor: 'main' },
  'budget-freeze': { path: '/ops/operations/freeze', waitFor: 'main' },
  'budget-rows': { path: '/ops/operations/budget-rows', waitFor: 'main' },
  'budget-compare': {
    path: '/ops/reports/budget-columns-compare',
    waitFor: 'main',
    prepare: async (page) => {
      // Second selection: 2027 A0 → 2026 A3, so the chart compares budget and landing of the same year.
      await page.waitForSelector('.MuiSelect-select', { timeout: 20000 });
      await sleep(1500);
      // Select by current text: the last select showing `from` becomes `to`.
      const choose = async (from, to) => {
        const selects = await page.$$('.MuiSelect-select');
        let target = null;
        for (const el of selects) {
          const label = await el.evaluate((n) => n.textContent?.trim() || '');
          if (label === from) target = el;
        }
        if (!target) { console.warn(`select '${from}' not found`); return; }
        await target.click();
        await page.waitForSelector('li[role="option"]', { timeout: 10000 });
        for (const option of await page.$$('li[role="option"]')) {
          const label = await option.evaluate((el) => el.textContent?.trim() || '');
          if (label === to) { await option.click(); break; }
        }
        await sleep(800);
      };
      await choose('2027', '2026');
      await choose('A0 Budget', 'A3 Atterrissage');
      await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length > 1, { timeout: 30000 }).catch(() => {});
      await sleep(1500);
    },
  },
  'budget-top-opex': {
    path: '/ops/reports/top-opex',
    waitFor: 'main',
    prepare: async (page) => {
      await page.waitForFunction(() => !document.body.innerText.includes('No data to display') && !document.body.innerText.includes('Top 0'), { timeout: 40000 }).catch(() => console.warn('top opex still empty'));
      await sleep(1500);
    },
  },
  'budget-opex-list': { path: '/ops/opex', waitFor: 'main', prepare: async (page) => { await sleep(2500); } },
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
  // Budget feature page (October 2026): --out public/screenshots.
  'budget-opex-grid': {
    path: '/ops/opex',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      // Same columns as opex-list-filters, minus Task, so the 2026 amounts and their total show.
      await clickText(page, 'button', 'Choose columns');
      await page.waitForSelector('.MuiPopover-paper', { timeout: 10000 });
      for (const label of ['Paying company', 'Contract', 'Allocation', 'Task']) await clickText(page, '.MuiPopover-paper label', label);
      await page.keyboard.press('Escape');
      await page.waitForFunction(
        () => /\d/.test(document.querySelector('.ag-floating-bottom .ag-cell[col-id="yBudget"]')?.textContent || ''),
        { timeout: 30000 },
      );
      await sleep(1000);
    },
  },
  'budget-top-items': {
    path: '/ops/reports/top-opex',
    waitFor: 'main',
    async prepare(page) {
      await waitForReport(page);
      await pickSelect(page, 'Chart type', 'Pie chart');
      await hideControls(page, HIDDEN_DIMENSIONS);
      await page.waitForSelector('.ag-charts-wrapper canvas', { timeout: 20000 }).catch(() => {});
      await sleep(1500);
    },
  },
  // Budget articles (October 2026).
  'opex-list-filters': {
    path: '/ops/opex',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      // Hide Paying company, Contract and Allocation so the 2026 amounts fit
      // next to the Account column (column choice is kept in localStorage only).
      await clickText(page, 'button', 'Choose columns');
      await page.waitForSelector('.MuiPopover-paper', { timeout: 10000 });
      for (const label of ['Paying company', 'Contract', 'Allocation']) await clickText(page, '.MuiPopover-paper label', label);
      await page.keyboard.press('Escape');
      await sleep(800);
      // Account set filter: clear, then tick the two software accounts.
      const col = await page.$eval('.ag-header-cell[col-id="account_display"]', (h) => h.getAttribute('aria-colindex'));
      await page.click(`.ag-floating-filter[aria-colindex="${col}"] button`);
      // The popup fills in once the account values are loaded.
      await page.waitForFunction(
        () => [...document.querySelectorAll('.ag-popup button')].some((b) => b.textContent?.trim() === 'Clear')
          && document.querySelectorAll('.ag-popup label').length > 2,
        { timeout: 20000 },
      );
      await clickText(page, '.ag-popup button', 'Clear');
      await sleep(500);
      for (const account of SOFTWARE_ACCOUNTS) await clickText(page, '.ag-popup label', account);
      // Wait for the filtered total in the pinned bottom row.
      await page.waitForFunction(
        () => document.querySelector('.ag-floating-filter')?.closest('.ag-header')?.textContent?.includes('2 selected')
          && /\d/.test(document.querySelector('.ag-floating-bottom .ag-cell[col-id="yBudget"]')?.textContent || ''),
        { timeout: 30000 },
      );
      await sleep(1000);
    },
  },
  // Budget tab opened with the list filter in the URL: the "3 of 21" pill shows.
  'opex-budget-tab': {
    path: `/ops/opex/${SAAS_ITEM_ID}/budget?year=2026&filters=${encodeURIComponent(
      JSON.stringify({ account_display: { filterType: 'set', values: SOFTWARE_ACCOUNTS } }),
    )}`,
    waitFor: 'main',
    async prepare(page) {
      await closeProperties(page);
      await page.waitForFunction(() => / of \d+/.test(document.querySelector('main')?.innerText || ''), { timeout: 20000 });
      await page.waitForSelector('.ag-charts-wrapper canvas', { timeout: 20000 }).catch(() => {});
    },
  },
  'currency-settings': {
    path: '/ops/operations/currency',
    waitFor: 'main',
    prepare: (page) => page.waitForFunction(() => /\d\.\d{6}/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 }),
  },
  // Dry run only (never "Copy data"): 2026 Expected landing -> 2027 Budget, +3 %.
  'copy-budget-columns': {
    path: '/ops/operations/copy-budget-columns',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await sleep(1000);
      await pickSelect(page, 'Source year', '2026');
      await pickSelect(page, 'Source column', 'Expected landing');
      await pickSelect(page, 'Destination year', '2027');
      await pickSelect(page, 'Destination column', 'Budget');
      const [pct] = await page.$$('xpath/.//*[normalize-space(text())="Percentage increase"]/following::input[1]');
      await pct.click({ clickCount: 3 });
      await page.keyboard.type('3');
      await clickText(page, 'button', 'Dry run');
      await page.waitForFunction(() => /items? in the preview/.test(document.body.innerText), { timeout: 60000 });
      await sleep(1000);
      // Sort by preview, ascending: the skipped lines (0 or kept value) come
      // first, followed by the smallest copied lines.
      await page.click('.ag-header-cell[col-id="previewValue"]');
      await sleep(800);
      // Frame from the selection bar down to the first preview rows.
      const [bar] = await page.$$('xpath/.//*[normalize-space(text())="Source year"]/ancestor::*[contains(@class,"MuiPaper-root")][1]');
      await bar?.evaluate((n) => n.scrollIntoView({ block: 'start' }));
      await sleep(1000);
    },
  },
  'reporting-landing': {
    path: '/ops/reports',
    waitFor: 'main',
    prepare: (page) => page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Cost per FTE'), { timeout: 20000 }),
  },
  // Last year's landing against next year's budget (2027 budget is still empty on the demo tenant).
  'top-opex-increase': {
    path: '/ops/reports/opex-delta',
    waitFor: 'main',
    async prepare(page) {
      await waitForReport(page);
      await pickSelect(page, 'Source year', '2025');
      await pickSelect(page, 'Source metric', 'Expected landing');
      await pickSelect(page, 'Destination year', '2026');
      await pickSelect(page, 'Destination metric', 'Budget');
      await hideControls(page, HIDDEN_DIMENSIONS);
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Expected landing (2025)'), { timeout: 30000 });
      await sleep(1500);
    },
  },
  'cost-per-fte': {
    path: '/ops/reports/cost-per-fte',
    waitFor: 'main',
    async prepare(page) {
      await waitForReport(page);
      await pickSelect(page, 'Group by', 'Supplier');
      // 2026 Budget against 2026 Expected landing: 2025 and 2027 carry no FTE on the demo tenant.
      await pickSelect(page, 'Columns', '2026', 1);
      await pickSelect(page, 'Columns', 'Expected landing', 4);
      await hideControls(page, HIDDEN_DIMENSIONS);
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Expected landing 2026'), { timeout: 30000 });
      await sleep(1500);
    },
  },
  'chargeback-default-method': {
    path: '/ops/operations/allocation-default',
    waitFor: 'main',
    prepare: (page) => page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Headcount'), { timeout: 20000 }),
  },
  'chargeback-allocations': {
    path: `/ops/opex/${ALLOC_ITEM_ID}/allocations?year=2026`,
    waitFor: 'main',
    async prepare(page) {
      await closeProperties(page);
      await page.waitForFunction(() => /100(\.00)?%/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
    },
  },
};

// Flags that take a value, so their value is not read as a shot name.
const VALUE_FLAGS = ['base', 'out', 'theme', 'width', 'height', 'scale', 'lang', 'staffing-item', 'hide'];
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUE_FLAGS.includes(args[i - 1]?.slice(2)));
// A positional starting with "/" is an ad-hoc path, saved as path-<slug>.png (for scouting).
const adHoc = (p) => [`path-${p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}`, { path: p, waitFor: 'main' }];
const selected = has('all') || positional.length === 0
  ? PAGES
  : Object.fromEntries(
      positional.filter((k) => PAGES[k] || k.startsWith('/')).map((k) => (k.startsWith('/') ? adHoc(k) : [k, PAGES[k]])),
    );

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
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE });

  // The profile language wins over localStorage: with --lang, rewrite it in the
  // /auth/me answer for this browser only (the account itself is untouched).
  if (LANG) {
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      if (!/\/api\/auth\/me(\?|$)/.test(req.url()) || req.method() !== 'GET') return req.continue();
      try {
        const res = await fetch(req.url(), { headers: req.headers() });
        const body = await res.json();
        if (body?.profile) body.profile.locale = LANG;
        await req.respond({ status: res.status, contentType: 'application/json', body: JSON.stringify(body) });
      } catch {
        await req.continue();
      }
    });
  }

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
  if (LANG) await page.evaluate((lang) => window.localStorage.setItem('kanap_language', lang), LANG);
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
