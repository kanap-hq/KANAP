import 'dotenv/config';
import { createHash } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SpendItemsService } from '../spend-items.service';
import { CapexItemsService } from '../spend-items.service';
import { AiAggregateExecutor } from '../../ai/query/ai-aggregate.executor';
import { adaptFilters } from '../../ai/query/ai-filter.adapter';
import type { AiEntityFilterRegistry } from '../../ai/query/ai-filter.types';
import { resolveAiEntityRegistry } from '../../ai/query/registries';
import { centsToNumber, formatCents, toCents } from '../../common/amount';
import { Decimal, divRoundHalfAway } from '../../common/decimal';
import type { AggregateMeasureSpec, AggregateOrderSpec, AggregateSpec } from '../../common/list-engine/list-aggregate';
import { FIXED_SLOTS, resolveAmountField, resolveFteField, SUMMARY_COLUMNS, SUMMARY_SCOPES, SummaryScopeConfig } from '../spend-summary.builder';
import * as engine from '../budget-list/budget-list.service';
import { aggregateBudgetSummaryByIds } from './oracle/ai-aggregate.oracle';
import { oracleTextCompare, SORT_ORDERS } from './oracle/budget-summary.oracle';
import { realSummaryDeps } from './oracle/oracle-deps';
import { prng, seedListFixture } from './oracle/budget-list.fixture';
import { getSummaryFieldValue, summaryFieldValues } from './oracle/summary-field-value.oracle';

// Differential test of the list engine's aggregate (lot 2B, PR D), on the
// OPEX and the CAPEX list:
// 1. AI cases: the AI aggregate executor, now one `aggregate()` statement,
//    against its former in-memory path (`oracle/ai-aggregate.oracle.ts`: the
//    ids of the list state, the row of every id, grouped and measured with
//    the rows' field values). Same groups in the same order (count, or
//    value, then key), same counts, sums to the cent, FTE with the unknown
//    lines, same total. Groupings on every groupable field (multi-valued
//    project fields under their joined names), every function, amounts of
//    every year and column (FX), FTE, AI filters (sets, exclusions, amounts,
//    text, dates) and quick searches.
// 2. Engine specs: `budgetListAggregate` with what the AI does not send
//    (several keys, top N with the others, conditions, orders by key and
//    measure, variances and their parts, the total), against a reference
//    computed here from the same rows, exactly (bigint cents, decimals).
//
// CI (default): the deterministic fixture of the list differential
// (`oracle/budget-list.fixture.ts`) in a rolled-back transaction.
// Local, on a loaded tenant (read-only, rolled back):
//   DATABASE_URL=postgres://app:app@localhost:5432/appdb_perf AGG_DIFF_TENANT=perf \
//     npx ts-node src/spend/__tests__/budget-aggregate-differential.integration.spec.ts
// Options: AGG_DIFF_SCOPE (opex or capex; both by default), AGG_DIFF_SEED,
// AGG_DIFF_CASES (combined AI cases), AGG_DIFF_SPECS (engine specs),
// AGG_DIFF_FULL=1 (every amount and FTE column in the AI matrix; the default
// on a loaded tenant), AGG_DIFF_ONLY=<case id>.
// Deterministic: one seed gives the same cases (digest on the summary line).
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

const SEED = Number(process.env.AGG_DIFF_SEED ?? 20261002);
const TENANT_SLUG = process.env.AGG_DIFF_TENANT || null;
const COMBINED = Number(process.env.AGG_DIFF_CASES ?? (TENANT_SLUG ? 200 : 150));
const SPECS = Number(process.env.AGG_DIFF_SPECS ?? (TENANT_SLUG ? 120 : 150));
const FULL = process.env.AGG_DIFF_FULL === '1' || (process.env.AGG_DIFF_FULL !== '0' && !!TENANT_SLUG);
const ONLY = process.env.AGG_DIFF_ONLY ?? null;
const Y = new Date().getFullYear();
const SCOPES: SummaryScopeConfig[] = (process.env.AGG_DIFF_SCOPE ?? 'opex,capex').split(',').map((key) => {
  const config = (SUMMARY_SCOPES as Record<string, SummaryScopeConfig>)[key.trim()];
  if (!config) throw new Error(`AGG_DIFF_SCOPE: unknown list ${key}`);
  return config;
});

type AiInput = { entity_type: 'spend_items' | 'capex_items'; group_by: string; function: string; metric?: string; filters?: Record<string, any>; q?: string };
type Case =
  | { id: string; kind: 'ai'; input: AiInput }
  | { id: string; kind: 'spec'; query: Record<string, any>; spec: AggregateSpec; checkDefaultScope?: boolean };

const failures: string[] = [];
let checksRun = 0;
const stats = { groups: 0, empty: 0, oneGroup: 0, several: 0, bothFailed: 0, invalidFilter: 0 };

function same(label: string, actual: unknown, expected: unknown): boolean {
  checksRun += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) return true;
  let at = 0;
  while (at < a.length && a[at] === b[at]) at += 1;
  failures.push(`${label}\n      engine: …${a.slice(Math.max(0, at - 160), at + 240)}\n      oracle: …${b.slice(Math.max(0, at - 160), at + 240)}`);
  return false;
}

type Settled = { value?: any; error?: Error };
async function settle(runner: QueryRunner, fn: () => Promise<unknown>): Promise<Settled> {
  await runner.query('SAVEPOINT agg_side');
  try {
    const value = await fn();
    await runner.query('RELEASE SAVEPOINT agg_side');
    return { value };
  } catch (error) {
    await runner.query('ROLLBACK TO SAVEPOINT agg_side');
    return { error: error as Error };
  }
}

/** Both sides failed (counted), or one only (a difference); false when both answered. */
function failed(label: string, e: Settled, o: Settled): boolean {
  if (e.error && o.error) {
    stats.bothFailed += 1;
    return true;
  }
  if (e.error || o.error) {
    checksRun += 1;
    failures.push(`${label}: one side failed: engine=${e.error?.message ?? 'ok'} oracle=${o.error?.message ?? 'ok'}`);
    return true;
  }
  return false;
}

// ----- services -----

function itemServiceWith(scope: SummaryScopeConfig, deps: ReturnType<typeof realSummaryDeps>): any {
  // One constructor for both natures since lot Z1: the CAPEX service is the OPEX one's subclass.
  const args: any[] = Array.from({ length: 11 }, () => undefined);
  args[4] = deps.allocationCalculator;
  args[6] = deps.fxRates;
  return scope.scope === 'opex' ? new (SpendItemsService as any)(...args) : new (CapexItemsService as any)(...args);
}

/** Constructor positions of the executor: spendItems 5, capexItems 17. */
function executorFor(scope: SummaryScopeConfig, svc: unknown): AiAggregateExecutor {
  const args: any[] = Array.from({ length: 22 }, () => ({}));
  args[scope.scope === 'opex' ? 5 : 17] = svc;
  return new (AiAggregateExecutor as any)(...args);
}

// ----- the reference of the engine specs -----

const INT_FIELDS = new Set(['item_number', 'account_number']);
type Measured = { s: bigint | Decimal | null; c: number; lo: bigint | Decimal | null; hi: bigint | Decimal | null };
type RefGroup = { keys: Array<string | null>; n: number; m: Measured[] };

const isMoney = (field: string) => resolveAmountField(field) != null;

function keyOf(row: any, field: string): string | null {
  const value = getSummaryFieldValue(row, field);
  return value == null || value === '' ? null : String(value);
}

/** A line's value of a measure: cents (bigint) for an amount, a decimal or null for an FTE. */
function lineValue(row: any, measure: AggregateMeasureSpec): bigint | Decimal | null {
  if (!isMoney(measure.field)) {
    const value = getSummaryFieldValue(row, measure.field);
    return typeof value === 'number' ? Decimal.from(value) : null;
  }
  let cents = toCents(getSummaryFieldValue(row, measure.field));
  if (measure.minus) cents -= toCents(getSummaryFieldValue(row, measure.minus));
  if (measure.part === 'positive' && cents < 0n) cents = 0n;
  if (measure.part === 'negative' && cents > 0n) cents = 0n;
  return cents;
}

function cmpValues(a: bigint | Decimal, b: bigint | Decimal): number {
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  return (a as Decimal).cmp(b as Decimal);
}

function add(a: bigint | Decimal | null, b: bigint | Decimal | null): bigint | Decimal | null {
  if (a == null) return b;
  if (b == null) return a;
  return typeof a === 'bigint' ? a + (b as bigint) : (a as Decimal).add(b as Decimal);
}

const pickLow = (a: any, b: any) => (a == null ? b : b == null ? a : cmpValues(a, b) <= 0 ? a : b);
const pickHigh = (a: any, b: any) => (a == null ? b : b == null ? a : cmpValues(a, b) >= 0 ? a : b);

function combine(groups: RefGroup[], measures: AggregateMeasureSpec[]): RefGroup {
  return {
    keys: [],
    n: groups.reduce((n, g) => n + g.n, 0),
    m: measures.map((_, i) => groups.reduce<Measured>((acc, g) => ({
      s: add(acc.s, g.m[i].s),
      c: acc.c + g.m[i].c,
      lo: pickLow(acc.lo, g.m[i].lo),
      hi: pickHigh(acc.hi, g.m[i].hi),
    }), { s: null, c: 0, lo: null, hi: null })),
  };
}

function valueOf(m: Measured, measure: AggregateMeasureSpec): bigint | Decimal | null {
  const money = isMoney(measure.field);
  switch (measure.fn) {
    case 'sum':
      return money ? ((m.s as bigint | null) ?? 0n) : (m.c > 0 ? m.s : null);
    case 'avg':
      if (m.c === 0) return null;
      return money ? divRoundHalfAway(m.s as bigint, BigInt(m.c)) : (m.s as Decimal).divRound(m.c, 2);
    case 'min':
      return m.lo;
    default:
      return m.hi;
  }
}

function output(g: RefGroup, measures: AggregateMeasureSpec[], withKeys: boolean): engine.BudgetListAggregateRow {
  return {
    keys: withKeys ? g.keys : [],
    count: g.n,
    values: Object.fromEntries(measures.map((measure, i) => {
      const v = valueOf(g.m[i], measure);
      return [measure.id, v == null ? null : typeof v === 'bigint' ? centsToNumber(v) : Number(v.toString())];
    })),
    unknown: Object.fromEntries(measures.flatMap((measure, i) => (isMoney(measure.field) ? [] : [[measure.id, g.n - g.m[i].c]]))),
  };
}

/** Where nulls go: as asked; else last for a measure, and PostgreSQL's default for a key (last ascending, first descending). */
function nullsFirst(order: AggregateOrderSpec): boolean {
  if (order.nulls) return order.nulls === 'FIRST';
  return order.by === 'measure' ? false : order.dir === 'DESC';
}

function compareNullable<T>(a: T | null, b: T | null, dir: 'ASC' | 'DESC', first: boolean, cmp: (x: T, y: T) => number): number {
  if (a == null && b == null) return 0;
  if (a == null) return first ? -1 : 1;
  if (b == null) return first ? 1 : -1;
  const c = cmp(a, b);
  return dir === 'ASC' ? c : -c;
}

/** The tie-break order of keys: their text (numbers as numbers), blanks as placed. */
function compareKeyText(a: string | null, b: string | null, field: string, dir: 'ASC' | 'DESC', first: boolean): number {
  if (a === b) return 0;
  return compareNullable(a, b, dir, first, (x, y) => (INT_FIELDS.has(field) ? Number(x) - Number(y) : oracleTextCompare(x, y)));
}

/** An explicit key order: a ranked enum in its rank (the oracle's own lists; a value outside is blank), else the text. */
function compareKeyOrder(a: string | null, b: string | null, field: string, dir: 'ASC' | 'DESC', first: boolean): number {
  const rank = Object.prototype.hasOwnProperty.call(SORT_ORDERS, field) ? SORT_ORDERS[field] : null;
  if (!rank) return compareKeyText(a, b, field, dir, first);
  const ra = a == null || !rank.includes(a) ? null : rank.indexOf(a);
  const rb = b == null || !rank.includes(b) ? null : rank.indexOf(b);
  return compareNullable(ra, rb, dir, first, (x, y) => x - y);
}

/** A decimal written in JavaScript or by `formatCents`/`Decimal` (exponent allowed) as an exact `m × 10^e`. */
function exactDecimal(text: string): { m: bigint; e: number } {
  const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
  if (!match) throw new Error(`not a decimal: ${text}`);
  const [, sign, int, frac = '', exp] = match;
  const m = BigInt(`${int}${frac}` || '0');
  return { m: sign === '-' ? -m : m, e: (exp ? Number(exp) : 0) - frac.length };
}

/** Two decimals compared exactly (no rounding of either), written independently of the engine. */
function compareDecimals(a: string, b: string): number {
  const x = exactDecimal(a);
  const y = exactDecimal(b);
  const e = Math.min(x.e, y.e);
  const xs = x.m * 10n ** BigInt(x.e - e);
  const ys = y.m * 10n ** BigInt(y.e - e);
  return xs < ys ? -1 : xs > ys ? 1 : 0;
}

function referenceAggregate(rows: any[], spec: AggregateSpec): Omit<engine.BudgetListAggregate, 'reportingCurrency'> {
  const buckets = new Map<string, RefGroup>();
  for (const row of rows) {
    const keys = spec.groupBy.map((field) => keyOf(row, field));
    const id = JSON.stringify(keys);
    let g = buckets.get(id);
    if (!g) {
      g = { keys, n: 0, m: spec.measures.map(() => ({ s: null, c: 0, lo: null, hi: null })) };
      buckets.set(id, g);
    }
    g.n += 1;
    spec.measures.forEach((measure, i) => {
      const v = lineValue(row, measure);
      const m = g!.m[i];
      if (v == null) return;
      m.s = add(m.s, v);
      m.c += 1;
      m.lo = pickLow(m.lo, v);
      m.hi = pickHigh(m.hi, v);
    });
  }
  const all = Array.from(buckets.values());
  const kept = all.filter((g) => (spec.having ?? []).every((having) => {
    const i = spec.measures.findIndex((measure) => measure.id === having.measure);
    const v = valueOf(g.m[i], spec.measures[i]);
    if (v == null) return false;
    // The group's exact value against the bound as JavaScript writes it, never rounded to the cent.
    const c = compareDecimals(typeof v === 'bigint' ? formatCents(v) : v.toString(), String(having.value));
    return { gt: c > 0, gte: c >= 0, lt: c < 0, lte: c <= 0, eq: c === 0, ne: c !== 0 }[having.op];
  }));
  const orders: AggregateOrderSpec[] = spec.order?.length ? spec.order : [{ by: 'count', dir: 'DESC' }];
  kept.sort((a, b) => {
    for (const order of orders) {
      let c = 0;
      if (order.by === 'count') c = order.dir === 'ASC' ? a.n - b.n : b.n - a.n;
      else if (order.by === 'key') c = compareKeyOrder(a.keys[order.index!], b.keys[order.index!], spec.groupBy[order.index!], order.dir, nullsFirst(order));
      else {
        const i = spec.measures.findIndex((measure) => measure.id === order.id);
        const va = valueOf(a.m[i], spec.measures[i]);
        const vb = valueOf(b.m[i], spec.measures[i]);
        if (va == null || vb == null) c = va == null && vb == null ? 0 : (va == null) === nullsFirst(order) ? -1 : 1;
        else c = order.dir === 'ASC' ? cmpValues(va, vb) : -cmpValues(va, vb);
      }
      if (c !== 0) return c;
    }
    for (let i = 0; i < spec.groupBy.length; i++) {
      const c = compareKeyText(a.keys[i], b.keys[i], spec.groupBy[i], 'ASC', true);
      if (c !== 0) return c;
    }
    return 0;
  });
  const shown = spec.limit != null ? kept.slice(0, spec.limit) : kept;
  const rest = spec.limit != null ? kept.slice(spec.limit) : [];
  return {
    groups: shown.map((g) => output(g, spec.measures, true)),
    others: spec.others && rest.length ? output(combine(rest, spec.measures), spec.measures, false) : null,
    total: output(combine(all, spec.measures), spec.measures, false),
    groupCount: kept.length,
  };
}

// ----- cases -----

function amountKeys(full: boolean): { money: string[]; fte: string[] } {
  const slots = [...FIXED_SLOTS.map((slot) => slot.key as string), `y${Y + 3}`];
  const money = slots.flatMap((slot, s) => SUMMARY_COLUMNS
    .filter((_, c) => full || slot === 'y' || c === s % SUMMARY_COLUMNS.length)
    .map((column) => `${slot}${column.suffix}`));
  return { money, fte: money.map((key) => `fte_${key}`) };
}

type Sample = Map<string, Array<string | number>>;

function buildCases(r: ReturnType<typeof prng>, scope: SummaryScopeConfig, registry: AiEntityFilterRegistry, sample: Sample, axisIds: string[], sampleRows: any[]): Case[] {
  const entity_type = scope.scope === 'opex' ? 'spend_items' : 'capex_items';
  const cases: Case[] = [];
  const fields = Object.entries(registry.fields);
  const groupable = fields.filter(([, f]) => f.groupable).map(([key]) => key);
  const amountAi = fields.filter(([key, f]) => f.type === 'number' && !key.endsWith('_fte')).map(([key]) => key);
  const fteAi = fields.filter(([key, f]) => f.type === 'number' && key.endsWith('_fte')).map(([key]) => key);
  // CI: the five columns of Y and one column of each other year; a full run every column.
  const yColumns = amountAi.filter((key) => /^y_[a-z]+$/.test(key));
  const amountMatrix = FULL ? amountAi : Array.from(new Set([...yColumns, ...FIXED_SLOTS.filter((s) => s.offset !== 0).map((s, i) => `${s.ai}_${SUMMARY_COLUMNS[(i + 1) % SUMMARY_COLUMNS.length].ai}`)]));
  const fteMatrix = FULL ? fteAi : amountMatrix.map((key) => `${key}_fte`);
  const values = (aiKey: string) => (sample.get(aiKey) ?? []) as Array<string | number>;
  const FNS = ['sum', 'avg', 'min', 'max'];
  const addAi = (id: string, input: Omit<AiInput, 'entity_type'>) => cases.push({ id, kind: 'ai', input: { entity_type, ...input } });

  // Every groupable field: count, the four functions on an amount, one on an FTE.
  for (const group of groupable) {
    addAi(`ai/${group}/count`, { group_by: group, function: 'count' });
    for (const fn of FNS) addAi(`ai/${group}/${fn}`, { group_by: group, function: fn, metric: r.pick(amountMatrix) });
    addAi(`ai/${group}/fte`, { group_by: group, function: r.pick(FNS), metric: r.pick(fteMatrix) });
  }
  // Every amount and FTE column: by currency (each line converted to the cent), by status.
  for (const metric of amountMatrix) addAi(`ai/amount/${metric}`, { group_by: r.pick(['currency', 'currency', 'status']), function: r.pick(FNS), metric });
  for (const metric of fteMatrix) addAi(`ai/fte/${metric}`, { group_by: r.pick(['currency', 'run_build', 'status']), function: r.pick(FNS), metric });

  // One AI filter drawn from the data.
  const filterable = fields.filter(([, f]) => f.type === 'set' || f.type === 'text' || f.type === 'number' || f.type === 'date').map(([key]) => key);
  const withData = filterable.filter((key) => values(key).length > 0);
  const aiFilter = (): [string, any] => {
    const key = r.pick(withData);
    const f = registry.fields[key];
    const v = values(key);
    if (f.type === 'set') {
      const picked = Array.from(new Set([r.pick(v), r.pick(v)])).map(String);
      if (r.chance(0.2)) return [key, { not: picked.slice(0, 1) }];
      return [key, r.chance(0.15) ? [...picked, null] : picked];
    }
    if (f.type === 'text') {
      const text = String(r.pick(v));
      const chars = Array.from(text);
      const at = r.int(0, Math.max(0, chars.length - 3));
      return [key, chars.slice(at, at + r.int(2, 6)).join('') || text];
    }
    if (f.type === 'number') {
      const a = Number(r.pick(v));
      const op = r.pick(['gt', 'gte', 'lt', 'lte', 'eq', 'between']);
      return [key, op === 'between' ? { op, value: Math.min(a, Number(r.pick(v))), valueTo: Math.max(a, Number(r.pick(v))) } : { op, value: a }];
    }
    const day = String(r.pick(v));
    const op = r.pick(['before', 'after', 'eq', 'between']);
    return [key, op === 'between' ? { op, value: `${Y - 2}-01-01`, valueTo: day } : { op, value: day }];
  };
  const qPool = [...values('supplier'), ...values('cost_center_path'), ...values('project_name'), ...values('account'), 'cyber', 'licen', 'en', 'zz-none']
    .flatMap((v) => String(v).split(/[\s·,›]+/)).filter((w) => w.length >= 3 && !/[:=<>]/.test(w));

  for (let k = 0; k < COMBINED; k++) {
    const filters: Record<string, any> = {};
    const n = r.pick([0, 1, 1, 2, 3]);
    for (let i = 0; i < n; i++) {
      const [key, value] = aiFilter();
      filters[key] = value;
    }
    const kind = r.pick(['count', 'count', 'money', 'money', 'money', 'fte']);
    addAi(`ai/combined/${k}`, {
      group_by: r.pick(groupable),
      function: kind === 'count' ? 'count' : r.pick(FNS),
      ...(kind === 'money' ? { metric: r.pick(amountAi) } : kind === 'fte' ? { metric: r.pick(fteAi) } : {}),
      ...(n ? { filters } : {}),
      ...(r.chance(0.25) && qPool.length ? { q: r.pick(qPool) } : {}),
    });
  }

  // Engine specs.
  const { money, fte } = amountKeys(true);
  const groupFields = Array.from(new Set([
    'status', 'currency', 'supplier_name', scope.scope === 'opex' ? 'paying_company_name' : 'company_name', 'account_display', 'owner_it_name',
    'owner_business_name', 'analytics_category_name', ...axisIds.map((id) => `analytics_${id}`), 'cost_center_label', 'cost_center_path',
    'budget_holder_name', 'run_build', 'project_name', 'project_stream_name', 'project_category_name', 'contract_name', 'allocation_method_label',
    'id', 'item_number', 'account_number', 'effective_start', scope.nameField, ...scope.extraFields, 'nonexistent_field',
  ]));
  const gridValues = (field: string) => (sample.get(`grid:${field}`) ?? []) as Array<string | number>;
  // FTE columns holding values on the tenant (most hold none): random FTE measures draw from them first.
  const fteWithData = fteAi.filter((key) => values(key).length > 0).map((key) => registry.fields[key].grid);
  for (let k = 0; k < SPECS; k++) {
    const groupBy = Array.from(new Set(Array.from({ length: r.pick([0, 1, 1, 1, 2, 2, 3, 4, 5, 6]) }, () => r.pick(groupFields))));
    const measures: AggregateMeasureSpec[] = Array.from({ length: r.int(1, 8) }, (_, i) => {
      const onMoney = r.chance(0.75);
      const fteField = fteWithData.length && r.chance(0.7) ? r.pick(fteWithData) : r.pick(fte);
      const measure: AggregateMeasureSpec = { id: `m${i}`, fn: r.pick(['sum', 'sum', 'avg', 'min', 'max']) as AggregateMeasureSpec['fn'], field: onMoney ? r.pick(money) : fteField };
      if (onMoney && r.chance(0.3)) measure.minus = r.pick(money);
      if (onMoney && r.chance(0.2)) measure.part = r.pick(['positive', 'negative']);
      return measure;
    });
    const spec: AggregateSpec = { groupBy, measures };
    if (r.chance(0.35)) {
      // 1 to 3 conditions (AND). Bounds near a line's own value, often between two cents (an exact
      // comparison keeps a group of 1,697,477.00 under `gt 1697476.995`), or constants of every size.
      spec.having = Array.from({ length: r.pick([1, 1, 2, 3]) }, () => {
        const m = r.pick(measures);
        const near = sampleRows.length ? lineValue(r.pick(sampleRows), m) : null;
        const base = near == null ? 0 : typeof near === 'bigint' ? Number(formatCents(near)) : Number(near.toString());
        const value = r.chance(0.6)
          ? base + r.pick([0, 0, 0.005, -0.005, 0.004, -0.004, 0.001, -0.001, 0.0049999])
          : r.pick([0, 0, 100, -50, 1.5, 1000.01, 0.005, -0.004, 1e-7, 2.675, 1e21, -1e21]);
        return { measure: m.id, op: r.pick(['gt', 'gte', 'lt', 'lte', 'ne', 'eq']), value };
      });
    }
    if (r.chance(0.6)) {
      spec.order = Array.from({ length: r.int(1, 2) }, (): AggregateOrderSpec => {
        const by = r.pick(groupBy.length ? ['count', 'measure', 'measure', 'key'] : ['count', 'measure']) as AggregateOrderSpec['by'];
        const order: AggregateOrderSpec = { by, dir: r.pick(['ASC', 'DESC']) };
        if (by === 'measure') order.id = r.pick(measures).id;
        if (by === 'key') order.index = r.int(0, groupBy.length - 1);
        if (r.chance(0.5)) order.nulls = r.pick(['FIRST', 'LAST']);
        return order;
      });
    }
    if (r.chance(0.45)) {
      spec.limit = r.int(1, 8);
      spec.others = r.chance(0.6);
    }
    const query: Record<string, any> = r.pick([{ includeDisabled: 'true' }, { status: 'enabled' }, { status: 'disabled' }, { includeDisabled: 'true' }]);
    const filters: Record<string, any> = {};
    if (r.chance(0.35)) {
      const field = r.pick(['supplier_name', 'cost_center_path', scope.nameField, 'yBudget', 'project_name', 'currency'].filter((f) => gridValues(f).length));
      if (field) {
        const v = gridValues(field);
        if (field === 'yBudget') filters[field] = { filterType: 'number', type: r.pick(['greaterThan', 'lessThan']), filter: Number(r.pick(v)) };
        else if (r.chance(0.5)) filters[field] = { filterType: 'set', ...(r.chance(0.3) ? { mode: 'exclude' } : {}), values: [String(r.pick(v)), String(r.pick(v))] };
        else filters[field] = { filterType: 'text', type: 'contains', filter: Array.from(String(r.pick(v))).slice(0, 3).join('') };
      }
    }
    if (Object.keys(filters).length) query.filters = JSON.stringify(filters);
    if (r.chance(0.15) && qPool.length) query.q = r.pick(qPool);
    cases.push({ id: `spec/${k}`, kind: 'spec', query, spec });
  }
  // Deterministic order cases (no draw from the random stream):
  // - a ranked enum (status, run or build, the CAPEX enums) ordered by its key follows its rank;
  // - with a measure equal on every group (0), the final tie-break decides: the key's text, never the rank;
  // - a measure order without `nulls` puts groups without a value (FTE of unknown lines) last, in both directions.
  const ranked = ['status', 'run_build', ...scope.extraFields];
  const all = { includeDisabled: 'true' };
  for (const key of ranked) {
    for (const dir of ['ASC', 'DESC'] as const) {
      cases.push({ id: `spec/ranked/${key}/${dir}`, kind: 'spec', query: all, spec: { groupBy: [key], measures: [], order: [{ by: 'key', index: 0, dir }] } });
    }
    const zero: AggregateMeasureSpec = { id: 'z', fn: 'sum', field: 'yBudget', minus: 'yBudget' };
    cases.push({ id: `spec/tie/${key}`, kind: 'spec', query: all, spec: { groupBy: [key], measures: [zero], order: [{ by: 'measure', id: 'z', dir: 'DESC' }] } });
    cases.push({ id: `spec/tie2/${key}`, kind: 'spec', query: all, spec: { groupBy: [key, 'currency'], measures: [zero], order: [{ by: 'measure', id: 'z', dir: 'ASC' }] } });
    // The AI: every group ties (the sum of an amount over the lines where it is 0), so its key order decides.
    if (registry.fields[key]?.groupable) {
      for (const metric of ['y_plus2_budget', 'y_minus2_landing']) {
        addAi(`ai/tie/${key}/${metric}`, { group_by: key, function: 'sum', metric, filters: { [metric]: { op: 'eq', value: 0 } } });
      }
    }
  }
  for (const fteField of fteWithData.slice(0, 3)) {
    for (const group of ['supplier_name', 'currency', 'status', 'cost_center_path']) {
      for (const dir of ['ASC', 'DESC'] as const) {
        for (const fn of ['sum', 'max'] as const) {
          cases.push({ id: `spec/nulls/${fteField}/${group}/${fn}/${dir}`, kind: 'spec', query: all, spec: { groupBy: [group], measures: [{ id: 'f', fn, field: fteField }], order: [{ by: 'measure', id: 'f', dir }] } });
        }
      }
    }
  }
  // The default scope is the page's (the window): the aggregate's total equals the page count.
  for (const [i, query] of [{}, { years: String(Y + 1) }, { q: r.pick(qPool.length ? qPool : ['en']) }].entries()) {
    cases.push({ id: `spec/default-scope/${i}`, kind: 'spec', query, spec: { groupBy: ['currency'], measures: [{ id: 'b', fn: 'sum', field: 'yBudget' }] }, checkDefaultScope: true });
  }
  return ONLY ? cases.filter((c) => c.id === ONLY) : cases;
}

// ----- running -----

interface Env {
  scope: SummaryScopeConfig;
  runner: QueryRunner;
  deps: ReturnType<typeof realSummaryDeps>;
  svc: any;
  executor: AiAggregateExecutor;
  registry: AiEntityFilterRegistry;
  context: any;
  rowsOf: (ids: string[]) => Promise<any[]>;
  reportingCurrency: string;
}

async function runAiCase(env: Env, c: Extract<Case, { kind: 'ai' }>): Promise<void> {
  const m = env.runner.manager;
  const label = `[${env.scope.scope} seed ${SEED}] ${c.id} ${JSON.stringify(c.input)}`;
  const e = await settle(env.runner, () => env.executor.execute(env.context, c.input as any));
  const o = await settle(env.runner, async () => {
    // The former executor's budget path: adapted filters, the ids of every line of the state, their rows, grouped.
    const adapted = adaptFilters(env.registry, c.input.filters);
    if (adapted.ignored.length) return { status: 'invalid_filter', groups: [], total: 0 };
    const scoped = await env.svc.summaryIds({ q: c.input.q?.trim(), limit: 10_000, filters: adapted.filters, includeDisabled: true }, { manager: m });
    const fn = c.input.function as any;
    const metric = fn === 'count' ? null : { key: c.input.metric!, def: {} as any };
    const groups = scoped.ids.length ? await aggregateBudgetSummaryByIds(env.rowsOf, env.registry, c.input.group_by, scoped.ids, fn, metric) : [];
    return { status: undefined, groups, total: scoped.total, returned: groups.length, truncated: scoped.ids.length < scoped.total, complete: true, filters_applied: adapted.applied };
  });
  if (failed(label, e, o)) return;
  const actual = e.value.status === 'invalid_filter'
    ? { status: 'invalid_filter', groups: e.value.groups, total: e.value.total }
    : { status: e.value.status, groups: e.value.groups, total: e.value.total, returned: e.value.returned, truncated: e.value.truncated, complete: e.value.complete, filters_applied: e.value.filters_applied };
  if (same(label, actual, o.value)) {
    if (o.value.status === 'invalid_filter') stats.invalidFilter += 1;
    const n = o.value.groups.length;
    stats.groups += n;
    if (n === 0) stats.empty += 1;
    else if (n === 1) stats.oneGroup += 1;
    else stats.several += 1;
  }
}

async function runSpecCase(env: Env, c: Extract<Case, { kind: 'spec' }>): Promise<void> {
  const m = env.runner.manager;
  const label = `[${env.scope.scope} seed ${SEED}] ${c.id} ${JSON.stringify(c.query)} ${JSON.stringify(c.spec)}`;
  const e = await settle(env.runner, () => engine.budgetListAggregate(env.scope, env.deps, c.query, c.spec, m));
  if (c.checkDefaultScope) {
    if (e.error) {
      failures.push(`${label}: ${e.error.message}`);
      return;
    }
    const page = await engine.budgetListPageIds(env.scope, env.deps, { ...c.query, limit: 1 }, m);
    same(`${label} default scope`, e.value.total.count, page.total);
    return;
  }
  const o = await settle(env.runner, async () => {
    const { ids } = await engine.budgetListIds(env.scope, env.deps, c.query, m);
    return referenceAggregate(await env.rowsOf(ids), c.spec);
  });
  if (failed(label, e, o)) return;
  const { reportingCurrency, ...rest } = e.value;
  const moneyRead = c.spec.measures.some((measure) => isMoney(measure.field));
  if (same(label, rest, o.value)) {
    same(`${label} currency`, reportingCurrency, moneyRead ? env.reportingCurrency : null);
    const n = o.value.groups.length;
    stats.groups += n;
    if (n === 0) stats.empty += 1;
    else if (n === 1) stats.oneGroup += 1;
    else stats.several += 1;
  }
}

async function runScope(scope: SummaryScopeConfig, runner: QueryRunner, tenantId: string): Promise<void> {
  const started = Date.now();
  const at = { failures: failures.length, checks: checksRun, bothFailed: stats.bothFailed };
  Object.assign(stats, { groups: 0, empty: 0, oneGroup: 0, several: 0, invalidFilter: 0 });
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const m = runner.manager;
  const deps = realSummaryDeps(scope);
  const svc = itemServiceWith(scope, deps);
  const context = { tenantId, userId: null, isPlatformHost: false, surface: 'chat', authMethod: 'jwt', manager: m };
  const entityType = scope.scope === 'opex' ? 'spend_items' : 'capex_items';
  const registry = await resolveAiEntityRegistry(context as any, entityType);

  // Every line's row, built once (the rows do not depend on the list state), with Y+3 besides the fixed
  // years for the engine specs (the AI reads the fixed years only; an added year changes no fixed slot).
  const all = await svc.summaryIds({ includeDisabled: 'true' }, { manager: m });
  const rowsStarted = Date.now();
  const rows: any[] = await svc.summaryRowsByIds(all.ids, { years: [Y + 3] }, { manager: m });
  const rowsSeconds = ((Date.now() - rowsStarted) / 1000).toFixed(1);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const rowsOf = async (ids: string[]) => ids.map((id) => byId.get(id)).filter(Boolean);
  const { reportingCurrency } = await svc.summaryTotals({ amounts: 'yBudget' }, { manager: m });

  // Values to draw filters from: the AI fields by their grid keys, and a few grid fields.
  const sample: Sample = new Map();
  const sampleRows = rows.slice().sort((a, b) => a.item_number - b.item_number).slice(0, 1000);
  for (const [key, field] of Object.entries(registry.fields)) {
    const seen = new Set<string | number>();
    for (const row of sampleRows) {
      const list = field.type === 'set' || field.type === 'text' ? summaryFieldValues(row, field.grid) : [getSummaryFieldValue(row, field.grid)];
      for (const value of list) {
        if (value == null || value === '') continue;
        if (field.type === 'date') seen.add((value instanceof Date ? value.toISOString() : String(value)).slice(0, 10));
        else seen.add(typeof value === 'number' ? value : String(value));
      }
    }
    sample.set(key, Array.from(seen));
  }
  for (const field of ['supplier_name', 'cost_center_path', scope.nameField, 'yBudget', 'project_name', 'currency']) {
    const seen = new Set<string | number>();
    for (const row of sampleRows) for (const value of summaryFieldValues(row, field)) if (value != null && value !== '') seen.add(value as any);
    sample.set(`grid:${field}`, Array.from(seen));
  }
  const axisRows: Array<{ id: string }> = await m.query(`SELECT id FROM analytics_axes WHERE tenant_id = $1 ORDER BY sort_order, id`, [tenantId]);

  const r = prng(SEED ^ (scope.scope === 'opex' ? 0 : 0x2c1b3c6d));
  const cases = buildCases(r, scope, registry, sample, axisRows.map((a) => a.id), sampleRows);
  const digest = createHash('sha256').update(JSON.stringify(cases)).digest('hex').slice(0, 12);
  const env: Env = { scope, runner, deps, svc, executor: executorFor(scope, svc), registry, context, rowsOf, reportingCurrency };
  for (const c of cases) {
    if (c.kind === 'ai') await runAiCase(env, c);
    else await runSpecCase(env, c);
  }
  const ai = cases.filter((c) => c.kind === 'ai').length;
  console.log(`budget-aggregate-differential (${TENANT_SLUG ?? 'fixture'}, ${scope.scope}, seed ${SEED}${FULL ? ', full' : ''}): ${all.total} lines, ${cases.length} cases (${ai} AI, ${cases.length - ai} engine specs; digest ${digest}), ${checksRun - at.checks} checks, ${failures.length - at.failures} differences, ${stats.bothFailed - at.bothFailed} failed on both sides; groups compared ${stats.groups} (cases with no group ${stats.empty}, one ${stats.oneGroup}, several ${stats.several}; AI filters refused on both sides ${stats.invalidFilter}); rows built in ${rowsSeconds}s, ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
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
    for (const scope of SCOPES) await runScope(scope, runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`budget-aggregate-differential: ${failures.length} differences\n  ${failures.slice(0, 40).join('\n  ')}`);
    process.exit(1);
  }
  console.log('budget-aggregate-differential.integration.spec: ok');
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.message}\n${err.stack?.split('\n').slice(1, 6).join('\n')}` : err);
  process.exit(1);
});
