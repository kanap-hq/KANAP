import 'dotenv/config';
import { createHash } from 'node:crypto';
import type { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SpendItemsService } from '../spend-items.service';
import { CapexItemsService } from '../../capex/capex-items.service';
import { SUMMARY_SCOPES, SummaryScopeConfig } from '../spend-summary.builder';
import { CONSOLIDATION_COUNTS_INACTIVE_ACCOUNTS } from '../budget-list/budget-list.config';
import { realSummaryDeps } from './oracle/oracle-deps';
import { seedListFixture } from './oracle/budget-list.fixture';
import * as O from './oracle/report-browser.oracle';
// The very functions the screens run (pure, self-contained): what each one asks and how it reads the answer.
import * as R from '../../../../frontend/src/pages/reports/reportAggregates';

// Parity of the budget reports, the dashboard tiles and the budget operations
// pages before and after lot 2D (PR E). Before: the browser downloaded every
// line through `/summary` (pages of 500, `created_at:DESC`, the report's
// `years`) and computed (`oracle/report-browser.oracle.ts`, the former
// components' code). After: the request the screen sends to
// `POST …/summary/aggregate` and the reading of the answer
// (`frontend/src/pages/reports/reportAggregates.ts`, imported here), on the
// same transaction. What is compared is what the screens render: the lines,
// groups and totals of each report, the options of each picker.
//
// Expected differences, counted and never failed:
// - ties: lines or groups of equal value may come in another order (the
//   browser kept the download order, the server orders by the keys), and a
//   top N cut inside a run of equal values may keep other members;
// - amounts: the server sums exact cents, the browser summed doubles: within
//   half a cent, and rendered the same except on an exact value at a half
//   unit (x.50), counted as "rendered differently at a half"; any other
//   rendering difference fails;
// - Consolidation (decision pending with fried, `CONSOLIDATION_COUNTS_INACTIVE_ACCOUNTS`):
//   a line on an account no longer active (or past the 1,000 accounts
//   `/accounts` returned) goes to its account's consolidation line instead of
//   "Unassigned", and a consolidation line names itself after the least label
//   (ICU order) of the accounts sharing its key instead of the first line
//   read. The report is compared exactly with the former code adapted to
//   these two rules (adapters A1 and A2 below; A2 reads the labels of the
//   accounts the type's lines use), and the raw former code's differences are
//   counted; the exclusion picker also offers the accounts the lines use (an
//   account the former list did not hold is counted). A caller who cannot
//   read the accounts page sees every line "Unassigned", compared with the
//   former code without accounts (its `/accounts` answered 403).
//
// Both datasets get consolidation accounts in the transaction (rolled back):
// numbers, names, numbers shared by two names, names sharing a key, padded
// names, and a ninth of the accounts ended ten days ago.
//
// CI (default): the list differential's fixture (`oracle/budget-list.fixture.ts`).
// Local, on a loaded tenant (read-only, rolled back):
//   DATABASE_URL=postgres://app:app@localhost:5432/appdb_perf REPORT_PARITY_TENANT=perf \
//     npx ts-node src/spend/__tests__/report-aggregates-parity.integration.spec.ts
// Options: REPORT_PARITY_SCOPE (opex or capex; both by default), REPORT_PARITY_SEED.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

type Row = Record<string, any>;
type Scope = R.BudgetScope;

const SEED = Number(process.env.REPORT_PARITY_SEED ?? 20261002);
const TENANT_SLUG = process.env.REPORT_PARITY_TENANT || null;
const SCOPES = (process.env.REPORT_PARITY_SCOPE ?? 'opex,capex').split(',').map((s) => s.trim()) as Scope[];
const Y = new Date().getFullYear();
const compare = (a: string, b: string) => a.localeCompare(b);
const UNASSIGNED = 'Unassigned';
const UNNAMED = 'Unnamed';
const UNNAMED_ACCOUNT = 'Unnamed account';
/** The ICU root order of PostgreSQL's `und-x-icu`, bytes breaking ties (a deterministic collation). */
const icu = new Intl.Collator('und');
const icuCompare = (a: string, b: string) => icu.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);

const failures: string[] = [];
const caseNames: string[] = [];
const stats = {
  checks: 0,
  amounts: 0,
  renderedAtHalf: [] as string[],
  tieReorders: 0,
  tieCutMembers: 0,
  consolidationRawGroupsDiffering: 0,
  consolidationRawCases: 0,
  consolidationLinesMoved: 0,
  consolidationLabelsChanged: 0,
  consolidationPickerExtras: 0,
  accountLabelsPadded: 0,
  oldMs: 0,
  newMs: 0,
};

function fail(label: string, message: string) {
  failures.push(`${label}: ${message}`);
}

/**
 * An old double sum and an exact cents value: within half a cent, and rendered the same unless the
 * exact value lies on a half unit (x.50), where the double sum may fall a hair below it.
 */
function sameAmount(label: string, old: number, now: number) {
  stats.checks += 1;
  stats.amounts += 1;
  if (!(Math.abs(old - now) <= 0.005)) {
    fail(label, `amount ${old} before, ${now} after`);
    return;
  }
  if (O.formatNumber(old) !== O.formatNumber(now)) {
    if (Math.abs(Math.round(now * 100)) % 100 === 50) stats.renderedAtHalf.push(`${label}: ${old} / ${now}`);
    else fail(label, `rendered ${O.formatNumber(old)} before, ${O.formatNumber(now)} after (${old} / ${now})`);
  }
}

/** A percentage the screen rounds (`digits` decimals): equal, or within a hair of the rounding point. */
function samePct(label: string, old: number | null, now: number | null, digits: number) {
  stats.checks += 1;
  if (old == null || now == null) {
    if (old !== now) fail(label, `percentage ${old} before, ${now} after`);
    return;
  }
  if (Math.abs(old - now) > 1e-6 * Math.max(1, Math.abs(old))) {
    fail(label, `percentage ${old} before, ${now} after`);
    return;
  }
  if (old.toFixed(digits) !== now.toFixed(digits)) stats.renderedAtHalf.push(`${label}: ${old} / ${now}`);
}

function same(label: string, old: unknown, now: unknown) {
  stats.checks += 1;
  const a = JSON.stringify(old);
  const b = JSON.stringify(now);
  if (a !== b) fail(label, `before ${a.slice(0, 300)}\n      after  ${b.slice(0, 300)}`);
}

const cents = (value: number) => Math.round(value * 100);

/**
 * A ranked list (top N): the same length, the same value at each position, the
 * same members per value except the last value of a full list (equal values
 * at the cut), and the same fields for each line present in both.
 */
function sameRanked<T extends { id: string }, U extends { id: string }>(
  label: string,
  old: T[],
  now: U[],
  value: (row: T | U) => number,
  limit: number | null,
  fields: (label: string, o: T, n: U) => void,
) {
  stats.checks += 1;
  if (old.length !== now.length) {
    fail(label, `${old.length} lines before, ${now.length} after`);
    return;
  }
  for (let i = 0; i < old.length; i += 1) {
    if (cents(value(old[i])) !== cents(value(now[i]))) {
      fail(label, `position ${i}: ${value(old[i])} before, ${value(now[i])} after`);
      return;
    }
    if (old[i].id !== now[i].id) stats.tieReorders += 1;
  }
  const full = limit != null && old.length === limit;
  const cut = old.length ? cents(value(old[old.length - 1])) : null;
  const members = (list: Array<T | U>) => {
    const byValue = new Map<number, string[]>();
    for (const row of list) {
      const key = cents(value(row));
      byValue.set(key, [...(byValue.get(key) ?? []), row.id]);
    }
    return byValue;
  };
  const before = members(old);
  const after = members(now);
  for (const [key, ids] of before) {
    const other = (after.get(key) ?? []).slice().sort();
    if (full && key === cut) {
      stats.tieCutMembers += ids.filter((id) => !other.includes(id)).length;
      continue;
    }
    if (JSON.stringify(ids.slice().sort()) !== JSON.stringify(other)) fail(label, `lines of value ${key / 100}: ${ids.length} before, ${other.length} after`);
  }
  const byId = new Map(now.map((row) => [row.id, row]));
  for (const o of old) {
    const n = byId.get(o.id);
    if (n) fields(`${label} ${o.id}`, o, n);
  }
}

/** Groups per year (Consolidation, Analytics): the first year's value at each position, then each group by key. */
function sameYearGroups(label: string, old: R.YearGroup[], now: R.YearGroup[], years: number[]) {
  stats.checks += 1;
  if (old.length !== now.length) {
    fail(label, `${old.length} groups before (${old.map((g) => g.key).join(', ').slice(0, 200)}), ${now.length} after (${now.map((g) => g.key).join(', ').slice(0, 200)})`);
    return;
  }
  for (let i = 0; i < old.length; i += 1) {
    if (cents(old[i].values[years[0]] ?? 0) !== cents(now[i].values[years[0]] ?? 0)) {
      fail(label, `position ${i}: ${old[i].values[years[0]]} before, ${now[i].values[years[0]]} after`);
      return;
    }
    if (old[i].key !== now[i].key) stats.tieReorders += 1;
  }
  const byKey = new Map(now.map((group) => [group.key, group]));
  for (const o of old) {
    const n = byKey.get(o.key);
    if (!n) {
      fail(label, `group ${o.key} (${o.label}) missing after`);
      continue;
    }
    same(`${label} ${o.key} label`, o.label, n.label);
    for (const year of years) sameAmount(`${label} ${o.key} ${year}`, o.values[year] ?? 0, n.values[year] ?? 0);
  }
}

/** An option list sorted by name: the same options, equal names in any order. */
function sameOptions(label: string, old: Array<{ id: string; name: string }>, now: Array<{ id: string; name: string }>) {
  stats.checks += 1;
  if (old.length !== now.length) {
    fail(label, `${old.length} options before, ${now.length} after`);
    return;
  }
  for (let i = 0; i < old.length; i += 1) {
    if (old[i].name !== now[i].name) {
      fail(label, `position ${i}: ${JSON.stringify(old[i].name)} before, ${JSON.stringify(now[i].name)} after`);
      return;
    }
    if (old[i].id !== now[i].id) stats.tieReorders += 1;
  }
  same(`${label} ids`, old.map((o) => `${o.name}\u0000${o.id}`).sort(), now.map((o) => `${o.name}\u0000${o.id}`).sort());
}

// ----- the data -----

function itemService(scope: SummaryScopeConfig): any {
  const deps = realSummaryDeps(scope);
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[4] = deps.allocationCalculator;
  args[7] = deps.fxRates;
  return scope.scope === 'opex' ? new (SpendItemsService as any)(...args) : new (CapexItemsService as any)(...args);
}

/** The former `useOpexSummaryAll` / `useCapexSummaryAll`: every line, pages of 500, `created_at:DESC`, the report's years. */
async function downloadRows(svc: any, m: EntityManager, years?: number[]): Promise<Row[]> {
  const limit = 500;
  let page = 1;
  let items: Row[] = [];
  let total = 0;
  const yearsParam = years ? years.join(',') : undefined;
  do {
    const data = await svc.summary({ page, limit, sort: 'created_at:DESC', years: yearsParam }, { manager: m });
    items = items.concat(data.items || []);
    total = data.total || items.length;
    page += 1;
    if (!data.items || data.items.length === 0) break;
  } while (items.length < total && page <= 50);
  return items;
}

/** Consolidation accounts on both datasets (rolled back with the transaction). */
async function decorateAccounts(m: EntityManager, tenantId: string) {
  await m.query(
    `WITH a AS (SELECT id, row_number() OVER (ORDER BY account_number, id) AS n FROM accounts WHERE tenant_id = $1)
     UPDATE accounts acc SET
       consolidation_account_number = CASE WHEN a.n % 6 IN (0, 3) THEN 600 + (a.n % 4) WHEN a.n % 6 = 1 THEN 700 + (a.n % 3) END,
       consolidation_account_name = CASE a.n % 6
         WHEN 0 THEN 'Infrastructure'
         WHEN 3 THEN 'Infra ' || (a.n % 2)
         WHEN 2 THEN CASE WHEN a.n % 4 = 0 THEN '  Frais généraux IT ' ELSE 'Frais-généraux IT' END
         WHEN 4 THEN 'Logiciels & licences' END,
       disabled_at = CASE WHEN a.n % 9 = 5 THEN now() - interval '10 days' ELSE acc.disabled_at END,
       status = CASE WHEN a.n % 9 = 5 THEN 'disabled'::status_state ELSE acc.status END
     FROM a WHERE acc.id = a.id AND acc.tenant_id = $1`,
    [tenantId],
  );
}

type Env = {
  scope: Scope;
  m: EntityManager;
  svc: any;
  rows: (years?: number[]) => Promise<Row[]>;
  agg: (request: R.AggregateRequest) => Promise<R.AggregateResult>;
  aggNoAccounts: (request: R.AggregateRequest) => Promise<R.AggregateResult>;
  /** Accounts some line of the type uses (the labels of the consolidation lines come from them). */
  usedAccountIds: Set<string>;
  axes: { all: string[]; enabled: string[]; defaultAxisId: string | null };
  descendants: (id: string) => Set<string>;
  nodeIds: string[];
  activeAccounts: O.ConsolidationAccount[];
  allAccounts: O.ConsolidationAccount[];
  catalogue: (axisId: string) => Promise<Array<{ id: string; name: string }>>;
};

async function loadEnv(scope: Scope, m: EntityManager, tenantId: string): Promise<Env> {
  const svc = itemService(SUMMARY_SCOPES[scope]);
  const rowCache = new Map<string, Promise<Row[]>>();
  const rows = (years?: number[]) => {
    const key = years?.join(',') ?? '';
    if (!rowCache.has(key)) {
      const started = Date.now();
      rowCache.set(key, downloadRows(svc, m, years).then((list) => { stats.oldMs += Date.now() - started; return list; }));
    }
    return rowCache.get(key)!;
  };
  // A reader of the accounts page (the consolidation lines); `aggNoAccounts` for one who is not.
  const aggWith = async (request: R.AggregateRequest, accounts: boolean) => {
    const started = Date.now();
    // Through JSON, as the request and the answer travel.
    const answer = await svc.summaryAggregateRequest(JSON.parse(JSON.stringify(request)), { manager: m, access: { accounts } });
    stats.newMs += Date.now() - started;
    return JSON.parse(JSON.stringify(answer)) as R.AggregateResult;
  };
  const agg = (request: R.AggregateRequest) => aggWith(request, true);
  const aggNoAccounts = (request: R.AggregateRequest) => aggWith(request, false);
  const axisRows: Array<{ id: string; is_default: boolean; status: string; disabled_at: Date | null; sort_order: number; name: string | null; code: string }> = await m.query(
    `SELECT id, is_default, status, disabled_at, sort_order, name, code FROM analytics_axes WHERE tenant_id = $1`, [tenantId],
  );
  // The screen's order: sort order, then the lowercased name, then the code.
  axisRows.sort((a, b) => a.sort_order - b.sort_order || ((a.name ?? '').toLowerCase() < (b.name ?? '').toLowerCase() ? -1 : (a.name ?? '').toLowerCase() > (b.name ?? '').toLowerCase() ? 1 : 0) || (a.code < b.code ? -1 : 1));
  const active = (axis: { status: string; disabled_at: Date | null }) => axis.status !== 'disabled' && (axis.disabled_at == null || new Date(axis.disabled_at).getTime() > Date.now());
  const nodes: Array<{ id: string; parent_id: string | null }> = await m.query(`SELECT id, parent_id FROM cost_centers WHERE tenant_id = $1`, [tenantId]);
  const children = new Map<string, string[]>();
  for (const node of nodes) if (node.parent_id) children.set(node.parent_id, [...(children.get(node.parent_id) ?? []), node.id]);
  const known = new Set(nodes.map((node) => node.id));
  const descendants = (id: string) => {
    const out = new Set<string>();
    if (!known.has(id)) return out;
    const stack = [id];
    while (stack.length) {
      const current = stack.pop()!;
      if (out.has(current)) continue;
      out.add(current);
      for (const child of children.get(current) ?? []) stack.push(child);
    }
    return out;
  };
  const accountColumns = `id, account_number, account_name, consolidation_account_number, consolidation_account_name`;
  // `/accounts?limit=1000`: the active accounts, newest first.
  const activeAccounts = await m.query(`SELECT ${accountColumns} FROM accounts WHERE tenant_id = $1 AND (disabled_at IS NULL OR disabled_at > now()) ORDER BY created_at DESC, id DESC LIMIT 1000`, [tenantId]);
  const allAccounts = await m.query(`SELECT ${accountColumns} FROM accounts WHERE tenant_id = $1`, [tenantId]);
  // `/analytics-categories?axis_id=…&limit=1000&sort=name:ASC`: the dimension's active values.
  const catalogue = (axisId: string) => m.query(
    `SELECT id, name FROM analytics_categories WHERE tenant_id = $1 AND axis_id = $2 AND (disabled_at IS NULL OR disabled_at > now()) ORDER BY name, id LIMIT 1000`,
    [tenantId, axisId],
  );
  const itemTable = scope === 'opex' ? 'spend_items' : 'capex_items';
  const used: Array<{ account_id: string }> = await m.query(`SELECT DISTINCT account_id FROM ${itemTable} WHERE tenant_id = $1 AND account_id IS NOT NULL`, [tenantId]);
  return {
    scope,
    m,
    svc,
    rows,
    agg,
    aggNoAccounts,
    usedAccountIds: new Set(used.map((u) => u.account_id)),
    axes: { all: axisRows.map((a) => a.id), enabled: axisRows.filter(active).map((a) => a.id), defaultAxisId: axisRows.find((a) => a.is_default)?.id ?? null },
    descendants,
    nodeIds: nodes.map((node) => node.id).sort(),
    activeAccounts,
    allAccounts,
    catalogue,
  };
}

// ----- the cases -----

type FilterState = { name: string; criteria: O.BudgetRowCriteria; picks: R.ReportFilterPicks };

function mostFrequent<T>(values: Array<T | null | undefined>): T | null {
  const counts = new Map<T, number>();
  for (const value of values) if (value != null) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: T | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) if (count > bestCount) { best = value; bestCount = count; }
  return best;
}

function filterStates(env: Env, allRows: Row[]): FilterState[] {
  const states: FilterState[] = [];
  const add = (name: string, criteria: Partial<O.BudgetRowCriteria>, picks: Partial<R.ReportFilterPicks>) => {
    states.push({
      name,
      criteria: { costCenterIds: null, runBuild: null, analytics: null, ...criteria },
      picks: { costCenterIds: null, runBuild: null, analytics: [], ...picks },
    });
  };
  add('no filter', {}, {});
  // The node with the most lines under it (a group when the tree has one), and the most used leaf.
  const used = mostFrequent(allRows.map((row) => row.cost_center_id));
  let group: string | null = null;
  let best = 0;
  const lineCenters = allRows.map((row) => row.cost_center_id).filter(Boolean) as string[];
  for (const candidate of env.nodeIds) {
    const under = env.descendants(candidate);
    if (under.size < 2) continue;
    const count = lineCenters.filter((c) => under.has(c)).length;
    // A group under which some lines are and some are not.
    if (count > best && count < lineCenters.length) { best = count; group = candidate; }
  }
  if (group) add('cost center group', { costCenterIds: env.descendants(group) }, { costCenterIds: Array.from(env.descendants(group)) });
  if (used) add('cost center', { costCenterIds: env.descendants(used) }, { costCenterIds: Array.from(env.descendants(used)) });
  for (const runBuild of ['run', 'build', 'none'] as const) add(`run or build ${runBuild}`, { runBuild }, { runBuild });
  const axis = env.axes.defaultAxisId && env.axes.enabled.includes(env.axes.defaultAxisId) ? env.axes.defaultAxisId : env.axes.enabled[0];
  if (axis) {
    const value = mostFrequent(allRows.map((row) => row.analytics_value_ids?.[axis]));
    if (value) add('dimension value', { analytics: new Map([[axis, value]]) }, { analytics: [[axis, value]] });
    const other = env.axes.enabled.find((id) => id !== axis) ?? axis;
    add('dimension without value', { analytics: new Map([[other, 'none']]) }, { analytics: [[other, 'none']] });
    if (group && value) {
      add('group, run, value', { costCenterIds: env.descendants(group), runBuild: 'run', analytics: new Map([[axis, value]]) }, { costCenterIds: Array.from(env.descendants(group)), runBuild: 'run', analytics: [[axis, value]] });
    }
  }
  return states;
}

const METRIC_KEYS: R.MetricKey[] = ['budget', 'revision', 'forecast', 'follow_up', 'landing'];

async function runScope(env: Env) {
  const { scope } = env;
  const allRows = await env.rows();
  const windowRows = await env.rows([Y - 2, Y - 1, Y, Y + 1, Y + 2]);
  const states = filterStates(env, allRows);
  const label = (name: string) => `${scope} ${name}`;
  const at = { failures: failures.length, checks: stats.checks };

  // Options the exclusions draw from.
  const oldPickers = O.itemAndAccountOptions(scope, allRows);
  const accountValues = (await env.svc.summaryFilterValues({ fields: 'account_display' }, { manager: env.m })).account_display ?? [];
  const accountOptions = R.accountLabelOptions(accountValues, compare);
  stats.accountLabelsPadded += accountValues.filter((value: string | null) => value != null && value !== value.trim()).length;

  for (const state of states) {
    const rows = O.filterBudgetRows(allRows, state.criteria);
    const filters = R.reportFilterModels(state.picks);

    // Top items.
    type TopCase = { year: number; metric: R.MetricKey; topCount: number; excludedIds: string[]; excludedAccounts: string[] };
    const topCases: TopCase[] = [
      { year: Y, metric: 'budget', topCount: 10, excludedIds: [], excludedAccounts: [] },
      { year: Y - 1, metric: 'landing', topCount: 1, excludedIds: [], excludedAccounts: [] },
      { year: Y + 1, metric: 'revision', topCount: 50, excludedIds: [], excludedAccounts: [] },
    ];
    const plain = O.topItems(scope, rows, topCases[0]);
    topCases.push({ ...topCases[0], excludedIds: plain.processed.slice(0, 3).map((r) => r.id), excludedAccounts: oldPickers.accountOptions.slice(0, 2).map((o) => o.id) });
    for (const p of topCases) {
      const name = label(`${state.name}, top ${p.topCount} ${p.metric} ${p.year}${p.excludedIds.length ? ', exclusions' : ''}`);
      caseNames.push(name);
      const old = O.topItems(scope, rows, p);
      const now = R.readTopItems(await env.agg(R.topItemsRequest({ scope, ...p, excludedAccounts: R.excludedAccountValues(p.excludedAccounts, accountOptions), filters })));
      sameRanked(name, old.processed, now.processed, (r) => r.value, R.topLimit(p.topCount), (l, o, n) => {
        same(`${l} name`, o.name, n.name);
        sameAmount(`${l} value`, o.value, n.value);
        samePct(`${l} share`, o.pct_of_total, n.pct_of_total, 0);
      });
      sameAmount(`${name} total`, old.totalMetric, now.totalMetric);
      sameAmount(`${name} top total`, old.topSelectionTotal, now.topSelectionTotal);
    }

    // Increases and decreases.
    const deltaCases = [
      { sourceYear: Y - 1, sourceMetric: 'budget' as R.MetricKey, destinationYear: Y, destinationMetric: 'budget' as R.MetricKey, modes: ['increase'] as Array<'increase' | 'decrease'>, topCount: 10, excludedIds: [] as string[], excludedAccounts: [] as string[] },
      { sourceYear: Y, sourceMetric: 'budget' as R.MetricKey, destinationYear: Y + 1, destinationMetric: 'landing' as R.MetricKey, modes: ['decrease'] as Array<'increase' | 'decrease'>, topCount: 10, excludedIds: [], excludedAccounts: [] },
      { sourceYear: Y - 2, sourceMetric: 'forecast' as R.MetricKey, destinationYear: Y + 2, destinationMetric: 'budget' as R.MetricKey, modes: ['increase', 'decrease'] as Array<'increase' | 'decrease'>, topCount: 25, excludedIds: [], excludedAccounts: [] },
    ];
    const firstDelta = O.delta(scope, rows, deltaCases[0]);
    deltaCases.push({ ...deltaCases[0], modes: ['increase', 'decrease'], excludedIds: firstDelta.processed.slice(0, 2).map((r) => r.id), excludedAccounts: oldPickers.accountOptions.slice(0, 2).map((o) => o.id) });
    for (const p of deltaCases) {
      const name = label(`${state.name}, ${p.modes.join(' and ')} ${p.sourceMetric} ${p.sourceYear} to ${p.destinationMetric} ${p.destinationYear}${p.excludedIds.length ? ', exclusions' : ''}`);
      caseNames.push(name);
      const old = O.delta(scope, rows, p);
      const requests = R.deltaRequests({
        scope,
        source: { year: p.sourceYear, metric: p.sourceMetric },
        destination: { year: p.destinationYear, metric: p.destinationMetric },
        modes: p.modes,
        topCount: p.topCount,
        excludedIds: p.excludedIds,
        excludedAccounts: R.excludedAccountValues(p.excludedAccounts, accountOptions),
        filters,
      });
      const answers = [];
      for (const request of requests) answers.push(await env.agg(request));
      const now = R.readDelta(p.modes, answers);
      for (const direction of p.modes) {
        sameRanked(`${name} ${direction}`, old.processed.filter((r) => r.direction === direction), now.processed.filter((r) => r.direction === direction), (r) => r.delta, R.topLimit(p.topCount), (l, o, n) => {
          same(`${l} name`, o.name, n.name);
          sameAmount(`${l} previous`, o.previous, n.previous);
          sameAmount(`${l} current`, o.current, n.current);
          sameAmount(`${l} delta`, o.delta, n.delta);
          samePct(`${l} %`, o.pct_increase, n.pct_increase, 1);
        });
      }
      sameAmount(`${name} gross increase`, old.allTotals.grossIncrease, now.allTotals.grossIncrease);
      sameAmount(`${name} gross decrease`, old.allTotals.grossDecrease, now.allTotals.grossDecrease);
      sameAmount(`${name} net`, old.allTotals.net, now.allTotals.net);
    }

    // Consolidation: exactly the former code under the decided rules (A1: every account of the
    // tenant names its line, inactive ones included; A2: one label per key, the least in ICU
    // order), and the raw former code's differences counted.
    const usedAccounts = Array.from(new Set(allRows.map((row) => row.account?.id).filter(Boolean))) as string[];
    const consolidationCases = [
      { years: [Y], metric: 'budget' as R.MetricKey, excludedAccounts: [] as string[] },
      { years: [Y - 1, Y, Y + 1], metric: 'landing' as R.MetricKey, excludedAccounts: [] as string[] },
      { years: [Y], metric: 'budget' as R.MetricKey, excludedAccounts: usedAccounts.slice(0, 2) },
    ];
    const labelsByKey = new Map<string, string>();
    for (const account of env.allAccounts) {
      if (!env.usedAccountIds.has(account.id)) continue;
      if (!CONSOLIDATION_COUNTS_INACTIVE_ACCOUNTS && !env.activeAccounts.some((a) => a.id === account.id)) continue;
      const { key, label: accountLabel } = consolidationKeyOf(account);
      if (!key) continue;
      const known = labelsByKey.get(key);
      if (known == null || icuCompare(accountLabel!, known) < 0) labelsByKey.set(key, accountLabel!);
    }
    for (const p of consolidationCases) {
      const name = label(`${state.name}, consolidation ${p.metric} ${p.years.join('-')}${p.excludedAccounts.length ? ', exclusions' : ''}`);
      caseNames.push(name);
      const now = R.readConsolidation(p.years, await env.agg(R.consolidationRequest({ years: p.years, metric: p.metric, excludedAccountIds: p.excludedAccounts, filters })), UNASSIGNED);
      const adaptedAccounts = CONSOLIDATION_COUNTS_INACTIVE_ACCOUNTS ? env.allAccounts : env.activeAccounts;
      const adapted = O.consolidation(rows, adaptedAccounts, { ...p, unassigned: UNASSIGNED });
      for (const group of adapted.groups) if (group.key !== 'unassigned') group.label = labelsByKey.get(group.key) ?? group.label;
      sameYearGroups(name, adapted.groups, now.groups, p.years);
      for (const year of p.years) sameAmount(`${name} total ${year}`, adapted.totals[year], now.totals[year]);
      // The raw former code (no adapter): what fried would see change.
      const raw = O.consolidation(rows, env.activeAccounts, { ...p, unassigned: UNASSIGNED });
      stats.consolidationRawCases += 1;
      const nowByKey = new Map(now.groups.map((g) => [g.key, g]));
      for (const group of raw.groups) {
        const n = nowByKey.get(group.key);
        if (!n || n.label !== group.label || p.years.some((year) => cents(n.values[year]) !== cents(group.values[year]))) stats.consolidationRawGroupsDiffering += 1;
        if (n && n.label !== group.label) stats.consolidationLabelsChanged += 1;
      }
      // A caller who cannot read the accounts page: every line "Unassigned", as when `/accounts` answered him 403.
      const noAccess = R.readConsolidation(p.years, await env.aggNoAccounts(R.consolidationRequest({ years: p.years, metric: p.metric, excludedAccountIds: p.excludedAccounts, filters })), UNASSIGNED);
      const noAccessBefore = O.consolidation(rows, [], { ...p, unassigned: UNASSIGNED });
      sameYearGroups(`${name} without accounts access`, noAccessBefore.groups, noAccess.groups, p.years);
      if (state.name === 'no filter' && p === consolidationCases[0]) {
        const activeIds = new Set(env.activeAccounts.map((a) => a.id));
        const byId = new Map(env.allAccounts.map((a) => [a.id, a]));
        stats.consolidationLinesMoved += rows.filter((row) => row.account?.id && !activeIds.has(row.account.id) && consolidationKeyOf(byId.get(row.account.id)).key).length;
      }
    }

    // Analytics, on the default dimension and on another one.
    const analyticsAxes = Array.from(new Set([env.axes.defaultAxisId && env.axes.enabled.includes(env.axes.defaultAxisId) ? env.axes.defaultAxisId : env.axes.enabled[0], env.axes.enabled.find((id) => id !== env.axes.defaultAxisId)].filter(Boolean))) as string[];
    for (const axisId of analyticsAxes) {
      const catalogue = await env.catalogue(axisId);
      const frequent = Array.from(new Set(allRows.map((row) => row.analytics_value_ids?.[axisId]).filter(Boolean))).slice(0, 2) as string[];
      for (const p of [
        { years: [Y], metric: 'budget' as R.MetricKey, excluded: [] as string[] },
        { years: [Y - 1, Y, Y + 1], metric: 'forecast' as R.MetricKey, excluded: [] as string[] },
        { years: [Y], metric: 'budget' as R.MetricKey, excluded: frequent },
      ]) {
        const name = label(`${state.name}, analytics ${axisId.slice(0, 8)} ${p.metric} ${p.years.join('-')}${p.excluded.length ? ', exclusions' : ''}`);
        caseNames.push(name);
        const old = O.analytics(rows, catalogue, { axisId, years: p.years, metric: p.metric, excludedCategories: p.excluded, unassigned: UNASSIGNED, unnamed: UNNAMED });
        const now = R.readAnalytics(p.years, await env.agg(R.analyticsRequest({ axisId, years: p.years, metric: p.metric, excludedIds: p.excluded, filters })), { unassigned: UNASSIGNED, unnamed: UNNAMED });
        sameYearGroups(name, old.groups, now.groups, p.years);
        for (const year of p.years) sameAmount(`${name} total ${year}`, old.totals[year], now.totals[year]);
      }
    }

    // Trends (OPEX or CAPEX): the window from Y-2.
    const trendRows = O.filterBudgetRows(windowRows, state.criteria);
    for (const years of [[Y - 1, Y, Y + 1], [Y - 2, Y - 1, Y, Y + 1, Y + 2]]) {
      const metrics: R.MetricKey[] = ['budget', 'landing'];
      const name = label(`${state.name}, trend ${years.join('-')}`);
      caseNames.push(name);
      const old = O.trend(trendRows, { years, metrics });
      const now = R.readTrend({ years, metrics }, await env.agg(R.trendRequest({ years, metrics, windowYears: [Y - 2, Y - 1, Y, Y + 1, Y + 2], filters })));
      for (const metric of metrics) for (const year of years) sameAmount(`${name} ${metric} ${year}`, old[metric][year], now[metric][year]);
    }

    // Budget column comparison: the window from the earliest year picked; a pick made twice adds twice.
    for (const selections of [
      [{ year: Y, metric: 'budget' as R.MetricKey }, { year: Y + 1, metric: 'budget' as R.MetricKey }],
      [{ year: Y + 2, metric: 'follow_up' as R.MetricKey }, { year: Y, metric: 'landing' as R.MetricKey }, { year: Y - 2, metric: 'revision' as R.MetricKey }, { year: Y, metric: 'landing' as R.MetricKey }],
    ]) {
      const sorted = [...selections].sort((a, b) => (a.year !== b.year ? a.year - b.year : METRIC_KEYS.indexOf(a.metric) - METRIC_KEYS.indexOf(b.metric)));
      const years = Array.from(new Set(selections.map((s) => s.year))).sort((a, b) => a - b);
      const name = label(`${state.name}, columns ${sorted.map((s) => `${s.metric} ${s.year}`).join(', ')}`);
      caseNames.push(name);
      const old = O.columnsCompare(O.filterBudgetRows(await env.rows(years), state.criteria), sorted);
      const totals = R.readColumnsCompare(sorted, await env.agg(R.columnsCompareRequest({ selections: sorted, filters })));
      sorted.forEach((s, i) => sameAmount(`${name} ${s.metric} ${s.year}`, old.totals[i], totals[i]));
      const pivot = new Map<string, number>();
      sorted.forEach((s, i) => pivot.set(`${s.year}:${s.metric}`, (pivot.get(`${s.year}:${s.metric}`) || 0) + totals[i]));
      for (const [key, value] of old.pivot) sameAmount(`${name} pivot ${key}`, value, pivot.get(key) ?? NaN);
    }
  }

  // The filter bar's options, on the window of the reports without years and from Y-2.
  for (const years of [undefined, [Y - 2, Y - 1, Y, Y + 1, Y + 2]]) {
    const name = label(`filter bar options${years ? ' from Y-2' : ''}`);
    caseNames.push(name);
    const old = O.filterBarOptions(years ? windowRows : allRows, env.axes.enabled, UNNAMED);
    same(`${name} run or build`, old.showRunBuild, R.readRunBuildPresence(await env.agg(R.runBuildPresenceRequest(years))).hasRunBuild);
    for (const axisId of env.axes.enabled) {
      const now = R.readAxisValues(await env.agg(R.axisValuesRequest(axisId, years)), UNNAMED, compare);
      sameOptions(`${name} ${axisId.slice(0, 8)}`, (old.analytics.get(axisId) ?? []).map((o) => ({ id: o.id, name: o.label })), now.map((o) => ({ id: o.id, name: o.label })));
    }
  }

  // The variance report's years, and the exclusion pickers.
  caseNames.push(label('pickers'));
  same(label('variance years'), O.deltaYearOptions(allRows, Y), R.readDeltaYears(await env.agg(R.deltaYearsRequest(Y)), Y));
  sameOptions(label('item options'), oldPickers.itemOptions, R.readItemOptions(await env.agg(R.itemOptionsRequest(scope)), compare));
  sameOptions(label('account options'), oldPickers.accountOptions, accountOptions.map((o) => ({ id: o.id, name: o.name })));
  const oldAccounts = O.consolidationAccountOptions(env.activeAccounts, UNNAMED_ACCOUNT);
  const newAccounts = R.mergeAccountOptions(env.activeAccounts as R.AccountRow[], await env.agg(R.accountIdOptionsRequest()), UNNAMED_ACCOUNT, compare);
  const newById = new Map(newAccounts.map((o) => [o.id, o.label]));
  for (const option of oldAccounts) same(label(`consolidation account option ${option.id}`), option.label, newById.get(option.id));
  stats.consolidationPickerExtras += newAccounts.length - oldAccounts.length;
  for (const axisId of env.axes.enabled) {
    const catalogue = await env.catalogue(axisId);
    sameOptions(
      label(`analytics options ${axisId.slice(0, 8)}`),
      O.analyticsOptions(allRows, catalogue, axisId, UNNAMED).map((o) => ({ id: o.id, name: o.label })),
      R.mergeAxisValueOptions(catalogue, await env.agg(R.axisValuesRequest(axisId)), UNNAMED, compare).map((o) => ({ id: o.id, name: o.label })),
    );
  }

  // Dashboard: top increases on each column, the four hygiene counts.
  for (const metric of METRIC_KEYS) {
    const name = label(`dashboard top increases ${metric}`);
    caseNames.push(name);
    const old = O.topIncreases(scope, allRows, metric);
    const now = R.readTopIncreases(await env.agg(R.topIncreasesRequest(scope, metric, 5))).map((row) => ({ ...row, name: row.name || '—' }));
    sameRanked(name, old, now, (r) => r.delta, 5, (l, o, n) => {
      same(`${l} name`, o.name, n.name);
      sameAmount(`${l} delta`, o.delta, n.delta);
    });
  }
  for (const check of O.HYGIENE_CHECKS) {
    const name = label(`dashboard hygiene ${check.key}`);
    caseNames.push(name);
    const old = (await env.svc.summary({ limit: 1, filters: JSON.stringify(check.filter) }, { manager: env.m })).total;
    same(name, old, (await env.agg(R.countRequest(check.filter as unknown as R.ColumnFilters))).total.count);
  }

  // Budget operations pages: every line with its amounts in its own currency.
  const lineName = (value: unknown) => (value == null ? '' : String(value));
  for (const p of [{ year: Y, column: 'budget' as R.MetricKey | null }, { year: Y + 1, column: 'landing' as R.MetricKey | null }, { year: Y + 3, column: 'forecast' as R.MetricKey | null }, { year: Y, column: null }]) {
    const name = label(`column reset ${p.column ?? 'no column'} ${p.year}`);
    caseNames.push(name);
    const old = O.resetLines(await env.rows([p.year]), p.year, p.column);
    const now = R.readOperationLines(await env.agg(R.operationLinesRequest(scope, [p.year], p.column ? [{ id: 'current', year: p.year, metric: p.column }] : [])));
    same(`${name} lines`, old.map((r) => r.id).sort(), now.map((r) => r.id).sort());
    const byId = new Map(now.map((r) => [r.id, r]));
    for (const o of old) {
      const n = byId.get(o.id);
      if (!n) continue;
      same(`${name} ${o.id} name`, lineName(o.product_name), n.name);
      sameAmount(`${name} ${o.id} amount`, o.currentValue, n.values.current ?? 0);
    }
    sameAmount(`${name} total`, old.reduce((sum, r) => sum + r.currentValue, 0), R.sumAmounts(now.map((r) => r.values.current ?? 0)));
    same(`${name} lines with an amount`, old.filter((r) => r.currentValue !== 0).length, now.filter((r) => (r.values.current ?? 0) !== 0).length);
  }
  for (const p of [
    { sourceYear: Y, sourceColumn: 'budget' as R.MetricKey, destinationYear: Y + 1, destinationColumn: 'budget' as R.MetricKey },
    { sourceYear: Y - 1, sourceColumn: 'landing' as R.MetricKey, destinationYear: Y, destinationColumn: 'forecast' as R.MetricKey },
  ]) {
    const name = label(`column copy ${p.sourceColumn} ${p.sourceYear} to ${p.destinationColumn} ${p.destinationYear}`);
    caseNames.push(name);
    const years = Array.from(new Set([p.sourceYear, p.destinationYear])).sort((a, b) => a - b);
    const old = O.copyLines(await env.rows(years), p);
    const now = R.readOperationLines(await env.agg(R.operationLinesRequest(scope, years, [
      { id: 'source', year: p.sourceYear, metric: p.sourceColumn },
      { id: 'destination', year: p.destinationYear, metric: p.destinationColumn },
    ])));
    same(`${name} lines`, old.map((r) => r.id).sort(), now.map((r) => r.id).sort());
    const byId = new Map(now.map((r) => [r.id, r]));
    for (const o of old) {
      const n = byId.get(o.id);
      if (!n) continue;
      same(`${name} ${o.id} name`, lineName(o.product_name), n.name);
      sameAmount(`${name} ${o.id} source`, o.sourceValue, n.values.source ?? 0);
      sameAmount(`${name} ${o.id} destination`, o.destinationValue, n.values.destination ?? 0);
    }
  }

  console.log(`report-aggregates-parity (${TENANT_SLUG ?? 'fixture'}, ${scope}): ${allRows.length} lines, ${states.length} filter states, ${stats.checks - at.checks} checks, ${failures.length - at.failures} differences`);
}

/** The former report's key and label of an account's consolidation line (`makeKey`). */
function consolidationKeyOf(account?: O.ConsolidationAccount | null): { key: string | null; label: string | null } {
  const num = account?.consolidation_account_number ?? null;
  const name = (account?.consolidation_account_name ?? '').trim() || null;
  if (num == null && !name) return { key: null, label: null };
  return {
    key: `c_${num != null ? num : name!.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`,
    label: name && num != null ? `[${num}] ${name}` : (name ?? `[${num}]`),
  };
}

async function main() {
  const started = Date.now();
  await dataSource.initialize();
  const runner: QueryRunner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    let tenantId: string;
    if (TENANT_SLUG) {
      const [tenant] = await runner.query(`SELECT id FROM tenants WHERE slug = $1`, [TENANT_SLUG]);
      if (!tenant) throw new Error(`No tenant ${TENANT_SLUG}`);
      tenantId = tenant.id;
    } else {
      tenantId = (await seedListFixture(runner, SEED)).tenantId;
    }
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await decorateAccounts(runner.manager, tenantId);
    for (const scope of SCOPES) await runScope(await loadEnv(scope, runner.manager, tenantId));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  const digest = createHash('sha256').update(caseNames.join('\n')).digest('hex').slice(0, 12);
  console.log(`report-aggregates-parity (${TENANT_SLUG ?? 'fixture'}, seed ${SEED}): ${caseNames.length} cases (digest ${digest}), ${stats.checks} checks (${stats.amounts} amounts), ${failures.length} differences; `
    + `documented: ${stats.tieReorders} positions holding another line of equal value, ${stats.tieCutMembers} lines of equal value kept instead of another at a top N cut, `
    + `${stats.renderedAtHalf.length} values rendered differently at a half unit; Consolidation with the former rules: ${stats.consolidationRawGroupsDiffering} groups differing over ${stats.consolidationRawCases} cases `
    + `(${stats.consolidationLabelsChanged} labels, ${stats.consolidationLinesMoved} lines leaving "Unassigned" in the plain case), ${stats.consolidationPickerExtras} more accounts in its exclusion picker; `
    + `${stats.accountLabelsPadded} account labels with outer spaces; former downloads ${(stats.oldMs / 1000).toFixed(1)} s, aggregates ${(stats.newMs / 1000).toFixed(1)} s, ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (stats.renderedAtHalf.length) console.log(`  rendered differently at a half unit:\n    ${stats.renderedAtHalf.slice(0, 10).join('\n    ')}`);
  if (failures.length) {
    console.error(`report-aggregates-parity: ${failures.length} differences\n  ${failures.slice(0, 40).join('\n  ')}`);
    process.exit(1);
  }
  console.log('report-aggregates-parity.integration.spec: ok');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.message}\n${err.stack?.split('\n').slice(1, 8).join('\n')}` : err);
  process.exit(1);
});
