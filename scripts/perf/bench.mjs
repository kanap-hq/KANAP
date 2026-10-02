#!/usr/bin/env node
// KANAP load benchmark (step 0.2 of the perf plan). No dependencies.
//
// Replays the request patterns of the OPEX list and the OPEX workspace as the
// browser sends them (parallel requests in parallel, waterfalls in sequence,
// at most 6 connections per virtual user like HTTP/1.1 in a browser).
// The patterns come from the frontend code; see scripts/perf/README.md.
//
//   node scripts/perf/bench.mjs single --config <cfg.json> --out <file.json>
//   node scripts/perf/bench.mjs load   --config <cfg.json> --vus 10 --duration 240 --out <file.json>
//
// cfg.json: { "baseUrl": "...", "admin": {"email","password"}, "members": [{"email","password"}, ...],
//             "pg": { "host", "port", "user", "password", "database", "appName" }, "container": "kanap-perf-api" }

import { readFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { createClient, percentile } from './lib/http.mjs';

const args = { mode: process.argv[2], config: '', out: '', vus: 1, duration: 240, ramp: 30, thinkMin: 2, thinkMax: 5, seed: 7, year: new Date().getFullYear(), timeout: 60, abortErrorRate: 0.2, repeat: 10 };
for (let i = 3; i < process.argv.length; i += 1) {
  const key = process.argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (!(key in args)) throw new Error(`Unknown argument: ${process.argv[i]}`);
  const raw = process.argv[++i];
  args[key] = typeof args[key] === 'number' ? Number(raw) : raw;
}
if (!['single', 'load'].includes(args.mode) || !args.config || !args.out) {
  console.error('usage: bench.mjs single|load --config cfg.json --out result.json [--vus N --duration S]');
  process.exit(2);
}
const cfg = JSON.parse(readFileSync(args.config, 'utf8'));
const Y = args.year;
const YEARS = [Y - 1, Y, Y + 1, Y + 2].join(',');
const DEFAULT_SORT = 'yBudget:DESC';
const log = (m) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${m}`);

// ── Seeded random per virtual user ─────────────────────────────────────────
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const qs = (params) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};

// ── Recording ──────────────────────────────────────────────────────────────
const records = []; // { t, vu, scenario, name, status, ms, bytes, error }
const scenarios = []; // { t, vu, scenario, ms, ok, requests }
const t0 = Date.now();

class VirtualUser {
  constructor(id, user, rand) {
    this.id = id;
    this.user = user;
    this.rand = rand;
    this.client = createClient({ baseUrl: cfg.baseUrl, maxSockets: 6, timeoutMs: args.timeout * 1000 });
    this.token = '';
    this.scenario = '';
    this.scenarioRequests = 0;
    this.scenarioErrors = 0;
    this.list = { sort: DEFAULT_SORT, q: '', filters: {}, status: 'enabled' };
    this.ids = null; // { ids, itemNumbers } of the current list state
    this.itemRef = null;
    this.item = null;
    this.cache = new Map();
  }

  pick(list) { return list[Math.floor(this.rand() * list.length)]; }

  async req(name, method, route, options = {}) {
    const res = await this.client.request(method, route, { ...options, token: this.token });
    this.scenarioRequests += 1;
    // A budget member may not read users or the currency settings: the list page, the share
    // dialog and the owner pickers get a 403 that the page tolerates. Recorded and reported
    // apart ("forbidden"), not counted as errors.
    const expected = res.status === 403;
    const failed = !expected && (res.status === 0 || res.status >= 400);
    if (failed) this.scenarioErrors += 1;
    records.push({ t: Date.now() - t0, vu: this.id, scenario: this.scenario, name, status: res.status, ms: Math.round(res.ms * 10) / 10, bytes: res.bytes, ...(expected ? { expected: true } : {}), ...(res.retriedReset ? { retriedReset: true } : {}), ...(res.error ? { error: res.error } : {}) });
    return res;
  }
  get(name, route) { return this.req(name, 'GET', route); }

  async login() {
    this.scenario = 'login';
    const res = await this.client.request('POST', '/auth/login', { json: { email: this.user.email, password: this.user.password } });
    records.push({ t: Date.now() - t0, vu: this.id, scenario: 'login', name: 'POST /auth/login', status: res.status, ms: Math.round(res.ms), bytes: res.bytes, ...(res.error ? { error: res.error } : {}) });
    if (res.status !== 201 && res.status !== 200) throw new Error(`login ${this.user.email}: ${res.status} ${res.error ?? ''}`);
    this.token = res.data.access_token;
  }

  async run(name, fn) {
    this.scenario = name;
    this.scenarioRequests = 0;
    this.scenarioErrors = 0;
    const start = process.hrtime.bigint();
    let ok = true;
    try {
      await fn();
    } catch (error) {
      ok = false;
      records.push({ t: Date.now() - t0, vu: this.id, scenario: name, name: 'scenario-exception', status: 0, ms: 0, bytes: 0, error: String(error.message).slice(0, 200) });
    }
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    scenarios.push({ t: Date.now() - t0, vu: this.id, scenario: name, ms: Math.round(ms), ok: ok && this.scenarioErrors === 0, requests: this.scenarioRequests });
  }

  // ── List: request builders (OpexListPage.tsx + ServerDataGrid.tsx) ───────
  filtersParam() { return Object.keys(this.list.filters).length ? JSON.stringify(this.list.filters) : undefined; }
  summaryName() {
    const sqlSort = !/^y/.test(this.list.sort) && !this.list.q && Object.keys(this.list.filters).every((k) => ['product_name', 'description', 'currency', 'notes', 'status', 'run_build'].includes(k));
    return `GET /spend-items/summary [${sqlSort ? 'sql path' : 'memory path'}]`;
  }
  page(n) {
    return this.get(this.summaryName(), `/spend-items/summary${qs({ page: n, limit: 50, sort: this.list.sort, years: YEARS, filters: this.filtersParam(), status: this.list.status, q: this.list.q })}`);
  }
  totals() {
    return this.get('GET /spend-items/summary/totals', `/spend-items/summary/totals${qs({ q: this.list.q, filters: this.filtersParam(), status: this.list.status })}`);
  }
  filterValues(field) {
    const filters = { ...this.list.filters };
    delete filters[field];
    return this.get(`GET /spend-items/summary/filter-values [${field}]`, `/spend-items/summary/filter-values${qs({ fields: field, years: YEARS, q: this.list.q, filters: Object.keys(filters).length ? JSON.stringify(filters) : undefined, status: this.list.status })}`);
  }
  summaryIds() {
    return this.get('GET /spend-items/summary/ids', `/spend-items/summary/ids${qs({ sort: this.list.sort, q: this.list.q, filters: this.filtersParam(), status: this.list.status })}`);
  }

  // Grid block load + footer totals after a filter change: the filter change purges the
  // block cache and the grid reloads the first block (twice in AG Grid 32, plan §3.1),
  // blocks are sequential (maxConcurrentDatasourceRequests = 1), totals run alongside.
  async reloadAfterFilter() {
    await Promise.all([(async () => { await this.page(1); await this.page(1); })(), this.totals()]);
  }

  // ── Scenarios ───────────────────────────────────────────────────────────
  async listOpen() {
    this.list = { sort: DEFAULT_SORT, q: '', filters: {}, status: 'enabled' };
    // Wave 1: the budget columns setting and the dimensions gate the grid; /users runs alongside.
    await Promise.all([
      cached(this, 'budget-columns', 300_000, () => this.get('GET /budget-columns', '/budget-columns')),
      cached(this, 'analytics-axes', 300_000, () => this.get('GET /analytics-axes', '/analytics-axes')),
      cached(this, 'users-lookup', 30_000, () => this.get('GET /users?status=enabled&limit=1000 (list page)', '/users?status=enabled&limit=1000')),
    ]);
    // Wave 2: first block + three undeduplicated footer totals (mount effect, onGridReady
    // timeout, URL sync effect: OpexListPage.tsx:258-278, ServerDataGrid.tsx:492-511, 627-635).
    await Promise.all([this.page(1), this.totals(), this.totals(), this.totals()]);
  }

  async sortChange() {
    this.list.sort = this.list.sort === DEFAULT_SORT ? 'item_number:ASC' : DEFAULT_SORT;
    // Two block requests in a row + two totals (onSortChanged and the URL sync effect).
    await Promise.all([(async () => { await this.page(1); await this.page(1); })(), this.totals(), this.totals()]);
  }

  async setFilter() {
    // Paying company set filter (3 values, evaluated in memory): open, then 3 clicks applied at once.
    const field = 'paying_company_name';
    const res = await this.filterValues(field);
    const values = Array.isArray(res.data?.[field]) ? res.data[field].filter((v) => v != null) : [];
    if (values.length < 2) return;
    const selections = [values.slice(1), values.slice(2).length ? values.slice(2) : [values[0]], values.slice(1)];
    for (const selection of selections) {
      await sleep(400 + this.rand() * 600);
      this.list.filters = { ...this.list.filters, [field]: { filterType: 'set', values: selection } };
      await this.reloadAfterFilter();
    }
  }

  async textFilter() {
    // Column text filter typed character by character, no debounce (ClearableColumnFloatingFilter.tsx:80-86).
    const word = this.pick(['Licences', 'Régie', 'Support', 'Cloud', 'Sécurité']).slice(0, 5);
    const inflight = [];
    for (let i = 1; i <= word.length; i += 1) {
      this.list.filters = { ...this.list.filters, product_name: { filter: word.slice(0, i), type: 'contains', filterType: 'text' } };
      inflight.push(this.page(1), this.totals());
      await sleep(120 + this.rand() * 80);
    }
    await Promise.all(inflight);
    this.list.filters = {};
    await Promise.all([this.page(1), this.totals()]);
  }

  async quickSearch() {
    // Debounced 400 ms: one block + one totals per settled search.
    this.list.q = this.pick(['Licences', 'Régie', 'Support', 'Cloud', 'Maintenance', 'Hébergement']);
    await Promise.all([this.page(1), this.totals()]);
    this.list.q = '';
  }

  async scroll() {
    // 10 blocks of 50, sequential.
    for (let n = 2; n <= 11; n += 1) {
      await this.page(n);
      await sleep(150 + this.rand() * 250);
    }
  }

  async openItem(ref) {
    // A row of the list: one of the first 50 of the current order when known, else any line.
    const numbers = this.ids?.itemNumbers;
    if (!ref) ref = numbers?.length ? `OPX-${numbers[Math.floor(this.rand() * Math.min(50, numbers.length))]}` : `OPX-${1 + Math.floor(this.rand() * 5000)}`;
    this.itemRef = ref;
    await openWorkspace(this, ref, { cold: true });
  }

  async nextTen() {
    if (!this.itemRef) await this.openItem();
    for (let k = 0; k < 10; k += 1) {
      const ids = this.ids;
      if (!ids?.itemNumbers?.length) break;
      const current = Number(String(this.itemRef).replace('OPX-', ''));
      const idx = ids.itemNumbers.indexOf(current);
      const nextNumber = ids.itemNumbers[(idx + 1) % ids.itemNumbers.length];
      this.itemRef = `OPX-${nextNumber}`;
      const start = process.hrtime.bigint();
      await openWorkspace(this, this.itemRef, { cold: false });
      scenarios.push({ t: Date.now() - t0, vu: this.id, scenario: 'next (one step)', ms: Math.round(Number(process.hrtime.bigint() - start) / 1e6), ok: true, requests: 0 });
      await sleep(800 + this.rand() * 1200);
    }
  }

  async fieldSave() {
    if (!this.item) await this.openItem();
    await saveField(this);
  }

  async budgetCellSave() {
    if (!this.item) await this.openItem();
    await saveBudgetCell(this);
  }
}

// ── Workspace patterns (SpendItemPage.tsx and children) ────────────────────
// React Query semantics: a query is sent when its key is not cached or is stale
// (staleTime 30 s by default, 5 min for the settings-like hooks) at observer mount.
// On "next" the page instance stays mounted, so only queries whose key changes are sent.
// The properties drawer is open by default: its selects load their full lists.
async function cached(vu, key, ttlMs, fn) {
  const hit = vu.cache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.res;
  const res = await fn();
  if (res && res.status === 200) vu.cache.set(key, { at: Date.now(), res });
  return res;
}

async function openWorkspace(vu, ref, { cold }) {
  const listKey = JSON.stringify(vu.list);
  // Wave 1 (no dependency). On "next" only the detail key changes.
  const wave1 = [vu.get('GET /spend-items/:ref', `/spend-items/${ref}`)];
  if (cold) {
    wave1.push(
      cached(vu, 'currency-settings', 300_000, () => vu.get('GET /currency/settings', '/currency/settings')),
      cached(vu, 'cost-centers-tree', 300_000, () => vu.get('GET /cost-centers/tree', '/cost-centers/tree')),
      cached(vu, 'budget-columns', 300_000, () => vu.get('GET /budget-columns', '/budget-columns')),
      cached(vu, 'analytics-axes', 300_000, () => vu.get('GET /analytics-axes', '/analytics-axes')).then(async (axes) => {
        // Wave 1b: one full value list per enabled dimension (drawer).
        const list = Array.isArray(axes?.data) ? axes.data : axes?.data?.items ?? [];
        await Promise.all(list.filter((a) => a.enabled !== false).map((a) => cached(vu, `axis:${a.id}`, 30_000,
          () => vu.get('GET /analytics-categories?axis_id&limit=1000', `/analytics-categories?axis_id=${a.id}&limit=1000&sort=name:ASC`))));
      }),
      cached(vu, 'suppliers-active', 30_000, () => vu.get('GET /suppliers?limit=1000', '/suppliers?limit=1000')),
      cached(vu, 'companies-lookup', 30_000, () => vu.get('GET /companies/lookup?limit=1000', '/companies/lookup?limit=1000')),
      cached(vu, `ids:${listKey}`, 30_000, () => vu.summaryIds()).then((res) => {
        if (res?.status === 200) vu.ids = { ids: res.data?.ids ?? [], itemNumbers: res.data?.item_numbers ?? [] };
      }),
    );
  }
  const [detail] = await Promise.all(wave1);
  if (detail.status !== 200) return;
  vu.item = detail.data;
  const d = detail.data;
  const id = d.id;
  // Wave 2: everything keyed on data.id or on detail fields.
  const wave2 = ['contracts', 'applications', 'projects', 'links', 'attachments']
    .map((rel) => vu.get(`GET /spend-items/:id/${rel} (relations badge)`, `/spend-items/${id}/${rel}`));
  wave2.push(vu.get('GET /spend-items/:id/tasks', `/spend-items/${id}/tasks`));
  if (cold) wave2.push(cached(vu, 'users-select', 30_000, () => vu.get('GET /users?status=enabled&limit=1000 (share dialog)', '/users?status=enabled&limit=1000')));
  for (const owner of new Set([d.owner_it_id, d.owner_business_id].filter(Boolean))) {
    wave2.push(cached(vu, `user:${owner}`, 300_000, () => vu.get('GET /users/:id (owner picker)', `/users/${owner}`)));
  }
  if (d.paying_company_id) {
    const key = `accounts:${d.paying_company_id}`;
    const fresh = vu.cache.get(key) && Date.now() - vu.cache.get(key).at < 30_000;
    if (cold || !fresh) {
      wave2.push(cached(vu, key, 30_000, () => vu.get('GET /accounts?limit=1000&companyId', `/accounts?limit=1000&companyId=${d.paying_company_id}`)));
      if (d.account_id) wave2.push(vu.get('GET /accounts/:id (account select)', `/accounts/${d.account_id}`));
    }
  }
  await Promise.all(wave2);
}

async function saveField(vu) {
  // Autosave (700 ms debounce): PATCH with the typed field, then the detail refetch.
  const d = vu.item;
  await vu.req('PATCH /spend-items/:id', 'PATCH', `/spend-items/${d.id}`, { json: { notes: `Note perf ${Date.now()}` } });
  await vu.get('GET /spend-items/:ref', `/spend-items/${vu.itemRef}`);
}

async function saveBudgetCell(vu) {
  const d = vu.item;
  // Budget tab open: wave 1, then the amounts of the year's version.
  const [, versions] = await Promise.all([
    d.paying_company_id ? cached(vu, `company:${d.paying_company_id}`, 300_000, () => vu.get('GET /companies/:id', `/companies/${d.paying_company_id}`)) : null,
    vu.get('GET /spend-items/:id/versions', `/spend-items/${d.id}/versions`),
    cached(vu, `freeze:${Y}`, 60_000, () => vu.get('GET /freeze-states?year', `/freeze-states?year=${Y}`)),
    vu.get('GET /spend-items/:id/yearly-totals', `/spend-items/${d.id}/yearly-totals?from=${Y - 3}&to=${Y + 1}`),
  ]);
  const list = Array.isArray(versions.data) ? versions.data : versions.data?.items ?? [];
  const version = list.find((v) => Number(v.budget_year) === Y);
  if (!version) return;
  await vu.get('GET /spend-versions/:id/amounts?year', `/spend-versions/${version.id}/amounts?year=${Y}`);
  await sleep(1500 + vu.rand() * 1500);
  // One cell of the Forecast column (700 ms autosave debounce), nothing refetched on success.
  const month = 1 + Math.floor(vu.rand() * 12);
  const start = process.hrtime.bigint();
  await vu.req('POST /spend-versions/:id/amounts/bulk-upsert [cell]', 'POST', `/spend-versions/${version.id}/amounts/bulk-upsert`, {
    json: { kind: 'monthly', year: Y, months: [{ period: `${Y}-${String(month).padStart(2, '0')}-01`, forecast: 1000 + Math.round(vu.rand() * 900000) / 100 }] },
  });
  scenarios.push({ t: Date.now() - t0, vu: vu.id, scenario: 'budget cell save (request only)', ms: Math.round(Number(process.hrtime.bigint() - start) / 1e6), ok: true, requests: 1 });
}

// ── Scenario mix ───────────────────────────────────────────────────────────
const MIX = [
  ['list open', 'listOpen', 14],
  ['sort change', 'sortChange', 8],
  ['set filter open + 3 clicks', 'setFilter', 8],
  ['column text filter (typed)', 'textFilter', 7],
  ['quick search', 'quickSearch', 10],
  ['scroll 10 blocks', 'scroll', 6],
  ['open an item', 'openItem', 16],
  ['next x10', 'nextTen', 10],
  ['field save', 'fieldSave', 11],
  ['budget cell save', 'budgetCellSave', 10],
];
const MIX_TOTAL = MIX.reduce((a, m) => a + m[2], 0);
function pickScenario(rand) {
  let r = rand() * MIX_TOTAL;
  for (const m of MIX) { r -= m[2]; if (r <= 0) return m; }
  return MIX[0];
}

// ── Server-side sampling ───────────────────────────────────────────────────
function startSampler() {
  const samples = { pg: [], docker: [], probe: [] };
  let stopped = false;
  const pg = cfg.pg;
  const sql = `SELECT COALESCE(state,'?') AS state, COALESCE(wait_event_type,'') AS wet, count(*) FROM pg_stat_activity WHERE datname = '${pg.database}' AND application_name = '${pg.appName}' GROUP BY 1,2`;
  const pgLoop = (async () => {
    while (!stopped) {
      const t = Date.now() - t0;
      await new Promise((resolve) => {
        execFile('psql', ['-h', pg.host, '-p', String(pg.port), '-U', pg.user, '-d', pg.database, '-At', '-F', '|', '-c', sql], { env: { ...process.env, PGPASSWORD: pg.password }, timeout: 5000 }, (err, stdout) => {
          if (!err) {
            const row = { t, active: 0, idle: 0, idleInTx: 0, waitingLock: 0, waitingClient: 0, total: 0 };
            for (const line of stdout.trim().split('\n').filter(Boolean)) {
              const [state, wet, n] = line.split('|');
              const c = Number(n);
              row.total += c;
              if (state === 'active') row.active += c;
              else if (state === 'idle') row.idle += c;
              else if (state.startsWith('idle in transaction')) row.idleInTx += c;
              if (wet === 'Lock') row.waitingLock += c;
              if (wet === 'Client') row.waitingClient += c;
            }
            samples.pg.push(row);
          }
          resolve();
        });
      });
      await sleep(2000);
    }
  })();
  // docker stats in streaming mode: one JSON line per second.
  const ds = spawn('docker', ['stats', cfg.container, '--format', '{{json .}}']);
  let buf = '';
  ds.stdout.on('data', (chunk) => {
    buf += chunk.toString();
    const parts = buf.split('\n');
    buf = parts.pop();
    for (const part of parts) {
      const m = part.match(/\{.*\}/);
      if (!m) continue;
      try {
        const j = JSON.parse(m[0]);
        samples.docker.push({ t: Date.now() - t0, cpu: parseFloat(j.CPUPerc), mem: j.MemUsage });
      } catch {}
    }
  });
  // Event-loop proxy: a CORS preflight is answered by the cors middleware before any DB access.
  const probeClient = createClient({ baseUrl: cfg.baseUrl, maxSockets: 1, timeoutMs: 30000 });
  const probeLoop = (async () => {
    while (!stopped) {
      const res = await probeClient.request('OPTIONS', '/health', { headers: { Origin: 'http://perf.lvh.me', 'Access-Control-Request-Method': 'GET' }, parse: false });
      samples.probe.push({ t: Date.now() - t0, ms: Math.round(res.ms * 10) / 10, status: res.status });
      await sleep(1000);
    }
  })();
  return async () => {
    stopped = true;
    ds.kill();
    await Promise.all([pgLoop, probeLoop]);
    probeClient.close();
    return samples;
  };
}

// ── Summaries ──────────────────────────────────────────────────────────────
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return { n: sorted.length, p50: percentile(sorted, 50), p95: percentile(sorted, 95), p99: percentile(sorted, 99), max: sorted[sorted.length - 1] ?? null, mean: sorted.length ? Math.round(sum / sorted.length) : null };
}
function summarize(windowStart = 0) {
  const recs = records.filter((r) => r.t >= windowStart && r.scenario !== 'login');
  const byEndpoint = {};
  for (const r of recs) {
    const e = (byEndpoint[r.name] ??= { ms: [], bytes: [], statuses: {}, timeouts: 0 });
    e.ms.push(r.ms);
    e.bytes.push(r.bytes);
    const key = r.error === 'timeout' ? 'timeout' : String(r.status);
    e.statuses[key] = (e.statuses[key] ?? 0) + 1;
    if (r.error === 'timeout') e.timeouts += 1;
  }
  const endpoints = Object.fromEntries(Object.entries(byEndpoint).map(([k, v]) => [k, { ...stats(v.ms), avgBytes: Math.round(v.bytes.reduce((a, b) => a + b, 0) / v.bytes.length), statuses: v.statuses }]));
  const byScenario = {};
  for (const s of scenarios.filter((x) => x.t >= windowStart)) {
    const e = (byScenario[s.scenario] ??= { ms: [], failed: 0, requests: 0 });
    e.ms.push(s.ms);
    if (!s.ok) e.failed += 1;
    e.requests += s.requests;
  }
  const scen = Object.fromEntries(Object.entries(byScenario).map(([k, v]) => [k, { ...stats(v.ms), failed: v.failed, avgRequests: Math.round((v.requests / v.ms.length) * 10) / 10 }]));
  const errors = recs.filter((r) => !r.expected && (r.status === 0 || r.status >= 400));
  const errorsByStatus = {};
  for (const r of errors) { const k = r.error ? `${r.status}:${r.error}` : String(r.status); errorsByStatus[k] = (errorsByStatus[k] ?? 0) + 1; }
  const spanS = recs.length ? (Math.max(...recs.map((r) => r.t)) - Math.min(...recs.map((r) => r.t))) / 1000 : 0;
  const forbidden = {};
  for (const r of recs.filter((x) => x.expected)) forbidden[r.name] = (forbidden[r.name] ?? 0) + 1;
  return { requests: recs.length, retriedAfterReset: recs.filter((r) => r.retriedReset).length, forbidden, errors: errors.length, errorRate: recs.length ? Math.round((errors.length / recs.length) * 1000) / 1000 : 0, errorsByStatus, throughputRps: spanS ? Math.round((recs.length / spanS) * 10) / 10 : 0, scenariosCompleted: scenarios.filter((x) => x.t >= windowStart).length, scenarios: scen, endpoints };
}

// ── Modes ──────────────────────────────────────────────────────────────────
async function single() {
  const results = {};
  const users = [['admin', cfg.admin], ['member', cfg.members[0]]];
  for (const [label, user] of users) {
    const vu = new VirtualUser(label === 'admin' ? 0 : 1, user, rng(args.seed));
    await vu.login();
    vu.scenario = `single:${label}`;
    const sample = async (name, route, method = 'GET') => {
      for (let i = 0; i < 2; i += 1) await vu.req(`${name} (warmup)`, method, route); // warm
      const ms = [];
      let bytes = 0;
      let status = 0;
      for (let i = 0; i < args.repeat; i += 1) {
        const r = await vu.req(name, method, route);
        ms.push(r.ms);
        bytes = r.bytes;
        status = r.status;
      }
      results[`${label}: ${name}`] = { ...stats(ms.map((v) => Math.round(v))), bytes, status };
      log(`${label}: ${name} → p50 ${Math.round(percentile([...ms].sort((a, b) => a - b), 50))} ms, ${bytes} B, ${status}`);
    };
    await sample('summary default sort (yBudget:DESC)', `/spend-items/summary${qs({ page: 1, limit: 50, sort: DEFAULT_SORT, years: YEARS, status: 'enabled' })}`);
    await sample('summary SQL sort (item_number:ASC)', `/spend-items/summary${qs({ page: 1, limit: 50, sort: 'item_number:ASC', years: YEARS, status: 'enabled' })}`);
    await sample('summary/totals', `/spend-items/summary/totals${qs({ status: 'enabled' })}`);
    await sample('summary/filter-values supplier_name', `/spend-items/summary/filter-values${qs({ fields: 'supplier_name', years: YEARS, status: 'enabled' })}`);
    await sample('summary/ids default sort', `/spend-items/summary/ids${qs({ sort: DEFAULT_SORT, status: 'enabled' })}`);
    await sample('summary/ids SQL sort', `/spend-items/summary/ids${qs({ sort: 'item_number:ASC', status: 'enabled' })}`);
    await sample('item detail GET /spend-items/OPX-2500', '/spend-items/OPX-2500');
    await sample('capex summary default sort', `/capex-items/summary${qs({ page: 1, limit: 50, sort: DEFAULT_SORT, years: YEARS, status: 'enabled' })}`);
    await sample('suppliers?limit=1000 (select list)', '/suppliers?limit=1000');
    await sample('users?status=enabled&limit=1000', '/users?status=enabled&limit=1000');
    await sample('health (trivial, tenancy query only)', '/health');
    if (label === 'admin') {
      // URL size: a supplier set filter after unchecking one value carries all other names.
      const fv = await vu.get('filter-values', `/spend-items/summary/filter-values${qs({ fields: 'supplier_name', years: YEARS, status: 'enabled' })}`);
      const names = (fv.data?.supplier_name ?? []).filter((v) => v != null);
      const filters = JSON.stringify({ supplier_name: { filterType: 'set', values: names.slice(1) } });
      const route = `/spend-items/summary${qs({ page: 1, limit: 50, sort: DEFAULT_SORT, years: YEARS, status: 'enabled', filters })}`;
      const r = await vu.req('summary with supplier set filter (N-1 values)', 'GET', route);
      results['admin: summary with supplier set filter, all but one of the suppliers'] = { urlBytes: route.length, values: names.length - 1, status: r.status, ms: Math.round(r.ms), bytes: r.bytes };
      log(`URL of ${route.length} bytes (${names.length - 1} supplier names) → ${r.status}`);
    }
    vu.client.close();
  }
  writeFileSync(args.out, JSON.stringify({ mode: 'single', at: new Date().toISOString(), results, records }, null, 2));
}

async function load() {
  const users = [cfg.admin, ...cfg.members];
  const vus = [];
  const stopAt = Date.now() + args.duration * 1000;
  let aborted = null;
  const stopSampler = startSampler();
  log(`load: ${args.vus} VUs, ${args.duration} s, ramp ${args.ramp} s`);
  // Admin-heavy mix is unrealistic: VU 0 is the admin, the others are budget members.
  const runners = [];
  for (let i = 0; i < args.vus; i += 1) {
    const vu = new VirtualUser(i, users[i % users.length], rng(args.seed * 1000 + i));
    vus.push(vu);
    runners.push((async () => {
      await sleep((args.ramp * 1000 * i) / Math.max(1, args.vus));
      try { await vu.login(); } catch (e) { log(`VU ${i}: ${e.message}`); return; }
      await vu.run('list open', () => vu.listOpen());
      while (Date.now() < stopAt && !aborted) {
        await sleep((args.thinkMin + vu.rand() * (args.thinkMax - args.thinkMin)) * 1000);
        if (Date.now() >= stopAt || aborted) break;
        const [label, method] = pickScenario(vu.rand);
        await vu.run(label, () => vu[method]());
      }
    })());
  }
  // Watchdog: stop early when the API is clearly saturated.
  const watchdog = setInterval(() => {
    const now = Date.now() - t0;
    if (now < 60_000) return;
    const recent = records.filter((r) => r.t > now - 30_000 && r.scenario !== 'login');
    if (recent.length < 20) return;
    const errs = recent.filter((r) => !r.expected && (r.status === 0 || r.status >= 400)).length;
    if (errs / recent.length > args.abortErrorRate) {
      aborted = { atS: Math.round(now / 1000), errorRate: Math.round((errs / recent.length) * 100) / 100 };
      log(`stopping early: error rate ${aborted.errorRate} over the last 30 s`);
    }
  }, 5000);
  const progress = setInterval(() => {
    const now = Date.now() - t0;
    const recent = records.filter((r) => r.t > now - 10_000);
    const ms = recent.map((r) => r.ms).sort((a, b) => a - b);
    log(`t=${Math.round(now / 1000)} s, last 10 s: ${recent.length} req, p50 ${Math.round(percentile(ms, 50) ?? 0)} ms, p95 ${Math.round(percentile(ms, 95) ?? 0)} ms, errors ${recent.filter((r) => !r.expected && (r.status === 0 || r.status >= 400)).length}`);
  }, 10_000);
  await Promise.all(runners);
  clearInterval(watchdog);
  clearInterval(progress);
  const samples = await stopSampler();
  for (const vu of vus) vu.client.close();
  // Steady state: skip the ramp-up.
  const summary = summarize(args.ramp * 1000);
  const pgStats = {
    activeMax: Math.max(0, ...samples.pg.map((s) => s.active)),
    activeP50: percentile(samples.pg.map((s) => s.active).sort((a, b) => a - b), 50),
    idleInTxMax: Math.max(0, ...samples.pg.map((s) => s.idleInTx)),
    idleInTxP50: percentile(samples.pg.map((s) => s.idleInTx).sort((a, b) => a - b), 50),
    waitingLockMax: Math.max(0, ...samples.pg.map((s) => s.waitingLock)),
    connectionsMax: Math.max(0, ...samples.pg.map((s) => s.total)),
    busyShareAt20: samples.pg.length ? Math.round((samples.pg.filter((s) => s.active + s.idleInTx >= 20).length / samples.pg.length) * 100) / 100 : null,
  };
  const cpu = samples.docker.map((s) => s.cpu).filter(Number.isFinite).sort((a, b) => a - b);
  const probe = samples.probe.filter((s) => s.t >= args.ramp * 1000).map((s) => s.ms).sort((a, b) => a - b);
  const server = {
    pg: pgStats,
    cpuPct: { p50: percentile(cpu, 50), p95: percentile(cpu, 95), max: cpu[cpu.length - 1] ?? null },
    memLast: samples.docker[samples.docker.length - 1]?.mem ?? null,
    eventLoopProbeMs: { p50: percentile(probe, 50), p95: percentile(probe, 95), p99: percentile(probe, 99), max: probe[probe.length - 1] ?? null },
  };
  writeFileSync(args.out, JSON.stringify({ mode: 'load', at: new Date().toISOString(), args, aborted, summary, server, samples, scenarios, records }, null, 0));
  log(`requests ${summary.requests}, errors ${summary.errors} (${summary.errorRate}), throughput ${summary.throughputRps} req/s`);
  for (const [k, v] of Object.entries(summary.scenarios)) log(`  ${k.padEnd(30)} n=${v.n} p50=${v.p50} p95=${v.p95} p99=${v.p99} failed=${v.failed}`);
  log(`  pg: ${JSON.stringify(pgStats)} cpu: ${JSON.stringify(server.cpuPct)} probe: ${JSON.stringify(server.eventLoopProbeMs)}`);
}

(args.mode === 'single' ? single() : load()).catch((e) => { console.error(e); process.exitCode = 1; });
