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
 * Site and blog standard (Fried, 2026-10-10, frames 2026-10-25): --lang en and a
 * 1920 x 1080 PNG, English UI whatever the page language. Each shot picks its frame
 * (see FRAME_SET): the smallest window that still shows its whole subject (no
 * column, section or text cut that the caption talks about) with KANAP's layout
 * intact. Compare candidates with --frames 1920,1600,1440,1280, then set `frame`.
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
// Frame (Fried, 2026-10-25): every site and blog shot is a 1920 x 1080 PNG, but each
// shot picks the browser window that reads best: 1920, 1600, 1440 or 1280 CSS px
// wide, zoomed to fill 1920 px. Never below 1280: KANAP switches to its compact
// layout. A shot sets `frame: 1600` in its definition; --frame forces one for the
// run; --frames 1920,1600,1280 shoots each candidate as name@1600.png to compare.
const FRAME_SET = [1920, 1600, 1440, 1280];
const FRAME = Number(flag('frame', 0));
const FRAMES = (flag('frames', '') || '').split(',').map(Number).filter(Boolean);
for (const f of [FRAME, ...FRAMES].filter(Boolean)) {
  if (!FRAME_SET.includes(f)) {
    console.error(`frame ${f} is not one of ${FRAME_SET.join(', ')}`);
    process.exit(2);
  }
}
const frameViewport = (frame) => ({ width: frame, height: Math.round((frame * 1080) / 1920), deviceScaleFactor: 1920 / frame });
const EMAIL = process.env.APP_EMAIL;
const PASSWORD = process.env.APP_PASSWORD;

// Sample data used by the shot definitions (Fromage demo tenant).
const ALLOC_ITEM_ID = 'BL-2'; // SAP S/4HANA Maintenance, Headcount (refs resolve in the URL)
const ANALYTICS_ITEM_ID = 'BL-120'; // Data Center Refresh, a CAPEX line with Cost pool, IT tower, Purpose and Priority set
const COMPANY_NAME = 'Fromage & Co SA';
const LANG = flag('lang', ''); // UI language override, e.g. fr
// Budget demo data (Fromage & Co fixture, reloaded 2026-10-13).
const STAFFING_ITEM_ID = flag('staffing-item', 'BL-91'); // Contractor · E-commerce front-end developer · BOU-100
const SAAS_ITEM_ID = 'BL-4'; // Salesforce (Sales + Service Cloud), account 612100
// Budget lines filter used by the budget articles: the two software accounts.
const SOFTWARE_ACCOUNTS = ['612100 - SaaS Subscriptions', '612200 - Software Licenses'];
// Analytics dimensions kept out of the shots (customer-specific names).
// Report filter controls to leave out of the shot, by label (local test dimensions):
// --hide "Dimension A,Dimension B".
const HIDDEN_DIMENSIONS = (flag('hide', '') || '').split(',').map((s) => s.trim()).filter(Boolean);

if (!EMAIL || !PASSWORD) {
  console.error('APP_EMAIL and APP_PASSWORD are required (never hardcode them).');
  process.exit(2);
}

const WHY_CVE = process.env.WHY_CVE || 'CVE-2026-34486'; // CVE opened by the vulnerabilities-why-this-row shot (short, clean "Why this row")
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

// Hide the controls of the given analytics dimensions (label + field), in report
// filters and in the Properties panel.
const hideControls = (page, labels) =>
  page.evaluate((labels) => {
    for (const el of document.querySelectorAll('label, p, span, div')) {
      if (el.children.length || !labels.includes(el.textContent?.replace('*', '').trim())) continue;
      let box = el;
      while (box.parentElement && !box.querySelector('.MuiFormControl-root, .MuiSelect-select')) box = box.parentElement;
      box.style.display = 'none';
    }
  }, labels);

// Open the item Properties side panel and leave out the fields of --hide
// (local test dimensions). The open state is kept in localStorage (this
// browser only), so it may already be open from an earlier shot.
const openProperties = async (page) => {
  const close = 'button[aria-label="Close properties"], button[aria-label="Fermer les propriétés"]';
  const open = 'button[aria-label="Open properties"], button[aria-label="Ouvrir les propriétés"]';
  await page.waitForSelector(`${close}, ${open}`, { timeout: 30000 });
  if (await page.$(open)) {
    await page.click(open);
    await sleep(800);
  }
  if (!HIDDEN_DIMENSIONS.length) return;
  // Each property is a label (.kanap-field-label, with a "*" when required) and
  // its field, side by side in one row: hide the row.
  // Dimension fields load after the others: wait until one of them is there.
  await page
    .waitForFunction(
      (labels) => [...document.querySelectorAll('aside .kanap-field-label')].some((el) => labels.includes(el.textContent?.replace('*', '').trim())),
      { timeout: 20000 },
      HIDDEN_DIMENSIONS,
    )
    .catch(() => {});
  await sleep(500);
  await page.evaluate((labels) => {
    for (const el of document.querySelectorAll('aside .kanap-field-label')) {
      if (labels.includes(el.textContent?.replace('*', '').trim())) el.parentElement.style.display = 'none';
    }
  }, HIDDEN_DIMENSIONS);
};

// Reports draw once their query answers: wait for a table row or a chart.
const waitForReport = (page) =>
  page
    .waitForFunction(() => document.querySelector('main table tbody tr, main .ag-row, main .ag-charts-wrapper canvas'), { timeout: 40000 })
    .catch(() => console.warn('report still empty'));

// Open a contract from the list by its name (contracts have no business reference, their address carries a UUID).
// Plaid feature page: ask Plaid a question in a fresh conversation, list of conversations folded,
// and wait for the answer to end. Each run writes a new conversation on the tenant.
const askPlaid = async (page, question, done) => {
  await page.waitForSelector('textarea', { timeout: 30000 });
  const toggle = await page.$('main button:has(svg[data-testid="MenuIcon"])');
  if (toggle && (await page.evaluate(() => /New conversation/.test(document.querySelector('main')?.innerText || '')))) {
    await toggle.click();
    await sleep(600);
  }
  await page.type('textarea', question);
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('button[aria-label="Stop generating"]'), { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('button[aria-label="Stop generating"]'), { timeout: 240000 });
  if (done) await page.waitForFunction(done, { timeout: 60000 }).catch(() => console.warn('expected answer not seen'));
  await sleep(1500);
  // Bring the question to the top of the conversation, the answer below it.
  await page.evaluate(() => {
    const you = [...document.querySelectorAll('main *')].filter((n) => !n.children.length && n.textContent?.trim() === 'You').pop();
    you?.scrollIntoView({ block: 'start' });
  });
  await sleep(600);
};

const openContract = async (page, name) => {
  await page.waitForFunction((n) => document.querySelector('main')?.innerText.includes(n), { timeout: 30000 }, name);
  const [cell] = await page.$$(`xpath/.//main//*[normalize-space(text())="${name}"]`);
  await cell.click();
  await page.waitForFunction(() => location.pathname.includes('/overview'), { timeout: 20000 });
  await page.waitForFunction(() => /Without a decision|Deadlines/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 }).catch(() => {});
  await sleep(1000);
};

const PAGES = {
  dashboard: { path: '/', waitFor: 'main', prepare: waitForWidgets },
  // Incidents feature page (October 2026), fromage fixture on the local dev tenant (INC-20 to INC-29): INC-23 carries a filled review,
  // INC-24 the personal data and authority notification, INC-22 the most links.
  'feature-incidents-register': {
    frame: 1920,
    // Category filter: leaves out test incidents filed under "Other" on the shared dev tenant.
    path: `/it/incidents?filters=${encodeURIComponent(JSON.stringify({ category: { filterType: 'set', values: ['infrastructure', 'application', 'data', 'supplier', 'security'] } }))}`,
    waitFor: 'main',
    async prepare(page) {
      await page.waitForFunction(() => document.querySelectorAll('main .ag-row, main table tbody tr').length > 3, { timeout: 30000 }).catch(() => {});
    },
  },
  'feature-incidents-review': {
    frame: 1920,
    path: '/it/incidents/INC-23/overview',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Root cause'), { timeout: 30000 }).catch(() => {});
    },
  },
  'feature-incidents-compliance': {
    frame: 1280,
    path: '/it/incidents/INC-24/relations',
    waitFor: 'main',
    async prepare(page) {
      await openProperties(page);
      await sleep(1000);
      // Scroll the Properties panel down to its compliance fields.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('aside, aside *')) {
          if (el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY !== 'visible') el.scrollTop = el.scrollHeight;
        }
      });
    },
  },
  'feature-incidents-relations': {
    frame: 1440, path: '/it/incidents/INC-22/relations', waitFor: 'main' },
  // Plaid feature page (2026-10-26): a question across contracts and applications, answered from live data.
  'feature-plaid-query': {
    frame: 1920,
    path: '/ai',
    waitFor: 'main',
    async prepare(page) {
      await askPlaid(page, 'Which contracts must be decided in the next 90 days, and which applications do they cover? Answer in one message, with a table.', () => /SAP Maintenance/.test(document.querySelector('main')?.innerText || ''));
    },
  },
  // Plaid feature page: a write prepared as a preview (nothing approved).
  'feature-plaid-preview': {
    frame: 1440,
    path: '/ai',
    waitFor: 'main',
    async prepare(page) {
      await askPlaid(page, 'Move task T-30 to in progress and add the comment: Call with SAP on 5 November to discuss the 2027 price. Show me the preview first.', () => /pending/i.test(document.querySelector('main')?.innerText || ''));
// The preview stays open in the side panel, with its fields and its pending state.
      await sleep(800);
    },
  },
  // Plaid feature page: the Claude section uses a screenshot of Claude itself (claude.ai, taken by the maintainer).
  // Plaid feature page: Admin > Plaid, provider status, included model and its processing location, monthly usage, feature switches.
  'feature-plaid-admin': { frame: 1440, path: '/admin/ai', waitFor: 'main' },
  // Contracts feature page: list with the 2026 commitment, budget and gap. Read-only.
  'feature-contracts-list': {
    frame: 1920,
    path: '/ops/contracts',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await sleep(1000);
      await (await page.$('.MuiSelect-select')).click();
      await page.waitForSelector('li[role="option"]', { timeout: 10000 });
      await sleep(400);
      await clickText(page, 'li[role="option"]', String(new Date().getFullYear()));
      await page.waitForFunction(() => /Committed \d{4}/.test(document.querySelector('main')?.innerText || ''), { timeout: 20000 }).catch(() => {});
      await sleep(1500);
    },
  },
  // Contracts feature page: SAP Maintenance & Support, deadlines and the renewal decision. Read-only.
  'feature-contracts-overview': {
    frame: 1440,
    path: '/ops/contracts',
    waitFor: 'main',
    async prepare(page) {
      await openContract(page, 'SAP Maintenance & Support');
    },
  },
  // Contracts feature page: the same contract after "Terminate" (nothing confirmed: the panel is left open as is).
  'feature-contracts-cancel': {
    frame: 1920,
    path: '/ops/contracts',
    waitFor: 'main',
    async prepare(page) {
      await openContract(page, 'SAP Maintenance & Support');
      await clickText(page, 'button', 'Terminate');
      await page.waitForFunction(() => /lose this contract|will not renew/.test(document.querySelector('main')?.innerText || ''), { timeout: 20000 }).catch(() => {});
      await sleep(1000);
    },
  },
  // Contracts feature page: Budget tab of SAP Maintenance & Support (contracts have no business reference).
  'feature-contracts-budget': {
    frame: 1920,
    path: '/ops/contracts',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('SAP Maintenance & Support'), { timeout: 30000 });
      const [cell] = await page.$$('xpath/.//main//*[normalize-space(text())="SAP Maintenance & Support"]');
      await cell.click();
      await page.waitForFunction(() => location.pathname.includes('/overview'), { timeout: 20000 });
      await page.goto(page.url().replace(/\/overview.*$/, '/budget'), { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Commitment and coverage'), { timeout: 30000 }).catch(() => {});
      // The current year: its linked lines carry amounts.
      await clickText(page, 'main button, main [role="tab"]', String(new Date().getFullYear()));
      await sleep(1500);
      // Leave out floating development widgets in the bottom right corner.
      await page.evaluate(() => {
        for (const el of document.querySelectorAll('body *')) {
          const cs = getComputedStyle(el);
          const r = el.getBoundingClientRect();
          if (cs.position === 'fixed' && r.width > 0 && r.width < 120 && r.bottom > innerHeight - 120 && r.right > innerWidth - 120) el.style.display = 'none';
        }
      });
    },
  },
  // Same dashboard, after opening a few records: "Recently viewed" is kept in
  // localStorage by each workspace page, so it is only filled within this browser
  // session. Refs (PRJ-6, T-2...) resolve in the URL; last visited shows first.
  'dashboard-rich': {
    path: '/',
    waitFor: 'main',
    visit: [
      '/it/applications/APP-8', // SAP S/4HANA
      '/portfolio/projects/PRJ-12', // Customer 360 Data Contracts
      '/portfolio/requests/REQ-3', // Cave Climate Digital Twin
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
  'allocation-default': { path: '/ops/operations/allocation-default', waitFor: 'main' },
  'budget-operations': { path: '/ops/operations', waitFor: 'main' },
  'reports-landing': { path: '/ops/reports', waitFor: 'main' },
  // Budget presentation set: one item across years and columns, costed lines, organisation, settings, reports.
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
  // Compliance article (October 2026): application classification, fromage fixture (#487).
  'compliance-tab': {
    path: '/it/applications/APP-8/compliance', // SAP S/4HANA: V1, interface to a V2 application
    waitFor: 'main',
    async prepare(page) {
      await openProperties(page);
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('planned in V'), { timeout: 30000 });
      await sleep(1000);
    },
  },
  'compliance-catalog': {
    path: '/it/settings',
    waitFor: 'main',
    async prepare(page) {
      // Opens the editor only; nothing is saved.
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'Edit catalog'), { timeout: 20000 });
      await clickText(page, 'button', 'Edit catalog');
      await page.waitForSelector('.MuiDialog-paper', { timeout: 15000 });
      await sleep(1500);
    },
  },
  'compliance-tile': { path: '/', waitFor: 'main', prepare: waitForWidgets },
  'compliance-applications': {
    path: '/it/applications',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      // Classification columns in, unrelated ones out (column choice is kept in localStorage only).
      await clickText(page, 'button', 'Choose columns');
      await page.waitForSelector('.MuiPopover-paper', { timeout: 10000 });
      for (const label of ['Environments', 'Publisher', 'Derived users (Y)', 'Created', 'Cyber criticality', 'Recovery wave', 'RTO', 'RPO', 'Data class', 'Classification review']) {
        await clickText(page, '.MuiPopover-paper label', label);
      }
      await page.keyboard.press('Escape');
      await sleep(800);
      // Two clicks: most critical first.
      for (let i = 0; i < 2; i++) {
        await page.click('.ag-header-cell[col-id="criticality"] .ag-header-cell-label').catch(() => console.warn('criticality header not found'));
        await sleep(1200);
      }
    },
  },
  // Budget feature page and budget articles, version 26.10.1 (2026-10-13): --out public/screenshots.
  // Read-only: nothing is saved, the copy runs a preview only.
  'budget-lines-grid-2026-10-13': {
    path: '/ops/budget',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await page.waitForFunction(() => /Total \(\d+ lines\)/.test(document.querySelector('.ag-floating-bottom')?.textContent || ''), { timeout: 30000 });
      await sleep(1000);
    },
  },
  'budget-allocations-2026-10-13': {
    path: `/ops/budget/${ALLOC_ITEM_ID}/allocations?year=2026`,
    waitFor: 'main',
    async prepare(page) {
      await openProperties(page);
      await page.waitForFunction(() => /100(\.00)?%/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
    },
  },
  'budget-currency-2026-10-13': {
    path: '/ops/operations/currency',
    waitFor: 'main',
    prepare: (page) => page.waitForFunction(() => /\d\.\d{6}/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 }),
  },
  'budget-top-lines-2026-10-13': {
    path: '/ops/reports/top-opex?scope=opex',
    waitFor: 'main',
    async prepare(page) {
      await waitForReport(page);
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Largest OPEX lines'), { timeout: 30000 }).catch(() => console.warn('OPEX tab not applied'));
      await pickSelect(page, 'Chart type', 'Pie chart');
      await hideControls(page, HIDDEN_DIMENSIONS);
      await sleep(1500);
    },
  },
  'budget-lines-filters-2026-10-13': {
    path: '/ops/budget',
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
      await page.waitForFunction(
        () => [...document.querySelectorAll('.ag-popup button')].some((b) => b.textContent?.trim() === 'Clear')
          && document.querySelectorAll('.ag-popup label').length > 2,
        { timeout: 20000 },
      );
      await clickText(page, '.ag-popup button', 'Clear');
      await sleep(500);
      for (const account of SOFTWARE_ACCOUNTS) await clickText(page, '.ag-popup label', account);
      await page.waitForFunction(
        () => document.querySelector('.ag-floating-filter')?.closest('.ag-header')?.textContent?.includes('2 selected'),
        { timeout: 30000 },
      ).catch(() => console.warn('account filter not applied'));
      await sleep(1500);
    },
  },
  // Budget tab opened with the list filter in the URL: the "n of N" pill counts the filtered lines.
  'budget-tab-2026-10-13': {
    path: `/ops/budget/${SAAS_ITEM_ID}/budget?year=2026&filters=${encodeURIComponent(
      JSON.stringify({ account_display: { filterType: 'set', values: SOFTWARE_ACCOUNTS } }),
    )}`,
    waitFor: 'main',
    async prepare(page) {
      await openProperties(page);
      await page.waitForFunction(() => / of \d+/.test(document.querySelector('main')?.innerText || ''), { timeout: 20000 });
      await sleep(1000);
    },
  },
  'budget-quantity-price-2026-10-13': {
    path: `/ops/budget/${STAFFING_ITEM_ID}/budget?year=2026`,
    waitFor: 'main',
    async prepare(page) {
      await openProperties(page);
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('FTE over the period'), { timeout: 30000 });
      await sleep(1000);
    },
  },
  // Preview only (never "Copy"): all lines, 2026 Expected landing -> 2027 Budget, +3 %.
  'copy-budget-columns-2026-10-13': {
    path: '/ops/operations/copy-budget',
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
      await clickText(page, 'button', 'Preview');
      await page.waitForFunction(() => /lines? in the preview/.test(document.body.innerText), { timeout: 60000 });
      await sleep(1500);
    },
  },
  'reporting-landing-2026-10-13': {
    path: '/ops/reports',
    waitFor: 'main',
    prepare: (page) => page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Cost per FTE'), { timeout: 20000 }),
  },
  // Last year's landing against this year's budget (2027 is empty on the demo tenant).
  'top-increase-2026-10-13': {
    path: '/ops/reports/opex-delta?scope=opex',
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
  'cost-per-fte-2026-10-13': {
    path: '/ops/reports/cost-per-fte?scope=opex',
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
  'chargeback-default-method-2026-10-13': {
    path: '/ops/operations/allocation-default',
    waitFor: 'main',
    prepare: (page) => page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Headcount'), { timeout: 20000 }),
  },
  'chargeback-global-2026-10-13': {
    path: '/ops/reports/chargeback/global',
    waitFor: 'main',
    prepare: (page) => page.waitForFunction(() => /Overall total\s+[\d,  ]{3,}/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 }),
  },
  'analytics-dimensions-2026-10-13': {
    path: '/master-data/analytics',
    waitFor: 'main',
    prepare: (page) => page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 30000 }),
  },
  'analytics-line-properties-2026-10-13': {
    path: `/ops/budget/${ANALYTICS_ITEM_ID}`,
    waitFor: 'main',
    async prepare(page) {
      await openProperties(page);
      await page.waitForFunction(() => document.querySelector('aside')?.innerText.includes('Cost pool'), { timeout: 30000 });
      await sleep(1000);
    },
  },
  'analytics-report-2026-10-13': {
    path: '/ops/reports/analytics?scope=opex',
    waitFor: 'main',
    async prepare(page) {
      await waitForReport(page);
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Group OPEX totals by Cost pool'), { timeout: 30000 }).catch(() => console.warn('OPEX tab not applied'));
      await sleep(1500);
    },
  },
  // Range report: 2025 to 2026 (2027 is empty on the demo tenant), drawn as lines.
  'analytics-report-range-2026-10-13': {
    path: '/ops/reports/analytics?scope=opex',
    waitFor: 'main',
    async prepare(page) {
      await waitForReport(page);
      await pickSelect(page, 'Start year', '2025');
      await pickSelect(page, 'End year', '2026');
      await sleep(1500);
    },
  },
  // OPEX/CAPEX article (2026-10-17): the S/4HANA program lines, OPEX and CAPEX together, Type and Program columns.
  // Quick filter and column choice stay in this browser only; nothing is saved server side.
  'opex-capex-list-2026-10-17': {
    path: '/ops/budget',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await clickText(page, 'button', 'Choose columns');
      await page.waitForSelector('.MuiPopover-paper', { timeout: 10000 });
      for (const label of ['Paying company', 'Contract', 'Allocation', 'Expected landing Y (2026)', 'Task', 'Program']) await clickText(page, '.MuiPopover-paper label', label);
      await page.keyboard.press('Escape');
      await sleep(800);
      await page.type('input[placeholder="Quick filter"]', 'REF-SAP-S4', { delay: 20 });
      await page.waitForFunction(() => /Total \(\d+ lines\)/.test(document.querySelector('.ag-floating-bottom')?.textContent || '') && document.querySelectorAll('.ag-center-cols-container .ag-row').length < 30, { timeout: 30000 });
      await sleep(1500);
    },
  },
  // OPEX/CAPEX article (2026-10-17): CAPEX line of the S/4HANA program, Properties panel open.
  'opex-capex-line-properties-2026-10-17': {
    path: '/ops/budget/BL-119',
    waitFor: 'main',
    async prepare(page) {
      await openProperties(page);
      await page.waitForFunction(() => /Program/.test(document.querySelector('aside')?.innerText || ''), { timeout: 30000 });
      await sleep(1500);
      await hideControls(page, HIDDEN_DIMENSIONS);
      await sleep(1000);
    },
  },
  // OPEX/CAPEX article (2026-10-17): Analytics dimensions report, CAPEX tab, Purpose, 2026.
  'opex-capex-report-purpose-2026-10-17': {
    path: '/ops/reports/analytics?scope=capex',
    waitFor: 'main',
    async prepare(page) {
      await waitForReport(page);
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Group CAPEX totals by Cost pool'), { timeout: 30000 }).catch(() => console.warn('CAPEX tab not applied'));
      await pickSelect(page, 'Dimension', 'Purpose');
      await hideControls(page, HIDDEN_DIMENSIONS);
      await page.waitForFunction(() => /Total Budget/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
      await sleep(1500);
    },
  },
  // OPEX/CAPEX article (2026-10-17): "Change type..." window open on a CAPEX line; shot taken before Cancel, nothing is saved.
  'opex-capex-change-type-2026-10-17': {
    path: '/ops/budget/BL-119',
    waitFor: 'main',
    async prepare(page) {
      await openProperties(page);
      await page.waitForFunction(() => [...document.querySelectorAll('aside button, aside a, aside [role="button"]')].some((b) => /^Change type/.test(b.textContent?.trim())), { timeout: 30000 });
      await hideControls(page, HIDDEN_DIMENSIONS);
      await (await page.$$('xpath/.//aside//*[(self::button or self::a or @role="button") and starts-with(normalize-space(.), "Change type")]'))[0].click();
      await page.waitForSelector('.MuiDialog-paper', { timeout: 15000 });
      await hideControls(page, HIDDEN_DIMENSIONS);
      await sleep(1500);
    },
  },
  // FTE article (2026-10-18): Revision 2026 of BL-83 built from three lines (local demo data), Properties closed.
  'fte-quantity-price-2026-10-18': {
    path: '/ops/budget/BL-83/budget?year=2026',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('button[aria-pressed]', { timeout: 30000 });
      const close = 'button[aria-label="Close properties"]';
      if (await page.$(close)) { await page.click(close); await sleep(800); }
      await (await page.$$('xpath/.//button[@aria-pressed and starts-with(normalize-space(.), "Revision")]'))[0].click();
      await sleep(800);
      await clickText(page, '[role="tab"]', 'Quantity and price');
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('FTE over the period'), { timeout: 30000 });
      await sleep(1000);
    },
  },
  // FTE article (2026-10-18): working-day calendars list (standards, "218 working days", "No leave").
  'fte-calendars-2026-10-18': {
    path: '/master-data/working-day-calendars',
    waitFor: 'main',
    prepare: (page) => page.waitForFunction(() => /218 working days/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 }),
  },
  // FTE article (2026-10-18): Staffing by month report, Budget 2026, grouped by supplier.
  'fte-staffing-by-month-2026-10-18': {
    path: '/ops/reports/staffing?scope=all',
    waitFor: 'main',
    async prepare(page) {
      await waitForReport(page);
      await pickSelect(page, 'Group by', 'Supplier');
      await hideControls(page, HIDDEN_DIMENSIONS);
      await sleep(1500);
    },
  },
  // FTE article (2026-10-18): Cost per FTE report, all lines, grouped by supplier, 2026 Budget and Expected landing.
  'fte-cost-per-fte-2026-10-18': {
    path: '/ops/reports/cost-per-fte?scope=all',
    waitFor: 'main',
    async prepare(page) {
      await waitForReport(page);
      await pickSelect(page, 'Group by', 'Supplier');
      await pickSelect(page, 'Columns', '2026', 1);
      await pickSelect(page, 'Columns', 'Expected landing', 4);
      await hideControls(page, HIDDEN_DIMENSIONS);
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Expected landing 2026'), { timeout: 30000 });
      await sleep(1500);
    },
  },
  // FTE article (2026-10-18): budget lines with FTE declared, Budget and Expected landing 2026 amounts and FTE side by side.
  // Quick column choice and filter stay in this browser only; nothing is saved server side.
  'fte-budget-lines-2026-10-18': {
    path: '/ops/budget',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await clickText(page, 'button', 'Choose columns');
      await page.waitForSelector('.MuiPopover-paper', { timeout: 10000 });
      for (const label of ['Paying company', 'Contract', 'Allocation', 'Account', 'Task', 'Budget FTE (2026)', 'Expected landing FTE (2026)', 'FTE declared']) await clickText(page, '.MuiPopover-paper label', label);
      await page.keyboard.press('Escape');
      await sleep(800);
      // FTE declared set filter: Yes only.
      const col = await page.$eval('.ag-header-cell[col-id="has_fte"]', (h) => h.getAttribute('aria-colindex'));
      await page.click(`.ag-floating-filter[aria-colindex="${col}"] button`);
      await page.waitForFunction(() => document.querySelectorAll('.ag-popup label').length > 1, { timeout: 20000 });
      await clickText(page, '.ag-popup button', 'Clear');
      await sleep(500);
      await clickText(page, '.ag-popup label', 'Yes');
      await page.waitForFunction(
        () => document.querySelector('.ag-floating-filter')?.closest('.ag-header')?.textContent?.includes('selected'),
        { timeout: 30000 },
      ).catch(() => console.warn('FTE declared filter not applied'));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => /Total \(\d+ lines\)/.test(document.querySelector('.ag-floating-bottom')?.textContent || ''), { timeout: 30000 });
      await sleep(1500);
    },
  },
  // Currencies article (2026-10-20): currency settings page, settings form and exchange rate table. Read-only.
  'currency-settings-2026-10-20': {
    path: '/ops/operations/currency',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForFunction(() => /\d\.\d{6}/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
      await sleep(1500);
    },
  },
  // Currencies article (2026-10-20): lines of the two subsidiaries (EUR and USD) side by side, totals in the reporting currency.
  // Paying company = both companies, quick filter --q (default "telecom"). Column choice and filters stay in this browser only;
  // run it apart from the other list shots.
  'currency-us-lines-2026-10-20': {
    path: '/ops/budget',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await clickText(page, 'button', 'Choose columns');
      await page.waitForSelector('.MuiPopover-paper', { timeout: 10000 });
      for (const label of (flag('cols-off', 'Contract,Allocation,Task,Currency') || '').split(',').filter(Boolean)) await clickText(page, '.MuiPopover-paper label', label);
      await page.keyboard.press('Escape');
      await sleep(800);
      const col = await page.$eval('.ag-header-cell[col-id="paying_company_name"]', (h) => h.getAttribute('aria-colindex'));
      await page.click(`.ag-floating-filter[aria-colindex="${col}"] button`);
      await page.waitForFunction(
        () => [...document.querySelectorAll('.ag-popup button')].some((b) => b.textContent?.trim() === 'Clear')
          && document.querySelectorAll('.ag-popup label').length > 1,
        { timeout: 20000 },
      );
      await clickText(page, '.ag-popup button', 'Clear');
      await sleep(500);
      for (const company of ['Fromage & Co SA', 'Fromage & Co Inc.']) await clickText(page, '.ag-popup label', company);
      await sleep(1500);
      await page.keyboard.press('Escape');
      await page.type('input[placeholder="Quick filter"]', flag('q', 'telecom'), { delay: 20 });
      await page.waitForFunction(() => /Total \(\d+ lines\)/.test(document.querySelector('.ag-floating-bottom')?.textContent || ''), { timeout: 30000 });
      await sleep(1500);
      await page.mouse.click(1000, 140);
      await sleep(1000);
    },
  },
  // Currencies article (2026-10-20): "Manual exchange rate" dialog opened on the USD cell of 2027, 0.89 typed, never saved.
  'currency-manual-rate-2026-10-20': {
    path: '/ops/operations/currency',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForFunction(() => /\d\.\d{6}/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
      await sleep(1000);
      // Years are the column headers; USD is a row: click the cell where they cross.
      const handle = await page.evaluateHandle(() => {
        const table = [...document.querySelectorAll('main table')].find((t) => /Latest FX rate/.test(t.closest('div')?.parentElement?.innerText || '') || t.innerText.includes('USD'));
        const ths = [...table.querySelectorAll('thead th')];
        const idx = ths.findIndex((th) => th.textContent.trim().startsWith('2027'));
        const row = [...table.querySelectorAll('tbody tr')].find((tr) => tr.children[0]?.textContent.trim() === 'USD');
        return row?.children[idx] || null;
      });
      const cell = handle.asElement();
      if (!cell) throw new Error('2027 USD cell not found');
      await cell.click();
      await page.waitForSelector('.MuiDialog-paper', { timeout: 15000 });
      await sleep(800);
      // Typed over the prefill; never saved (the shot ends with the dialog open, the browser closes after).
      const input = await page.$('.MuiDialog-paper input');
      await input.click();
      await page.keyboard.down('Control');
      await page.keyboard.press('KeyA');
      await page.keyboard.up('Control');
      await page.keyboard.type('0.89');
      await sleep(1000);
    },
  },
  // Currencies article (2026-10-20): missing-rate warning under the totals and orange mark on the line.
  // Needs a temporary OPEX line in a currency with no rate (XTS, the ISO test code), deleted after the shot. Software Licenses account only.
  'currency-missing-rate-2026-10-20': {
    path: '/ops/budget',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await clickText(page, 'button', 'Choose columns');
      await page.waitForSelector('.MuiPopover-paper', { timeout: 10000 });
      for (const label of ['Contract', 'Allocation', 'Task', 'Expected landing Y (2026)', 'Currency']) await clickText(page, '.MuiPopover-paper label', label);
      await page.keyboard.press('Escape');
      await sleep(800);
      const col = await page.$eval('.ag-header-cell[col-id="account_display"]', (h) => h.getAttribute('aria-colindex'));
      await page.click(`.ag-floating-filter[aria-colindex="${col}"] button`);
      await page.waitForFunction(
        () => [...document.querySelectorAll('.ag-popup button')].some((b) => b.textContent?.trim() === 'Clear')
          && document.querySelectorAll('.ag-popup label').length > 2,
        { timeout: 20000 },
      );
      await clickText(page, '.ag-popup button', 'Clear');
      await sleep(500);
      await clickText(page, '.ag-popup label', SOFTWARE_ACCOUNTS[1]); // 612200 - Software Licenses
      await sleep(1500);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => /Total \(\d+ lines\)/.test(document.querySelector('.ag-floating-bottom')?.textContent || ''), { timeout: 30000 });
      await page.mouse.click(1000, 140);
      await sleep(1500);
    },
  },
  // IT contracts article (2026-10-17): SAP Maintenance & Support, Overview tab (deadline sentence, terms timeline, decision panel).
  'contracts-sap-overview-2026-10-17': {
    path: '/ops/contracts/7ebe07da-0b08-4945-bcf2-fc214bddf881/overview',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForFunction(() => /Without a decision/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
      await sleep(1000);
    },
  },
  // IT contracts article (2026-10-17): contracts list, quick filter "To decide within 90 days".
  'contracts-to-decide-2026-10-17': {
    path: '/ops/contracts',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await sleep(1000);
      // Year select first (2026 carries the budget on the demo tenant), then the quick filter.
      await (await page.$('.MuiSelect-select')).click();
      await page.waitForSelector('li[role="option"]', { timeout: 10000 });
      await sleep(400);
      await clickText(page, 'li[role="option"]', '2026');
      await sleep(800);
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Committed 2026'), { timeout: 20000 }).catch(() => console.warn('Committed 2026 not shown'));
      await (await page.$$('xpath/.//button[starts-with(normalize-space(.), "To decide within 90 days")]'))[0].click();
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('4 results'), { timeout: 20000 }).catch(() => console.warn('4 results not shown'));
      await sleep(1500);
    },
  },
  // IT contracts article (2026-10-17): decision panel after "Terminate" (nothing confirmed: the panel is left open as is).
  'contracts-cancel-2026-10-17': {
    path: '/ops/contracts/7ebe07da-0b08-4945-bcf2-fc214bddf881/overview',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForFunction(() => /Without a decision/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
      await clickText(page, 'button', 'Terminate');
      await page.waitForFunction(() => /lose this contract/.test(document.querySelector('main')?.innerText || ''), { timeout: 20000 });
      await sleep(1000);
    },
  },
  // IT contracts article (2026-10-17): budget coverage of the contracts list, 2026, Budget column, no filter.
  'contracts-budget-coverage-2026-10-17': {
    path: '/ops/contracts',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await sleep(1000);
      // The year select is the first select of the page (label "Budget" is a bare text node, which pickSelect cannot reach).
      await (await page.$('.MuiSelect-select')).click();
      await page.waitForSelector('li[role="option"]', { timeout: 10000 });
      await sleep(400);
      await clickText(page, 'li[role="option"]', '2026');
      await sleep(800);
      await page.waitForFunction(() => document.querySelector('main')?.innerText.includes('Committed 2026'), { timeout: 20000 }).catch(() => console.warn('Committed 2026 not shown'));
      await sleep(1500);
    },
  },
  // Release 26.10.6 (2026-10-23): technology versions, vulnerabilities, application and server impact. Read-only.
  'release-26-10-6-technology': {
    path: '/it/technologies/TEC-18/overview', // Microsoft SQL Server: versions with end-of-support dates
    waitFor: 'main',
    async prepare(page) {
      await page.waitForFunction(() => /End of extended support/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
      await sleep(1000);
    },
  },
  'release-26-10-6-vulnerabilities': {
    path: '/it/vulnerabilities', // default view: state "To review", severity first
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await page.waitForFunction(() => /Total: [\d,]+ rows/.test(document.querySelector('.ag-floating-bottom')?.textContent || ''), { timeout: 30000 }).catch(() => {});
      await sleep(1000);
    },
  },
  'release-26-10-6-application-vulnerabilities': {
    path: '/it/applications/APP-36/operations', // CheeseTrack: severe badge and a Vulnerabilities section across Tomcat, vSphere and SQL Server
    waitFor: 'main',
    async prepare(page) {
      await page.waitForFunction(() => /Vulnerabilities\s*\d+/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
      await sleep(1000);
    },
  },
  'release-26-10-6-server-down': {
    path: '/it/assets/AST-50/relations', // PAR-SQL-01: "If this server goes down", four tables
    waitFor: 'main',
    async prepare(page) {
      await page.waitForFunction(() => /If this server goes down/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
      await sleep(1000);
    },
  },
  // Release 26.10.7 (2026-10-26): data access per person, and the hosted applications of a cluster. Read-only (nothing is saved).
  'release-26-10-7-user-data-access': {
    frame: 1280,
    path: '/admin/users?q=luca.ferrari%40formaggio-supremo.it', // Edit user > Data access: Luca Ferrari limited to Formaggio Supremo SRL, Edit
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await sleep(1000);
      await page.click('.ag-pinned-right-cols-container .ag-row button, .ag-center-cols-container .ag-row button[aria-label]');
      await sleep(500);
      await clickText(page, '[role="menuitem"]', 'Data access');
      await page.waitForFunction(() => /With this access: \d+ budget lines/.test(document.querySelector('[role="dialog"]')?.innerText || ''), { timeout: 20000 });
      await sleep(1500);
    },
  },
  'release-26-10-7-admin-data-access': {
    frame: 1280,
    path: '/admin/data-access', // four limited people (Luca Ferrari, Jan Bakker, Ines Chevalier, Nadia Lemaire)
    waitFor: 'main',
    async prepare(page) {
      await page.waitForFunction(() => /Limited people: \d+/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
      await sleep(1500);
      // Local test account of the dev tenant (limited, set up for QA): leave its row out and the counter at the four people of the demo.
      await page.evaluate(() => {
        for (const b of document.querySelectorAll('main tbody tr')) {
          if (/Claude/.test(b.innerText)) b.style.display = 'none';
        }
        for (const p of document.querySelectorAll('main p')) {
          const m = /^Limited people: (\d+)$/.exec(p.textContent.trim());
          if (m) p.textContent = `Limited people: ${Number(m[1]) - 1}`;
        }
      });
      await sleep(500);
    },
  },
  'release-26-10-7-cluster': {
    frame: 1440,
    path: '/it/assets/AST-52/operations', // PAR-SQL-CL01: members and hosted applications (CheeseTrack, Sage X3)
    waitFor: 'main',
    async prepare(page) {
      await page.waitForFunction(() => /Hosted applications/.test(document.querySelector('main')?.innerText || '') && /Sage X3/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
      await sleep(1000);
    },
  },
  // Vulnerabilities article (2026-10-24): "Why this row" in the side panel of a Tomcat CVE found by both sources. Read-only.
  'vulnerabilities-why-this-row-2026-10-24': {
    path: '/it/vulnerabilities',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await sleep(1000);
      const cell = (await page.$$(`xpath/.//div[@col-id="cve_id" and normalize-space(.)="${WHY_CVE}"]`))[0];
      if (cell) await cell.click(); else console.warn(`${WHY_CVE} not found`);
      await page.waitForFunction(() => document.body.innerText.includes('Why this row'), { timeout: 30000 });
      await sleep(1000);
      await clickText(page, 'button', 'Why this row');
      await page.waitForSelector('ul[id^="why-"]', { timeout: 10000 }).catch(() => console.warn('why list not open'));
      await sleep(1000);
    },
  },
  // Vulnerabilities article (2026-10-24): "Exploited only" shortcut on the list. Read-only.
  'vulnerabilities-exploited-only-2026-10-24': {
    path: '/it/vulnerabilities?exploited=1',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await page.waitForFunction(() => /Total: [\d,]+ rows/.test(document.querySelector('.ag-floating-bottom')?.textContent || ''), { timeout: 30000 }).catch(() => {});
      await sleep(1000);
    },
  },
  // Vulnerabilities article (2026-10-24): critical application (CheeseTrack), severe badge and Vulnerabilities section. Read-only.
  'vulnerabilities-application-2026-10-24': {
    path: '/it/applications/APP-36/operations',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForFunction(() => /Vulnerabilities\s*\d+/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 });
      await sleep(1000);
      await page.evaluate(() => {
        const h = [...document.querySelectorAll('main h1,main h2,main h3,main h4,main h5,main h6,main p,main span,main div')]
          .find((n) => !n.children.length && /^Vulnerabilities\s*\d+$/.test(n.textContent?.trim() || '')) ||
          [...document.querySelectorAll('main *')].find((n) => /^Vulnerabilities\s*\d+$/.test(n.textContent?.trim() || ''));
        h?.scrollIntoView({ block: 'center' });
      });
      await sleep(1000);
    },
  },
  // Vulnerabilities article (2026-10-24): dashboard tile "Vulnerabilities in your estate". Read-only.
  'vulnerabilities-dashboard-tile-2026-10-24': {
    path: '/',
    waitFor: 'main',
    async prepare(page) {
      await waitForWidgets(page);
      await page.waitForFunction(() => /Vulnerabilities in your estate/.test(document.body.innerText), { timeout: 30000 });
      await sleep(1000);
      await page.evaluate(() => {
        const t = [...document.querySelectorAll('*')].find((n) => !n.children.length && n.textContent?.trim() === 'Vulnerabilities in your estate');
        t?.scrollIntoView({ block: 'center' });
      });
      await sleep(1000);
    },
  },
  // Incidents article (2026-10-26): journal tab of INC-28 (critical, resolved), dated notes plus severity and status changes. Read-only.
  'incidents-journal-2026-10-26': {
    frame: 1600,
    path: '/it/incidents/INC-28/journal',
    waitFor: 'main',
    async prepare(page) {
      await waitForWidgets(page);
      await page.waitForFunction(() => /severity|Severity/.test(document.querySelector('main')?.innerText || '') && /database/i.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 }).catch(() => {});
      await sleep(1000);
      // Scroll the note composer out of the way so the dated entries (status change down to severity change) fill the frame.
      await page.evaluate(() => {
        const t = [...document.querySelectorAll('*')].find((n) => !n.children.length && n.textContent?.trim() === 'Status: In progress \u2192 Resolved');
        if (!t) return;
        let el = t.parentElement;
        while (el && el.scrollHeight <= el.clientHeight + 2) el = el.parentElement;
        if (!el) return;
        const top = t.getBoundingClientRect().top;
        const anchor = [...document.querySelectorAll('[role=tab],a,button')].find((n) => /^Journal/.test(n.textContent?.trim() || ''));
        const stop = (anchor?.getBoundingClientRect().bottom || 200) + 40;
        el.scrollBy(0, top - stop - 30);
      });
      await sleep(700);
    },
  },
  // Incidents article (2026-10-26, retaken after the relations tables were resized): relations tab of INC-28, linked assets, applications, technologies and suggestions. Read-only.
  'incidents-relations-2026-10-26': {
    frame: 1600,
    path: '/it/incidents/INC-28/relations',
    waitFor: 'main',
    async prepare(page) {
      await waitForWidgets(page);
      await page.waitForFunction(() => /QualityLab LIMS/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 }).catch(() => {});
      await sleep(1000);
    },
  },
  // Incidents article (2026-10-26): overview tab of INC-28, description and incident review. Read-only.
  'incidents-review-2026-10-26': {
    frame: 1920,
    path: '/it/incidents/INC-28/overview',
    waitFor: 'main',
    async prepare(page) {
      await waitForWidgets(page);
      await page.waitForFunction(() => /Root cause/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 }).catch(() => {});
      await sleep(1500);
    },
  },
  // Incidents article (2026-10-26): register filtered on Critical and Major, Resolved and Closed (leaves out the open test incident INC-43). Read-only; set filters separately (they persist).
  'incidents-register-2026-10-26': {
    frame: 1920,
    path: '/it/incidents?filters=%7B%22severity%22%3A%7B%22filterType%22%3A%22set%22%2C%22values%22%3A%5B%22critical%22%2C%22major%22%5D%7D%2C%22status%22%3A%7B%22filterType%22%3A%22set%22%2C%22values%22%3A%5B%22resolved%22%2C%22closed%22%5D%7D%7D',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await page.waitForFunction(() => /Total \(\d+\)/.test(document.body.innerText), { timeout: 30000 }).catch(() => {});
      await sleep(1000);
    },
  },
  // Technologies article (2026-10-29): "New technology" dialog open on the catalog, with a search typed. Read-only: nothing is created.
  'technologies-catalog-2026-10-29': {
    frame: 1280,
    path: '/it/technologies',
    waitFor: 'main',
    async prepare(page) {
      await page.waitForSelector('.ag-center-cols-container .ag-row', { timeout: 60000 });
      await sleep(1000);
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('button')].find((n) => /New technology/.test(n.textContent || ''));
        b?.click();
      });
      await page.waitForSelector('input[aria-label="Search the catalog"], [role=dialog] input', { timeout: 15000 });
      await sleep(800);
      const input = await page.$('input[aria-label="Search the catalog"]') || await page.$('[role=dialog] input');
      await input.type(process.env.CATALOG_QUERY || 'postgres', { delay: 60 });
      await sleep(2500);
    },
  },
  // Technologies article (2026-10-29): overview tab with the versions table. Read-only.
  'technologies-versions-2026-10-29': {
    frame: 1920,
    path: '/it/technologies/TEC-5/overview',
    waitFor: 'main',
    async prepare(page) {
      await waitForWidgets(page);
      await page.waitForFunction(() => /22\.04/.test(document.querySelector('main')?.innerText || ''), { timeout: 30000 }).catch(() => {});
      await sleep(1000);
    },
  },
  // Technologies article (2026-10-29): applications tab, hosted and declared rows. Read-only.
  'technologies-applications-2026-10-29': {
    frame: 1600,
    path: '/it/technologies/TEC-3/applications',
    waitFor: 'main',
    async prepare(page) {
      await waitForWidgets(page);
      await sleep(1500);
    },
  },
  // Technologies article (2026-10-29): relations tab of TEC-21 VMware vSphere, contract (Broadcom VMware ELA) and linked budget line BL-12. Read-only.
  'technologies-relations-vsphere-2026-10-29': {
    frame: 1280,
    path: '/it/technologies/TEC-21/relations',
    waitFor: 'main',
    async prepare(page) {
      await waitForWidgets(page);
      await sleep(1500);
    },
  },
};
PAGES['chargeback-company-2026-10-13'] = PAGES['chargeback-company'];

// Flags that take a value, so their value is not read as a shot name.
const VALUE_FLAGS = ['base', 'out', 'theme', 'width', 'height', 'scale', 'lang', 'staffing-item', 'hide', 'cols-off', 'frame', 'frames'];
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
    // --frames shoots every candidate frame (name@1600.png...) to pick the most
    // readable one; otherwise the shot's own frame, else the run's viewport.
    const frames = FRAMES.length ? FRAMES : [FRAME || def.frame || 0];
    for (const frame of frames) {
      await page.setViewport(frame ? frameViewport(frame) : { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE });
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
      const out = `${OUT_DIR}/${name}${FRAMES.length ? `@${frame}` : ''}.png`;
      await page.screenshot({ path: out, fullPage: has('full') });
      console.log(out);
    }
  }
} finally {
  await browser.close();
}
