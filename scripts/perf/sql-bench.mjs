#!/usr/bin/env node
// SQL-level bench (data-scoped access, lot 1 baseline; rerun by lot 2 with the policies).
//
// Runs a fixed set of named statements, captured from the real API (scripts/perf/sql/*.sql), on one
// database and one tenant. Each repetition is its own transaction, as a request is:
//
//   BEGIN READ ONLY; SELECT set_config('app.current_tenant', <id>, true); [hook];
//   EXPLAIN (ANALYZE, SUMMARY, FORMAT JSON) <statement>; ROLLBACK;
//
// Per statement it records the median and the p90 of `Planning Time` and `Execution Time`, whether the
// plan carries a `JIT` section, and a plan fingerprint (hash of the plan tree's node types, relation
// and index names, join types and aggregate strategies: no cost, row count or timing), so that two runs
// can say "same plan". No dependency: it drives `psql`, like bench.mjs.
//
//   node scripts/perf/sql-bench.mjs --db appdb_perf10k --out results.json
//     [--tenant perf]              slug or uuid of the tenant (default perf)
//     [--pg-url postgres://app:app@127.0.0.1:5432]   server, no database (default shown; --db is appended)
//     [--reps 10] [--warmup 2]
//     [--only list_first_page,tasks_page]            statement names, comma separated
//     [--apply-user <uuid>]        hook: SELECT data_access_apply('<uuid>') after the tenant setting
//     [--compare previous.json]    ratios of times and fingerprint changes against a previous run
//
// A statement file holds `{{name}}` placeholders for values that depend on the dataset (ids of a
// line, a company): they are resolved by the LOOKUPS below, run once, unscoped, before the timed runs.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SQL_DIR = path.join(HERE, 'sql');

const args = {
  db: '', tenant: 'perf', pgUrl: 'postgres://app:app@127.0.0.1:5432', reps: 10, warmup: 2, only: '', applyUser: '', compare: '', out: '', sqlDir: SQL_DIR,
};
for (let i = 2; i < process.argv.length; i += 1) {
  const key = process.argv[i].replace(/^--/, '').replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  if (!(key in args)) throw new Error(`Unknown argument: ${process.argv[i]}`);
  const raw = process.argv[++i];
  args[key] = typeof args[key] === 'number' ? Number(raw) : raw;
}
if (!args.db) {
  console.error('usage: sql-bench.mjs --db <database> [--tenant perf] [--reps 10] [--only a,b] [--apply-user <uuid>] [--compare prev.json] [--out result.json]');
  process.exit(2);
}
if (args.applyUser && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(args.applyUser)) throw new Error('--apply-user must be a user uuid');

const url = new URL(args.pgUrl);
const PSQL_ENV = { ...process.env, PGPASSWORD: decodeURIComponent(url.password) };
const PSQL_ARGS = ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-h', url.hostname, '-p', url.port || '5432', '-U', decodeURIComponent(url.username), '-d', args.db];

/** Runs a psql script on stdin and returns stdout. */
function psql(script) {
  try {
    return execFileSync('psql', PSQL_ARGS, { env: PSQL_ENV, input: script, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  } catch (error) {
    const stderr = String(error.stderr ?? '').trim();
    throw new Error(`psql failed on ${args.db}: ${stderr || error.message}`);
  }
}

// ── Dataset lookups (unscoped, run once) ───────────────────────────────────────────────────────────
// Each query returns one text value (an id, a '{a,b}' array literal or a quoted 'a','b' list) and only
// reads. The statement files keep the shape of what the API sent; these lookups rebuild the values that
// depend on the dataset, so the same files run on every perf database. Differences with the API:
// the "page" lists are 50 lines in item order (the API sends the 50 lines of the sort in play), the FX
// table has every rate set x year x currency at rate 1 (the API resolves the real rates; the shape and
// the size are the same), the chargeback lists hold every 2026 OPEX version (as the API does).
const ITEM = `(SELECT id FROM spend_items WHERE nature = 'opex' ORDER BY item_number OFFSET 2499 LIMIT 1)`;
const VERSION = `(SELECT id FROM spend_versions WHERE spend_item_id = ${ITEM} AND budget_year = 2026)`;
const PAGE_ITEMS = `(SELECT id FROM spend_items WHERE nature = 'opex' ORDER BY item_number LIMIT 50)`;
const PAGE_CONTRACTS = `(SELECT id FROM contracts ORDER BY name, id LIMIT 50)`;
const arr = (sel) => `SELECT '{' || coalesce(string_agg(x::text, ','), '') || '}' FROM (${sel}) t(x)`;
const list = (sel) => `SELECT coalesce(string_agg(quote_literal(x::text), ','), '') FROM (${sel}) t(x)`;
const VERSIONS_2026 = `SELECT v.id FROM spend_versions v JOIN spend_items i ON i.id = v.spend_item_id AND i.nature = 'opex' AND (i.disabled_at IS NULL OR i.disabled_at >= '2026-01-01') WHERE v.budget_year = 2026 ORDER BY v.id`;
const LOOKUPS = {
  item_id: `SELECT ${ITEM}`,
  item_number: `SELECT item_number FROM spend_items WHERE id = ${ITEM}`,
  item_supplier_id: `SELECT supplier_id FROM spend_items WHERE id = ${ITEM}`,
  item_account_id: `SELECT account_id FROM spend_items WHERE id = ${ITEM}`,
  item_owner_it_id: `SELECT owner_it_id FROM spend_items WHERE id = ${ITEM}`,
  item_owner_business_id: `SELECT owner_business_id FROM spend_items WHERE id = ${ITEM}`,
  item_cost_center_id: `SELECT cost_center_id FROM spend_items WHERE id = ${ITEM}`,
  // The paying company with the most OPEX lines.
  company_id: `SELECT paying_company_id FROM spend_items WHERE nature = 'opex' AND paying_company_id IS NOT NULL GROUP BY paying_company_id ORDER BY count(*) DESC, paying_company_id LIMIT 1`,
  company_name: `SELECT name FROM companies WHERE id = (SELECT paying_company_id FROM spend_items WHERE nature = 'opex' AND paying_company_id IS NOT NULL GROUP BY paying_company_id ORDER BY count(*) DESC, paying_company_id LIMIT 1)`,
  company_ids_arr: arr(`SELECT id FROM companies ORDER BY id`),
  // The first user created (the administrator of a perf tenant).
  user_id: `SELECT id FROM users ORDER BY created_at, id LIMIT 1`,
  version_id: `SELECT ${VERSION}`,
  version_round_input_ids: arr(`SELECT id FROM spend_round_inputs WHERE version_id = ${VERSION} ORDER BY id`),
  page_item_ids: arr(PAGE_ITEMS),
  page_version_ids: arr(`SELECT id FROM spend_versions WHERE spend_item_id IN ${PAGE_ITEMS} ORDER BY id`),
  page_contract_ids: arr(PAGE_CONTRACTS),
  page_supplier_ids: arr(`SELECT DISTINCT supplier_id FROM contracts WHERE id IN ${PAGE_CONTRACTS} AND supplier_id IS NOT NULL`),
  version_ids_2026_arr: arr(VERSIONS_2026),
  chargeback_version_ids_in: list(VERSIONS_2026),
  chargeback_item_ids_in: list(`SELECT DISTINCT v.spend_item_id FROM spend_versions v WHERE v.id IN (${VERSIONS_2026}) ORDER BY 1`),
  fx_known_sets: arr(`SELECT id FROM currency_rate_sets ORDER BY id`),
  // The FX table (see budget-fx-table.ts): the keys 'live' and every set, per year, per stored currency.
  fx_sets: `SELECT coalesce(string_agg(x::text, ','), '') FROM (SELECT id FROM currency_rate_sets ORDER BY id) t(x)`,
  fx_currencies: `SELECT coalesce(string_agg(c, ','), '') FROM (SELECT DISTINCT currency::text AS c FROM spend_items WHERE nature = 'opex' ORDER BY 1) t`,
};
const FX_PARTS = new Set(['fx_keys', 'fx_years', 'fx_curs', 'fx_rates']);

function fxValue(name, years, values) {
  const sets = ['live', ...(values.fx_sets ? values.fx_sets.split(',') : [])];
  const currencies = values.fx_currencies.split(',').filter(Boolean);
  const keys = []; const ys = []; const curs = []; const rates = [];
  for (const k of sets) for (const y of years.split(',')) for (const c of currencies) { keys.push(k); ys.push(y); curs.push(c); rates.push('1'); }
  const out = { fx_keys: keys, fx_years: ys, fx_curs: curs, fx_rates: rates }[name];
  return `{${out.join(',')}}`;
}

function resolveTenant(value) {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return value;
  const id = psql(`SELECT id FROM tenants WHERE slug = '${value.replace(/'/g, "''")}';`).trim();
  if (!id) throw new Error(`tenant '${value}' not found in ${args.db}`);
  return id;
}

function resolveLookups(tenantId, wanted) {
  const names = new Set();
  for (const w of wanted) names.add(FX_PARTS.has(w) ? 'fx_sets' : w);
  if ([...wanted].some((w) => FX_PARTS.has(w))) names.add('fx_currencies');
  const script = [
    'BEGIN READ ONLY;',
    `SELECT set_config('app.current_tenant', '${tenantId}', true) \\g /dev/null`,
    ...[...names].map((name) => {
      if (!(name in LOOKUPS)) throw new Error(`Unknown placeholder {{${name}}} (known: ${Object.keys(LOOKUPS).join(', ')}, fx_keys, fx_years, fx_curs, fx_rates, tenant_id)`);
      return `\\echo @@${name}\nSELECT (${LOOKUPS[name]});`;
    }),
    'ROLLBACK;',
  ].join('\n');
  const values = { tenant_id: tenantId };
  const chunks = psql(script).split(/^@@(\w+)\n/m);
  for (let i = 1; i < chunks.length; i += 2) values[chunks[i]] = chunks[i + 1].replace(/\n$/, '');
  for (const name of names) if (name !== 'fx_sets' && name !== 'fx_currencies' && !values[name]) throw new Error(`Lookup {{${name}}} returned no value in ${args.db}`);
  return values;
}

// ── Statements ───────────────────────────────────────────────────────────────────────────────────────
/** Header comments of a statement file: `-- group: fiche` puts it in a named group, summed as one line. */
function loadStatements() {
  const only = args.only ? new Set(args.only.split(',')) : null;
  const files = readdirSync(args.sqlDir).filter((f) => f.endsWith('.sql') && !f.startsWith('_')).sort();
  const out = [];
  for (const file of files) {
    const name = file.replace(/\.sql$/, '');
    if (only && !only.has(name)) continue;
    const text = readFileSync(path.join(args.sqlDir, file), 'utf8');
    const group = /^--\s*group:\s*(\S+)/m.exec(text)?.[1] ?? '';
    const family = /^--\s*family:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? '';
    out.push({ name, group, family, text });
  }
  if (only) for (const n of only) if (!out.some((s) => s.name === n)) throw new Error(`No statement file ${n}.sql in ${args.sqlDir}`);
  if (!out.length) throw new Error(`No statement in ${args.sqlDir}`);
  return out;
}

/** The statement without header comments, trailing semicolon and blank lines. */
const body = (text) => text.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').trim().replace(/;+\s*$/, '');

// ── Plan fingerprint ───────────────────────────────────────────────────────────────────────────────
/** One line per node, indented by depth: node type, relation, index, join type, aggregate strategy, subplan name. */
function planShape(node, depth = 0, lines = []) {
  const bits = [node['Node Type']];
  if (node['Relation Name']) bits.push(`on ${node['Relation Name']}`);
  if (node['Index Name']) bits.push(`using ${node['Index Name']}`);
  if (node['Join Type']) bits.push(`join ${node['Join Type']}`);
  if (node['Strategy']) bits.push(`strategy ${node['Strategy']}`);
  if (node['Parent Relationship'] && node['Parent Relationship'] !== 'Outer' && node['Parent Relationship'] !== 'Inner') bits.push(`as ${node['Parent Relationship']}`);
  if (node['Subplan Name']) bits.push(`[${node['Subplan Name'].replace(/\s*\d+$/, '')}]`);
  lines.push(`${'  '.repeat(depth)}${bits.join(' ')}`);
  for (const child of node.Plans ?? []) planShape(child, depth + 1, lines);
  return lines;
}
const fingerprintOf = (plan) => {
  const shape = planShape(plan).join('\n');
  return { fingerprint: createHash('sha1').update(shape).digest('hex').slice(0, 12), shape };
};

// ── Run ──────────────────────────────────────────────────────────────────────────────────────────────
const median = (v) => { const s = [...v].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p90 = (v) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)]; };
const round = (x) => Math.round(x * 1000) / 1000;

function checkHook() {
  if (!args.applyUser) return;
  const exists = psql(`SELECT to_regprocedure('data_access_apply(uuid)') IS NOT NULL;`).trim();
  if (exists !== 't') {
    throw new Error(`--apply-user: the function data_access_apply(uuid) does not exist in ${args.db}. It comes with the data-scoped access migration (lot 1 of planning/data-scoped-access); run the API of that version against this database first.`);
  }
}

function runStatement(statement, values, tenantId) {
  const sql = statement.text.replace(/\{\{(\w+)(?::([\d,]+))?\}\}/g, (_, n, arg) => {
    if (FX_PARTS.has(n)) return fxValue(n, arg, values);
    if (!(n in values)) throw new Error(`${statement.name}: unresolved {{${n}}}`);
    return values[n];
  });
  const one = (marker) => [
    'BEGIN READ ONLY;',
    `SELECT set_config('app.current_tenant', '${tenantId}', true) \\g /dev/null`,
    ...(args.applyUser ? [`SELECT data_access_apply('${args.applyUser}') \\g /dev/null`] : []),
    `\\echo @@${marker}`,
    `EXPLAIN (ANALYZE, SUMMARY, FORMAT JSON) ${body(sql)};`,
    'ROLLBACK;',
  ].join('\n');
  const total = args.warmup + args.reps;
  const script = Array.from({ length: total }, (_, i) => one(i)).join('\n');
  const output = psql(script);
  const plans = output.split(/^@@\d+$/m).slice(1).map((chunk) => JSON.parse(chunk.trim())[0]);
  if (plans.length !== total) throw new Error(`${statement.name}: expected ${total} plans, got ${plans.length}`);
  const timed = plans.slice(args.warmup);
  const planning = timed.map((p) => p['Planning Time']);
  const execution = timed.map((p) => p['Execution Time']);
  const jit = timed.some((p) => p.JIT);
  const { fingerprint, shape } = fingerprintOf(timed[0].Plan);
  const stable = timed.every((p) => fingerprintOf(p.Plan).fingerprint === fingerprint);
  return {
    name: statement.name, group: statement.group, family: statement.family,
    planningMedian: round(median(planning)), planningP90: round(p90(planning)),
    executionMedian: round(median(execution)), executionP90: round(p90(execution)),
    jit, jitRuns: timed.filter((p) => p.JIT).length,
    jitTiming: jit ? timed.find((p) => p.JIT).JIT.Timing : undefined,
    fingerprint, fingerprintStable: stable, planShape: shape,
    rows: timed[0].Plan['Actual Rows'],
    planning, execution,
  };
}

function main() {
  checkHook();
  const tenantId = resolveTenant(args.tenant);
  const statements = loadStatements();
  const wanted = new Set();
  for (const s of statements) for (const m of s.text.matchAll(/\{\{(\w+)(?::[\d,]+)?\}\}/g)) if (m[1] !== 'tenant_id') wanted.add(m[1]);
  const values = resolveLookups(tenantId, wanted);
  const server = psql('SHOW server_version;').trim();
  const settings = Object.fromEntries(['jit', 'work_mem', 'shared_buffers', 'jit_above_cost', 'max_parallel_workers_per_gather'].map((k) => [k, psql(`SHOW ${k};`).trim()]));
  console.log(`database ${args.db}, tenant ${tenantId}, PostgreSQL ${server}, ${args.reps} repetitions after ${args.warmup} warmups${args.applyUser ? `, data_access_apply(${args.applyUser})` : ', unscoped'}`);
  const results = [];
  for (const statement of statements) {
    const r = runStatement(statement, values, tenantId);
    results.push(r);
    console.log(`${r.name.padEnd(34)} plan ${String(r.planningMedian).padStart(8)} ms  exec ${String(r.executionMedian).padStart(9)} ms  p90 ${String(r.executionP90).padStart(9)}  jit ${r.jit ? 'yes' : 'no '}  ${r.fingerprint}${r.fingerprintStable ? '' : ' (UNSTABLE)'}`);
  }
  // Groups (the budget line workspace, "fiche"): the sum of the medians of their statements.
  const groups = {};
  for (const r of results.filter((x) => x.group)) {
    const g = (groups[r.group] ??= { statements: [], planningMedian: 0, executionMedian: 0, executionP90: 0 });
    g.statements.push(r.name);
    g.planningMedian = round(g.planningMedian + r.planningMedian);
    g.executionMedian = round(g.executionMedian + r.executionMedian);
    g.executionP90 = round(g.executionP90 + r.executionP90);
  }
  for (const [name, g] of Object.entries(groups)) console.log(`group ${name.padEnd(28)} plan ${String(g.planningMedian).padStart(8)} ms  exec ${String(g.executionMedian).padStart(9)} ms  (${g.statements.length} statements)`);
  const run = {
    at: new Date().toISOString(), database: args.db, tenantId, server, settings, reps: args.reps, warmup: args.warmup,
    applyUser: args.applyUser || null, lookups: values, results, groups,
  };
  if (args.out) writeFileSync(args.out, JSON.stringify(run, null, 2));
  if (args.compare) compare(run, JSON.parse(readFileSync(args.compare, 'utf8')));
}

function compare(run, previous) {
  const before = new Map(previous.results.map((r) => [r.name, r]));
  const ratio = (a, b) => (b > 0 ? (a / b).toFixed(2) : 'n/a');
  console.log(`\ncompare with ${previous.database} (${previous.at}${previous.applyUser ? `, apply-user ${previous.applyUser}` : ', unscoped'}):`);
  console.log(`${'statement'.padEnd(34)} ${'plan x'.padStart(8)} ${'exec x'.padStart(8)} ${'p90 x'.padStart(8)}  plan`);
  for (const r of run.results) {
    const p = before.get(r.name);
    if (!p) { console.log(`${r.name.padEnd(34)} (not in the previous run)`); continue; }
    console.log(`${r.name.padEnd(34)} ${ratio(r.planningMedian, p.planningMedian).padStart(8)} ${ratio(r.executionMedian, p.executionMedian).padStart(8)} ${ratio(r.executionP90, p.executionP90).padStart(8)}  ${r.fingerprint === p.fingerprint ? 'same' : `CHANGED ${p.fingerprint} -> ${r.fingerprint}`}${r.jit !== p.jit ? `  JIT ${p.jit ? 'yes' : 'no'} -> ${r.jit ? 'yes' : 'no'}` : ''}`);
  }
  for (const [name, g] of Object.entries(run.groups)) {
    const p = previous.groups?.[name];
    if (p) console.log(`group ${name.padEnd(28)} ${ratio(g.planningMedian, p.planningMedian).padStart(8)} ${ratio(g.executionMedian, p.executionMedian).padStart(8)} ${ratio(g.executionP90, p.executionP90).padStart(8)}`);
  }
}

main();
