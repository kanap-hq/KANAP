#!/usr/bin/env node
// Loads the perf dataset (scripts/perf/generate-dataset.mjs) into a KANAP
// tenant through the public API and the real CSV import endpoints, and times
// every step. Same sequence as backend/fixtures/fromage-co/setup-tenant.mjs, without
// the AI agent, the knowledge library and the IT landscape.
//
//   node scripts/perf/load-tenant.mjs --base-url http://127.0.0.1:18080 \
//     --email <admin> --password <pw> --data <dataset dir> --results <dir>
//
// The tenant must exist and the admin must be able to log in. In
// single-tenant mode (DEPLOYMENT_MODE=single-tenant) the API creates both at
// boot from DEFAULT_TENANT_SLUG / ADMIN_EMAIL / ADMIN_PASSWORD.
//
// A file above the import size limit is first sent whole, the refusal is
// recorded, then the file is sent again in chunks under --chunk-bytes.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createClient, pool, parseCsv } from './lib/http.mjs';
import { buildLinesFile, buildMonthlyFile, fetchDefaultDimensionCode, loadBudgetFile } from '../../backend/scripts/lib/budget-file.mjs';

const opts = {
  baseUrl: 'http://127.0.0.1:18080',
  email: '',
  password: '',
  data: '',
  results: '',
  userPassword: 'PerfUser2026!',
  chunkBytes: 900 * 1024,
  concurrency: 4,
  only: '',
};
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const key = argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (!(key in opts)) throw new Error(`Unknown argument: ${argv[i]}`);
  const raw = argv[++i];
  opts[key] = typeof opts[key] === 'number' ? Number(raw) : raw;
}
if (!opts.email || !opts.password || !opts.data) throw new Error('--email, --password and --data are required');
opts.results ||= path.join(opts.data, '..', 'results');
mkdirSync(opts.results, { recursive: true });

const client = createClient({ baseUrl: opts.baseUrl, maxSockets: Math.max(6, opts.concurrency), timeoutMs: 0 });
let token = '';
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);
const steps = [];
const findings = [];
const file = (name) => path.join(opts.data, name);
const readCsv = (name) => parseCsv(readFileSync(file(name), 'utf8'));
const lower = (v) => String(v ?? '').trim().toLowerCase();
const listItems = (payload) => (Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : []);

async function api(method, route, body) {
  const res = await client.request(method, route, { json: body, token });
  if (res.status < 200 || res.status >= 300) {
    const err = new Error(`${method} ${route} → ${res.status || res.error} ${JSON.stringify(res.data)?.slice(0, 500)}`);
    err.res = res;
    throw err;
  }
  return res.data;
}

async function step(name, fn) {
  const t0 = Date.now();
  log(`▶ ${name}`);
  try {
    const detail = await fn();
    const ms = Date.now() - t0;
    steps.push({ name, ms, ok: true, ...(detail && typeof detail === 'object' ? { detail } : {}) });
    log(`✔ ${name} (${(ms / 1000).toFixed(1)} s)`);
    return detail;
  } catch (error) {
    const ms = Date.now() - t0;
    steps.push({ name, ms, ok: false, error: error.message.slice(0, 2000) });
    log(`✖ ${name} (${(ms / 1000).toFixed(1)} s): ${error.message.slice(0, 400)}`);
    throw error;
  } finally {
    save();
  }
}

function save() {
  writeFileSync(path.join(opts.results, `load-tenant${opts.only ? '-' + opts.only.replace(/,/g, '+') : ''}.json`), JSON.stringify({ baseUrl: opts.baseUrl, steps, findings }, null, 2));
}

async function getAllPages(route, limit = 1000) {
  const all = [];
  for (let page = 1; ; page += 1) {
    const sep = route.includes('?') ? '&' : '?';
    const chunk = listItems(await api('GET', `${route}${sep}limit=${limit}&page=${page}`));
    all.push(...chunk);
    if (chunk.length < limit) return all;
  }
}

function splitCsv(text, maxBytes) {
  const lines = text.replace(/\n$/, '').split('\n');
  const header = lines[0];
  const chunks = [];
  let current = [];
  let size = Buffer.byteLength(header) + 1;
  for (const line of lines.slice(1)) {
    const len = Buffer.byteLength(line) + 1;
    if (current.length && size + len > maxBytes) {
      chunks.push([header, ...current].join('\n') + '\n');
      current = [];
      size = Buffer.byteLength(header) + 1;
    }
    current.push(line);
    size += len;
  }
  if (current.length) chunks.push([header, ...current].join('\n') + '\n');
  return chunks;
}

/** One import call, timed. A refusal of the whole file is a finding; the file is then sent in chunks. */
async function importCsvText(label, route, text) {
  const bytes = Buffer.from(text, 'utf8');
  const rows = text.split('\n').filter(Boolean).length - 1;
  const send = (b, name) => client.request('POST', route, { form: { filename: name, bytes: b }, token });
  const whole = await send(bytes, `${label}.csv`);
  const summary = (r) => ({ status: r.status, ms: Math.round(r.ms), ok: r.data?.ok, total: r.data?.total, inserted: r.data?.inserted, updated: r.data?.updated, unchanged: r.data?.unchanged, errorCount: Array.isArray(r.data?.errors) ? r.data.errors.length : undefined, firstErrors: Array.isArray(r.data?.errors) ? r.data.errors.slice(0, 5) : undefined, message: r.data?.message ?? r.error });
  const wholeSummary = { bytes: bytes.length, rows, ...summary(whole) };
  if (whole.status >= 200 && whole.status < 300 && whole.data?.ok !== false) {
    return { mode: 'whole', ...wholeSummary, rowsPerSecond: Math.round(rows / (whole.ms / 1000)) };
  }
  findings.push({ step: label, kind: 'whole-file import refused', ...wholeSummary });
  log(`  whole file refused (${whole.status}, ${bytes.length} bytes, ${rows} rows): ${JSON.stringify(wholeSummary.message ?? wholeSummary.firstErrors)?.slice(0, 300)}`);
  if (whole.status >= 200 && whole.status < 300) {
    // The data itself was refused: chunks would not help.
    throw new Error(`${label}: import returned ok=false: ${JSON.stringify(wholeSummary.firstErrors)}`);
  }
  const chunks = splitCsv(text, opts.chunkBytes);
  const results = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const b = Buffer.from(chunks[i], 'utf8');
    const r = await send(b, `${label}-${i + 1}.csv`);
    const s = { chunk: i + 1, bytes: b.length, rows: chunks[i].split('\n').filter(Boolean).length - 1, ...summary(r) };
    results.push(s);
    log(`  chunk ${i + 1}/${chunks.length}: ${s.rows} rows, ${s.status}, ${(r.ms / 1000).toFixed(1)} s`);
    if (r.status < 200 || r.status >= 300 || r.data?.ok === false) throw new Error(`${label} chunk ${i + 1} failed: ${JSON.stringify(s).slice(0, 800)}`);
  }
  const totalMs = results.reduce((a, r) => a + r.ms, 0);
  return { mode: 'chunked', whole: wholeSummary, chunks: results, totalMs, rows, rowsPerSecond: Math.round(rows / (totalMs / 1000)) };
}

const importFile = (name, route) => step(`import ${name}`, () => importCsvText(name.replace(/\.csv$/, ''), `${route}${route.includes('?') ? '&' : '?'}dryRun=false`, readFileSync(file(name), 'utf8')));

// ── Budget file (lines, then monthly rows) ──────────────────────────────────
//
// The item files and the monthly rows keep their old shape: the shared helper
// (backend/scripts/lib/budget-file.mjs) converts them and runs the two-step budget file
// route (preflight, then import). One file per scope each time, no chunking:
// the route's cap is 48 MB and the perf dataset fits in one file per scope.

/** Y: the calendar year the source files' relative `y_*` columns are read against. */
const BUDGET_YEAR = new Date().getFullYear();
const BUDGET_ITEM_FILES = { opex: '14-spend-items.csv', capex: '15-capex-items.csv' };

/** The perf client, reduced to what the budget file helper needs. */
async function budgetRequest(method, route, { bytes, filename, snapshot } = {}) {
  const options = { token };
  if (bytes !== undefined) {
    options.form = { filename, bytes, ...(snapshot === undefined ? {} : { fields: { snapshot: JSON.stringify(snapshot) } }) };
  }
  const res = await client.request(method, route, options);
  return { status: res.status, data: res.data };
}

/** Line name -> item_number, for the lines that already exist in the tenant. */
const numbersByName = (index, scope) => new Map(
  [...index[scope].values()].map((item) => [scope === 'opex' ? item.product_name : item.description, String(item.item_number)]),
);

const withRate = (result, csvText) => ({
  ...result,
  bytes: Buffer.byteLength(csvText),
  rowsPerSecond: Math.round(result.rows / ((result.preflightMs + result.importMs) / 1000)),
});

/** One item file, converted to a lines file and loaded through the two routes. */
async function budgetLines(scope, existing, defaultDimensionCode) {
  const name = BUDGET_ITEM_FILES[scope];
  const source = readCsv(name);
  const disabled = source.filter((row) => lower(row.status) === 'disabled' && !row.disabled_at).length;
  if (disabled) findings.push({ step: `${name} (budget file)`, kind: 'disabled rows without a date', count: disabled });
  const csvText = buildLinesFile(scope, source, { year: BUDGET_YEAR, defaultDimensionCode, existingNumbers: numbersByName(existing, scope) });
  const result = await loadBudgetFile({ request: budgetRequest, scope, csvText, filename: name });
  return withRate(result, csvText);
}

/** File 29, one budget file per scope, after the lines exist. */
async function budgetRowsFile(index) {
  const rows = readCsv('29-budget-rows.csv');
  const partial = rows.filter((row) => !/^\d{4}-01-01$/.test(row.period_start) || !/^\d{4}-12-31$/.test(row.period_end)).length;
  if (partial) findings.push({ step: 'budget rows', kind: 'rows with a partial period', count: partial });
  const out = {};
  for (const scope of ['opex', 'capex']) {
    const scopeRows = rows.filter((row) => row.item_type === scope);
    const missing = scopeRows.filter((row) => !index[scope].has(row.item_name)).length;
    if (missing) findings.push({ step: `budget rows ${scope}`, kind: 'rows without item', count: missing });
    const csvText = buildMonthlyFile(scope, scopeRows, { numbersByName: numbersByName(index, scope) });
    const result = await loadBudgetFile({ request: budgetRequest, scope, csvText, filename: `29-budget-rows-${scope}.csv` });
    out[scope] = withRate(result, csvText);
  }
  return { rows: rows.length, partial, ...out };
}

// ── Steps ───────────────────────────────────────────────────────────────────

async function login() {
  const res = await client.request('POST', '/auth/login', { json: { email: opts.email, password: opts.password } });
  if (res.status !== 201 && res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.data)}`);
  token = res.data.access_token;
  return { status: res.status, ms: Math.round(res.ms) };
}

async function settings() {
  await api('PATCH', '/currency/settings', { reportingCurrency: 'EUR', defaultSpendCurrency: 'EUR', defaultCapexCurrency: 'EUR', allowedCurrencies: ['EUR', 'USD', 'GBP'] });
  const ensure = async (route, entries, extra = () => ({})) => {
    const existing = listItems(await api('GET', route));
    for (const entry of entries) {
      if (existing.some((item) => lower(item.name) === lower(entry.name))) continue;
      await api('POST', route, { ...entry, ...(await extra(entry)) });
    }
  };
  await ensure('/portfolio/classification/sources', [{ name: 'Plan stratégique', description: 'Perf' }]);
  await ensure('/portfolio/classification/categories', [{ name: 'Applications métier', description: 'Perf' }]);
  const categories = listItems(await api('GET', '/portfolio/classification/categories'));
  const categoryId = categories.find((c) => c.name === 'Applications métier')?.id;
  await ensure('/portfolio/classification/streams', [{ name: 'Socle SI', description: 'Perf' }], () => ({ category_id: categoryId }));

  const analytics = JSON.parse(readFileSync(file('analytics.json'), 'utf8'));
  const existingCats = listItems(await api('GET', '/analytics-categories?limit=1000'));
  for (const name of analytics.categories) {
    if (!existingCats.some((c) => lower(c.name) === lower(name))) await api('POST', '/analytics-categories', { name, description: 'Perf' });
  }
  const existingAxes = listItems(await api('GET', '/analytics-axes'));
  for (const axis of analytics.axes) {
    if (!existingAxes.some((a) => lower(a.code) === axis.code)) await api('POST', '/analytics-axes', { ...axis, description: 'Perf' });
  }
  return { categories: analytics.categories.length, axes: analytics.axes.length };
}

async function chartOfAccounts() {
  const coas = listItems(await api('GET', '/chart-of-accounts?limit=500'));
  let coa = coas.find((c) => c.code === 'PERF-GROUP');
  if (!coa) {
    await api('POST', '/chart-of-accounts', { code: 'PERF-GROUP', name: 'Plan de comptes perf', scope: 'GLOBAL' });
    coa = listItems(await api('GET', '/chart-of-accounts?limit=500')).find((c) => c.code === 'PERF-GROUP');
  }
  const result = await importCsvText('02-accounts', `/chart-of-accounts/${coa.id}/accounts/import?dryRun=false`, readFileSync(file('02-accounts.csv'), 'utf8'));
  const companies = listItems(await api('GET', '/companies?limit=500'));
  const wanted = new Set(readCsv('01-companies-2025.csv').map((r) => r.name));
  for (const company of companies) {
    if (wanted.has(company.name) && company.coa_id !== coa.id) await api('PATCH', `/companies/${company.id}`, { coa_id: coa.id });
  }
  return { coaId: coa.id, accounts: result };
}

async function usersStep() {
  const existing = new Set(listItems(await api('GET', '/users?limit=1000')).map((u) => lower(u.email)));
  const companies = listItems(await api('GET', '/companies?limit=500'));
  const departments = listItems(await api('GET', '/departments?limit=1000'));
  const rows = readCsv('10-users.csv').filter((r) => !existing.has(lower(r.email)));
  const timings = await pool(rows, opts.concurrency, async (row) => {
    const companyId = companies.find((c) => c.name === row.company_name)?.id ?? null;
    const departmentId = departments.find((d) => d.name === row.department_name && d.company_id === companyId)?.id ?? null;
    const res = await client.request('POST', '/users', { token, json: { email: row.email, first_name: row.first_name, last_name: row.last_name, role_name: row.role, company_id: companyId, department_id: departmentId, status: 'enabled', password: opts.userPassword } });
    if (res.status >= 300) throw new Error(`POST /users ${row.email} → ${res.status} ${JSON.stringify(res.data)}`);
    return res.ms;
  });
  return { created: rows.length, avgMs: Math.round(timings.reduce((a, b) => a + b, 0) / Math.max(1, timings.length)) };
}

async function collectItems() {
  // Page on a unique key: the default order (created_at) ties for every row of one import,
  // and LIMIT/OFFSET over ties returns some rows twice and skips others (seen: 4,288 of 5,000).
  const opex = await getAllPages('/spend-items?status=enabled&sort=item_number:ASC');
  opex.push(...await getAllPages('/spend-items?status=disabled&sort=item_number:ASC'));
  const capex = await getAllPages('/capex-items?status=enabled&sort=item_number:ASC');
  capex.push(...await getAllPages('/capex-items?status=disabled&sort=item_number:ASC'));
  return { opex: new Map(opex.map((i) => [i.product_name, i])), capex: new Map(capex.map((i) => [i.description, i])) };
}

async function itemIndex() {
  const index = await collectItems();
  const expected = {
    opex: new Set(readCsv('14-spend-items.csv').map((r) => r.product_name)).size,
    capex: new Set(readCsv('15-capex-items.csv').map((r) => r.description)).size,
  };
  if (index.opex.size < expected.opex || index.capex.size < expected.capex) {
    throw new Error(`item index incomplete: opex ${index.opex.size}/${expected.opex}, capex ${index.capex.size}/${expected.capex}`);
  }
  return index;
}

const versionCache = new Map();
async function versionsOf(kind, item) {
  const key = `${kind}:${item.id}`;
  if (!versionCache.has(key)) {
    const base = kind === 'opex' ? '/spend-items' : '/capex-items';
    versionCache.set(key, listItems(await api('GET', `${base}/${item.id}/versions`)));
  }
  return versionCache.get(key);
}
async function versionFor(kind, item, year) {
  const list = await versionsOf(kind, item);
  let version = list.find((v) => Number(v.budget_year) === Number(year));
  if (!version) {
    const base = kind === 'opex' ? '/spend-items' : '/capex-items';
    version = await api('POST', `${base}/${item.id}/versions`, { budget_year: Number(year) });
    list.push(version);
  }
  return version;
}

async function costedLines(index) {
  const calendars = listItems(await api('GET', '/working-day-profiles?limit=1000'));
  const calendarId = (code) => calendars.find((c) => lower(c.code) === lower(code))?.id ?? null;
  const groups = new Map();
  for (const row of readCsv('30-costed-lines.csv')) {
    const key = `${row.item_type}|${row.item_name}|${row.year}|${row.measure}`;
    if (!groups.has(key)) groups.set(key, { ...row, lines: [] });
    groups.get(key).lines.push(row);
  }
  const ms = await pool([...groups.values()], opts.concurrency, async (group) => {
    const item = index[group.item_type].get(group.item_name);
    if (!item) return null;
    const version = await versionFor(group.item_type, item, group.year);
    const base = group.item_type === 'opex' ? '/spend-versions' : '/capex-versions';
    const lines = group.lines.map((l) => ({
      label: l.label, quantity_unit: l.quantity_unit, quantity: l.quantity, unit_price: l.unit_price, price_basis: l.price_basis,
      frequency: l.frequency, days_per_month: l.days_per_month || null, period_start: l.period_start, period_end: l.period_end,
      working_day_profile_id: l.calendar_code ? calendarId(l.calendar_code) : null,
    }));
    const res = await client.request('POST', `${base}/${version.id}/amounts/bulk-upsert`, { token, json: { kind: 'lines', year: Number(group.year), measure: group.measure, lines } });
    if (res.status >= 300) throw new Error(`costed lines ${group.item_name} → ${res.status} ${JSON.stringify(res.data).slice(0, 300)}`);
    return res.ms;
  });
  const done = ms.filter((v) => v != null).sort((a, b) => a - b);
  return { columns: done.length, avgMs: Math.round(done.reduce((a, b) => a + b, 0) / Math.max(1, done.length)), p95Ms: Math.round(done[Math.floor(done.length * 0.95)] ?? 0) };
}

async function allocationsStep(index) {
  const companies = listItems(await api('GET', '/companies?limit=500'));
  const companyId = (name) => companies.find((c) => c.name === name)?.id;
  const rows = readCsv('31-allocations.csv');
  const ms = await pool(rows, opts.concurrency, async (row) => {
    const item = index[row.item_type].get(row.item_name);
    if (!item) return null;
    const version = await versionFor(row.item_type, item, row.year);
    const itemBase = row.item_type === 'opex' ? '/spend-items' : '/capex-items';
    const versionBase = row.item_type === 'opex' ? '/spend-versions' : '/capex-versions';
    const t0 = Date.now();
    await api('PATCH', `${itemBase}/${item.id}/versions`, { id: version.id, allocation_method: row.method, allocation_driver: 'headcount' });
    const names = row.companies.split('|');
    const pcts = row.pcts ? row.pcts.split('|').map(Number) : [];
    const items = names.map((name, i) => ({ company_id: companyId(name), department_id: null, ...(row.method === 'manual_pct' ? { allocation_pct: pcts[i] } : {}) }));
    await api('POST', `${versionBase}/${version.id}/allocations/bulk-upsert`, { items });
    return Date.now() - t0;
  });
  const done = ms.filter((v) => v != null);
  return { versions: done.length, avgMsPerVersion: Math.round(done.reduce((a, b) => a + b, 0) / Math.max(1, done.length)) };
}

async function contractLinks(index) {
  const contracts = await getAllPages('/contracts');
  const byName = new Map(contracts.map((c) => [c.name, c]));
  const groups = new Map();
  for (const row of readCsv('32-contract-links.csv')) {
    const item = index.opex.get(row.item_name);
    if (!item) continue;
    if (!groups.has(row.contract_name)) groups.set(row.contract_name, new Set());
    groups.get(row.contract_name).add(item.id);
  }
  await pool([...groups.entries()], opts.concurrency, async ([name, ids]) => {
    const contract = byName.get(name);
    if (!contract) throw new Error(`contract '${name}' not found`);
    await api('POST', `/contracts/${contract.id}/spend-items/bulk-replace`, { spend_item_ids: [...ids] });
  });
  return { contracts: groups.size };
}

async function projectLinks(index) {
  const projects = await getAllPages('/portfolio/projects');
  const byName = new Map(projects.map((p) => [p.name, p]));
  const groups = new Map();
  for (const row of readCsv('33-project-links.csv')) {
    const item = index.opex.get(row.item_name);
    if (!item) continue;
    if (!groups.has(row.project_name)) groups.set(row.project_name, new Set());
    groups.get(row.project_name).add(item.id);
  }
  // The project list hides finished projects: those are skipped (counted).
  let skipped = 0;
  await pool([...groups.entries()], opts.concurrency, async ([name, ids]) => {
    const project = byName.get(name);
    if (!project) { skipped += 1; return; }
    await api('POST', `/portfolio/projects/${project.id ?? project.project_id}/opex/bulk-replace`, { opex_ids: [...ids] });
  });
  return { projects: groups.size - skipped, skippedNotListed: skipped };
}

async function main() {
  const only = opts.only ? new Set(opts.only.split(',')) : null;
  const want = (key) => !only || only.has(key);
  const t0 = Date.now();
  await step('login', login);
  if (want('settings')) await step('settings, classification, analytics', settings);
  if (want('master')) {
    await importFile('01-companies-2025.csv', '/companies/import?year=2025');
    await importFile('01-companies-2027.csv', '/companies/import?year=2027');
    await step('chart of accounts + 02-accounts.csv', chartOfAccounts);
    await importFile('07-suppliers.csv', '/suppliers/import');
    await importFile('08-departments.csv', '/departments/import');
    await step('users (POST /users)', usersStep);
    await importFile('26-cost-centers.csv', '/cost-centers/import');
    await importFile('27-analytics-values.csv', '/analytics-categories/import');
    await importFile('28-working-day-calendars.csv', '/working-day-profiles/import');
    await importFile('13-contracts.csv', '/contracts/import');
  }
  let index = null;
  const getIndex = async () => (index ??= await step('item index (list pages)', async () => {
    const i = await itemIndex();
    index = i;
    return { opex: i.opex.size, capex: i.capex.size };
  }).then(() => index));
  if (want('items')) {
    const existing = await step('existing line numbers (list pages)', async () => {
      index = await collectItems();
      return { opex: index.opex.size, capex: index.capex.size };
    }).then(() => index);
    const defaultDimensionCode = await step('default analytics dimension (analytics-axes)', () => fetchDefaultDimensionCode(budgetRequest));
    for (const scope of ['opex', 'capex']) {
      await step(`import ${BUDGET_ITEM_FILES[scope]} (budget file)`, () => budgetLines(scope, existing, defaultDimensionCode));
    }
    // The lines changed: the index the budget rows resolve names against is read again.
    index = null;
  }
  if (want('budget')) await step('import 29-budget-rows.csv (budget file)', async () => budgetRowsFile(await getIndex()));
  if (want('costed')) await step('costed lines (bulk-upsert per column)', async () => costedLines(await getIndex()));
  if (want('allocations')) await step('manual allocations (PATCH + bulk-upsert per version)', async () => allocationsStep(await getIndex()));
  if (want('links')) await step('contract ↔ OPEX links', async () => contractLinks(await getIndex()));
  if (want('projects')) await importFile('16-portfolio-projects.csv', '/portfolio/projects/import');
  if (want('projectlinks')) await step('project ↔ OPEX links', async () => projectLinks(await getIndex()));
  if (want('tasks')) await importFile('19-tasks.csv', '/tasks/import');
  if (want('fx')) {
    // FX rates for the five budget years (World Bank / open.er-api.com, public data), so that
    // USD and GBP lines convert in every year. The refresh runs in the background on the API.
    await step('FX rates refresh (5 years)', async () => {
      const manifest = JSON.parse(readFileSync(file('manifest.json'), 'utf8'));
      return api('POST', '/currency/rates/refresh', { years: manifest.years });
    });
  }
  steps.push({ name: 'total', ms: Date.now() - t0, ok: true });
  save();
  log(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s; results in ${path.join(opts.results, `load-tenant${opts.only ? '-' + opts.only.replace(/,/g, '+') : ''}.json`)}`);
  client.close();
}

main().catch((error) => {
  console.error(error.message);
  save();
  client.close();
  process.exitCode = 1;
});
