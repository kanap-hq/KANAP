import 'dotenv/config';
import { createHash } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { FIXED_SLOTS, SUMMARY_COLUMNS, SUMMARY_SCOPES, SummaryScopeConfig } from '../spend-summary.builder';
import { getSummaryFieldValue, summaryFieldValues } from './oracle/summary-field-value.oracle';
import * as engine from '../budget-list/budget-list.service';
import { BudgetSummaryOracle, loadOracleFold } from './oracle/budget-summary.oracle';
import { realSummaryDeps } from './oracle/oracle-deps';
import { prng, seedListFixture } from './oracle/budget-list.fixture';

// Differential test of the SQL list engine (lot 2B, PRs A and C) against its
// oracle, the in-memory engine it replaces (`oracle/budget-summary.oracle.ts`,
// with the decided changes as listed adapters), on the OPEX and the CAPEX
// list. Same lines, same order, same rows, totals to the cent, same filter
// values, same ids.
//
// CI (default): a deterministic fixture seeded in a rolled-back transaction
// (`oracle/budget-list.fixture.ts`), the single-field matrix, every sort, the
// scopes, and seeded combined cases.
// Local, on a loaded tenant (read-only, rolled back):
//   DATABASE_URL=postgres://app:app@localhost:5432/appdb_perf LIST_DIFF_TENANT=perf \
//     npx ts-node src/spend/__tests__/budget-list-differential.integration.spec.ts
// Options: LIST_DIFF_SCOPE (opex or capex; both by default, each with its own
// cases and digest), LIST_DIFF_SEED (cases and fixture), LIST_DIFF_CASES (combined cases),
// LIST_DIFF_PER_OP (needles per field and operator, default 1), LIST_DIFF_MATRIX=0
// (skip the single-field matrix), LIST_DIFF_FULL=1 (every amount and FTE column
// of every slot in the matrix, the default on a loaded tenant; CI reads the five
// columns of Y and one column of each other slot), LIST_DIFF_ONLY=<case id>
// (replay one case, as printed on failure).
// Deterministic: the fixture's ids and every needle come from the seed, so one
// seed gives the same cases (see the digest on the summary line), checks and
// results on every run.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

const SEED = Number(process.env.LIST_DIFF_SEED ?? 20261002);
const TENANT_SLUG = process.env.LIST_DIFF_TENANT || null;
const COMBINED = Number(process.env.LIST_DIFF_CASES ?? (TENANT_SLUG ? 300 : 120));
const MATRIX = process.env.LIST_DIFF_MATRIX !== '0';
/** Needles per field and operator in the matrix (CI: 1, about 2,500 cases; 3 for a deep local run). */
const PER_OP = Math.max(1, Number(process.env.LIST_DIFF_PER_OP ?? 1));
const ONLY = process.env.LIST_DIFF_ONLY ?? null;
const FULL = process.env.LIST_DIFF_FULL === '1' || (process.env.LIST_DIFF_FULL !== '0' && !!TENANT_SLUG);
/** A dimension id no tenant has (fixed, so the case id is the same every run). */
const UNKNOWN_AXIS = '00000000-0000-4000-8000-00000000d1ff';
const Y = new Date().getFullYear();
const SCOPES: SummaryScopeConfig[] = (process.env.LIST_DIFF_SCOPE ?? 'opex,capex')
  .split(',')
  .map((key) => {
    const config = (SUMMARY_SCOPES as Record<string, SummaryScopeConfig>)[key.trim()];
    if (!config) throw new Error(`LIST_DIFF_SCOPE: unknown list ${key}`);
    return config;
  });
const ROW_OPTIONS = { includeRecipientDetails: true, includeNextYearAllocation: true };

type Query = Record<string, any>;
type Check = 'ids' | 'fv' | 'full' | 'grid' | 'neighbors';
interface Case { id: string; query: Query; checks: Check[]; fvFields?: string[] }

const failures: string[] = [];
const timing = { engine: 0, oracle: 0 };
/** How many id checks of a filtered case (a column filter or a quick search) selected no line, every line, or some: mostly some. */
const selectivity = { empty: 0, every: 0, some: 0 };
/** Id checks selecting no line, per operator or edge (the part of the case id after the field). */
const emptyByKind = new Map<string, number>();
let checksRun = 0;
/** Checks where both sides failed (the same request error on both): counted and listed, not compared. */
const bothFailedChecks: string[] = [];

function same(label: string, actual: unknown, expected: unknown): boolean {
  checksRun += 1;
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) return true;
  let at = 0;
  while (at < a.length && a[at] === b[at]) at += 1;
  failures.push(`${label}\n      engine: …${a.slice(Math.max(0, at - 120), at + 200)}\n      oracle: …${b.slice(Math.max(0, at - 120), at + 200)}`);
  return false;
}

/** Keys sorted at every level (arrays keep their order): two rows with the same keys and values compare equal. */
function deepSorted(value: any): any {
  if (Array.isArray(value)) return value.map(deepSorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, deepSorted(value[key])]));
  return value;
}

// The grid shape of a row (lot 2B, PR B2): what each list's grid reads (OpexListPage.tsx,
// CapexPage.tsx), nothing else; listed here apart from the builder's own lists.
const GRID_ITEM_KEYS: Record<SummaryScopeConfig['scope'], string[]> = {
  opex: ['id', 'item_number', 'product_name', 'description', 'status', 'currency', 'effective_start', 'disabled_at', 'notes', 'created_at', 'updated_at'],
  capex: [
    'id', 'item_number', 'description', 'ppe_type', 'investment_type', 'priority', 'status', 'currency', 'effective_start', 'disabled_at',
    'notes', 'created_at', 'updated_at',
  ],
};
const GRID_DERIVED_KEYS = [
  'cost_center_id', 'run_build', 'latest_contract_id', 'latest_contract_name', 'supplier_name', 'paying_company_name', 'account_display',
  'allocation_method_label', 'owner_it_name', 'owner_business_name', 'cost_center_label', 'cost_center_path', 'budget_holder_name',
  'project_name', 'analytics_category_name',
];
const GRID_SLOTS = ['yMinus1', 'y', 'yPlus1', 'yPlus2'];

function sortedObject(value: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key] && typeof value[key] === 'object' && !Array.isArray(value[key]) ? sortedObject(value[key]) : value[key]]));
}

// ----- fields -----

function fieldCatalogue(scope: SummaryScopeConfig, axisIds: string[]) {
  const slots = [...FIXED_SLOTS.map((slot) => slot.key as string), `y${Y + 3}`];
  // Every column of every slot compiles the same way: CI reads the five columns of Y and one column
  // (a different one each) of every other slot; a full run reads them all.
  const money = slots.flatMap((slot, s) => SUMMARY_COLUMNS
    .filter((_, c) => FULL || slot === 'y' || c === s % SUMMARY_COLUMNS.length)
    .map((column) => `${slot}${column.suffix}`));
  return {
    // The name field first (OPEX `product_name`; the CAPEX name is `description`), the type's own enums last.
    text: [
      ...(scope.nameField === 'description' ? [] : [scope.nameField]), 'description', 'notes', 'currency', 'supplier_name', 'paying_company_name', 'company_name', 'account_display', 'account_name',
      'account_warning', 'owner_it_name', 'owner_business_name', 'analytics_category_name', ...axisIds.map((id) => `analytics_${id}`), 'cost_center_code',
      'cost_center_name', 'cost_center_label', 'cost_center_path', 'budget_holder_name', 'contract_name', 'latest_contract_name', 'latest_task_text',
      'allocation_label', 'allocation_method_label', 'next_year_allocation_method_label', 'spread_mode_for_y', 'run_build',
      ...scope.extraFields,
    ],
    uuid: ['id', 'supplier_id', 'owner_it_id', 'cost_center_id', 'project_id', 'analytics_category_id', 'budget_holder_id', 'latest_contract_id',
      ...(scope.scope === 'opex' ? ['contract_id'] : []), 'account_id'],
    multi: ['project_name', 'project_stream_name', 'project_category_name'],
    int: ['item_number', 'account_number'],
    money,
    fte: money.map((key) => `fte_${key}`),
    date: ['effective_start', 'created_at', 'updated_at'],
    // CAPEX also gets the OPEX-only columns, keys its rows do not hold.
    unknown: ['nonexistent_field', `analytics_${UNKNOWN_AXIS}`, 'constructor', '__proto__', ...(scope.scope === 'capex' ? ['product_name', 'contract_id'] : [])],
  };
}

// ----- needles -----

const flipCase = (text: string) => Array.from(text, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('');
const stripAccents = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Three needles in four should select some lines (the matrix checks semantics, not only edges). */
const HIT = 0.75;

/**
 * A needle drawn from one of the field's values, for a text operator: most
 * are forms of the value the operator can match (the whole value in another
 * case or without accents for equals, its start for startsWith, its end for
 * endsWith, any part for contains), the rest an edge (`%`, `_`, `\\`, a
 * space, a padded value, a needle no line holds).
 */
function textNeedle(r: ReturnType<typeof prng>, values: string[], type = 'contains', hit = HIT): string {
  const v = values.length ? r.pick(values) : 'x';
  const chars = Array.from(v);
  const cut = Math.max(1, Math.min(chars.length, r.int(1, 4)));
  const whole = [v, flipCase(v), stripAccents(v), stripAccents(v).toUpperCase()];
  const start = chars.slice(0, cut).join('');
  const end = chars.slice(-cut).join('');
  const middle = chars.slice(1, 1 + cut).join('') || v;
  const forms = type === 'equals' || type === 'notEqual' ? whole
    : type === 'startsWith' ? [start, flipCase(start), stripAccents(start), v]
      : type === 'endsWith' ? [end, flipCase(end), stripAccents(end), v]
        : [start, end, middle, ...whole];
  const edges = ['%', '_', '\\', ' ', `  ${v}`, 'zz-none'];
  return r.chance(hit) ? r.pick(forms) : r.pick(edges);
}

// ----- the cases -----

function buildCases(r: ReturnType<typeof prng>, sample: Map<string, any[]>, axisIds: string[], scope: SummaryScopeConfig): Case[] {
  const fields = fieldCatalogue(scope, axisIds);
  const ref = scope.refPrefix;
  const fvAllowed = [...engine.FILTER_VALUE_FIELDS, ...scope.extraFields];
  const cases: Case[] = [];
  const add = (id: string, query: Query, checks: Check[] = ['ids'], fvFields?: string[]) => cases.push({ id, query, checks, ...(fvFields ? { fvFields } : {}) });
  const all = { includeDisabled: 'true' };
  const f = (model: Record<string, unknown>) => JSON.stringify(model);
  const textValues = (field: string) => (sample.get(field) ?? []).filter((v) => v != null && v !== '').map(String);
  // A field the tenant holds no value for (on the perf tenant: FTE, project and contract ids…) reads as
  // blank on every line: a few cases cover it, the operator matrix would only select no line.
  const hasData = (field: string) => textValues(field).length > 0;
  const TEXT_OPS = ['contains', 'notContains', 'equals', 'notEqual', 'startsWith', 'endsWith', 'unknownOperator'];
  const NUMBER_OPS = ['equals', 'notEqual', 'lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual', 'inRange'];

  if (MATRIX) {
    // Text-like fields: set (include and exclude), blank, the text operators, wrong-kind models.
    for (const field of [...fields.text, ...fields.uuid, ...fields.multi, ...fields.unknown]) {
      const values = textValues(field);
      if (!values.length && !fields.unknown.includes(field)) {
        for (const [i, model] of [{ filterType: 'set', values: [null] }, { filterType: 'set', mode: 'exclude', values: [null] }, { filterType: 'text', type: 'notContains', filter: 'a' }].entries()) {
          add(`${field}/empty${i}`, { ...all, filters: f({ [field]: model }) }, ['ids', 'fv'], [field]);
        }
        continue;
      }
      const v = values.length ? values : ['none'];
      const pick3 = [r.pick(v), r.pick(v), r.pick(v)];
      // Values that select lines, then two of the edges (each edge still runs on many fields).
      const edges: Array<[string, unknown[]]> = [['blankMarker', [null]], ['none', []], ['otherCase', [flipCase(v[0])]], ['emptyString', ['']], ['joinedText', ['a, b']]];
      const first = r.int(0, edges.length - 1);
      const second = (first + r.int(1, edges.length - 1)) % edges.length;
      const sets: Array<[string, unknown[]]> = [['one', [v[0]]], ['three', pick3], ['oneAndBlank', [v[0], null]], edges[first], edges[second]];
      if (fields.multi.includes(field)) {
        const joined = (sample.get(`${field}#joined`) ?? []).filter(Boolean);
        if (joined.length) sets.push(['joinedValue', [r.pick(joined)]]);
      }
      sets.forEach(([name, values]) => add(`${field}/set-${name}`, { ...all, filters: f({ [field]: { filterType: 'set', values } }) }, ['ids', 'fv'], [field]));
      [[v[0]], [v[0], null], [], [null], pick3].forEach((values, i) => add(`${field}/exclude${i}`, { ...all, filters: f({ [field]: { filterType: 'set', mode: 'exclude', values } }) }, ['ids', 'fv'], [field]));
      add(`${field}/blank`, { ...all, filters: f({ [field]: { filterType: 'text', type: 'blank' } }) });
      add(`${field}/notBlank`, { ...all, filters: f({ [field]: { filterType: 'text', type: 'notBlank' } }) });
      for (const type of TEXT_OPS) {
        for (let k = 0; k < PER_OP; k++) add(`${field}/${type}${k}`, { ...all, filters: f({ [field]: { filterType: 'text', type, filter: textNeedle(r, values, type) } }) });
      }
      // Models of another kind match no line (A5): on about a third of the fields.
      if (r.chance(0.35)) add(`${field}/numberModel`, { ...all, filters: f({ [field]: { filterType: 'number', type: 'greaterThan', filter: 1 } }) });
      if (r.chance(0.35)) add(`${field}/dateModel`, { ...all, filters: f({ [field]: { filterType: 'date', type: 'greaterThan', dateFrom: '2020-01-01' } }) });
    }
    // Numbers: number operators, the implicit numeric path, text operators, blank, set.
    for (const field of [...fields.int, ...fields.money, ...fields.fte]) {
      const values = (sample.get(field) ?? []).filter((v) => typeof v === 'number') as number[];
      if (!values.length) {
        for (const [i, model] of [{ filterType: 'number', type: 'blank' }, { filterType: 'number', type: 'greaterThan', filter: 0 }, { filterType: 'set', values: ['0', null] }].entries()) {
          add(`${field}/empty${i}`, { ...all, filters: f({ [field]: model }) });
        }
        continue;
      }
      const v = values.length ? values : [0];
      const a = r.pick(v);
      const b = r.pick(v);
      const near = [a, a + 0.01, a - 0.01, String(a)];
      const edges: unknown[] = [0, -10, 'abc', 'Infinity', `${a}`.replace('.', ',')];
      for (const type of NUMBER_OPS) {
        for (let k = 0; k < PER_OP + (type === 'inRange' ? 1 : 0); k++) {
          const filter = r.chance(HIT) ? r.pick(near) : r.pick(edges);
          const model: Record<string, unknown> = { filterType: 'number', type, filter };
          if (type === 'inRange') { model.filter = Math.min(a, b); model.filterTo = k === PER_OP ? undefined : Math.max(a, b); }
          add(`${field}/${type}${k}`, { ...all, filters: f({ [field]: model }) });
        }
      }
      add(`${field}/implicitEquals`, { ...all, filters: f({ [field]: { filterType: 'text', type: 'equals', filter: String(a) } }) });
      add(`${field}/implicitNotEqual`, { ...all, filters: f({ [field]: { type: 'notEqual', filter: String(b) } }) });
      add(`${field}/contains`, { ...all, filters: f({ [field]: { filterType: 'text', type: 'contains', filter: String(a).slice(0, 2) } }) });
      add(`${field}/${ref}`, { ...all, filters: f({ [field]: { filterType: 'text', type: r.pick(TEXT_OPS), filter: r.pick([`${ref}-1`, `${ref.toUpperCase()}-12`, `${ref}-`, '-1']) } }) });
      add(`${field}/blank`, { ...all, filters: f({ [field]: { filterType: 'number', type: 'blank' } }) });
      add(`${field}/notBlank`, { ...all, filters: f({ [field]: { filterType: 'number', type: 'notBlank' } }) });
      add(`${field}/set`, { ...all, filters: f({ [field]: { filterType: 'set', values: [String(a), String(b), null] } }) });
      if (r.chance(0.35)) add(`${field}/dateModel`, { ...all, filters: f({ [field]: { filterType: 'date', type: 'equals', dateFrom: '2026-01-01' } }) });
    }
    // Dates: the date operators with existing and absent days, missing and malformed bounds; text operators; blank.
    for (const field of fields.date) {
      const days = (sample.get(field) ?? []).filter(Boolean).map((v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10));
      const d = days.length ? days : ['2026-01-01'];
      const sampledDays = [r.pick(d), r.pick(d), `${r.pick(d)} 00:00:00`];
      const edges: unknown[] = ['1999-05-05', '', 'abc', '2026/03/01', '2026-13-45', null];
      const bound = () => (r.chance(HIT) ? r.pick(sampledDays) : r.pick(edges));
      for (const type of NUMBER_OPS) {
        for (let k = 0; k < PER_OP + 1; k++) {
          const model: Record<string, unknown> = { filterType: 'date', type, dateFrom: bound() };
          if (type === 'inRange') model.dateTo = k === PER_OP ? null : bound();
          add(`${field}/${type}${k}`, { ...all, filters: f({ [field]: model }) });
        }
      }
      add(`${field}/noBound`, { ...all, filters: f({ [field]: { filterType: 'date', type: 'equals' } }) });
      add(`${field}/contains`, { ...all, filters: f({ [field]: { filterType: 'text', type: 'contains', filter: r.pick(d).slice(0, 7) } }) });
      add(`${field}/containsT`, { ...all, filters: f({ [field]: { filterType: 'text', type: 'contains', filter: 'T' } }) });
      add(`${field}/blank`, { ...all, filters: f({ [field]: { filterType: 'date', type: 'blank' } }) });
      add(`${field}/set`, { ...all, filters: f({ [field]: { filterType: 'set', values: [r.pick(d), null] } }) });
      add(`${field}/numberModel`, { ...all, filters: f({ [field]: { filterType: 'number', type: 'greaterThan', filter: 0 } }) });
    }
    // The quick search: needles from every entry of the bag (each dimension, accounts, owners, cost centres,
    // contracts, projects, allocation labels, references), whole, partial, case-flipped and without accents.
    const bagFields = Array.from(new Set([
      scope.nameField, 'description', 'notes', 'currency', 'supplier_name', 'paying_company_name', 'account_display', 'account_name',
      'owner_it_name', 'owner_business_name', 'analytics_category_name', ...axisIds.map((id) => `analytics_${id}`), 'cost_center_code',
      'cost_center_name', 'cost_center_path', 'budget_holder_name', 'contract_name', 'project_name', 'project_stream_name',
      'project_category_name', 'allocation_method_label', 'item_number', 'status', 'cost_center_label', 'latest_task_text',
      ...scope.extraFields,
    ]));
    for (const field of bagFields) {
      const values = field === 'item_number'
        ? (sample.get('item_number') ?? []).flatMap((n) => [String(n), `${ref}-${n}`, `${ref.toUpperCase()}-${n}`])
        : [...textValues(field), ...(sample.get(`${field}#joined`) ?? [])];
      if (!values.length) continue;
      for (let k = 0; k < PER_OP; k++) {
        const v = String(r.pick(values));
        const chars = Array.from(v);
        const part = chars.slice(Math.floor(chars.length / 3), Math.floor(chars.length / 3) + 4).join('') || v;
        for (const [i, q] of [v, part, flipCase(v), stripAccents(part)].entries()) {
          add(`q/${field}/${k}.${i}`, { ...all, q, sort: 'item_number:ASC' }, i === 0 && k === 0 ? ['ids', 'fv'] : ['ids'], ['supplier_name', 'project_name']);
        }
      }
    }
    // Needles holding U+001F, the separator of the entries the engine reads as one text: never across two entries.
    const firstNumber = (sample.get('item_number') ?? [1])[0];
    for (const [i, q] of ['\u001f', `${firstNumber}\u001f${ref}-${firstNumber}`, `${firstNumber}\u001f`, `a\u001fb`].entries()) {
      add(`q/separator/${i}`, { ...all, q, sort: 'item_number:ASC' });
    }
    // Combined models: every condition applies.
    for (let k = 0; k < 12; k++) {
      const field = r.pick([...fields.text, ...fields.money, ...fields.date]);
      const isMoney = fields.money.includes(field);
      const isDate = fields.date.includes(field);
      const values = textValues(field);
      const cond = () => (isMoney
        ? { filterType: 'number', type: r.pick(['greaterThan', 'lessThan']), filter: r.pick([0, 100, 1000, -5]) }
        : isDate
          ? { filterType: 'date', type: r.pick(['greaterThan', 'lessThan']), dateFrom: `${r.int(2019, Y + 1)}-06-01` }
          : { filterType: 'text', type: r.pick(['contains', 'notContains']), filter: textNeedle(r, values) });
      add(`combined${k}/${field}`, { ...all, filters: f({ [field]: { filterType: 'text', operator: r.pick(['AND', 'OR']), conditions: [cond(), cond()] } }) });
    }
    // Every sortable field, both directions.
    const sortable = [...fields.text, ...fields.uuid, ...fields.multi, ...fields.int, ...fields.money, ...fields.fte, ...fields.date, ...fields.unknown, 'status', 'disabled_at', ''];
    for (const field of sortable) for (const dir of ['ASC', 'DESC']) add(`sort/${field}:${dir}`, { ...all, sort: `${field}:${dir}` });
    // Lifecycle scopes, the status filter and the end-of-validity filter.
    const statusModels: unknown[] = [
      { filterType: 'set', values: ['enabled'] }, { filterType: 'set', values: ['disabled'] }, { filterType: 'set', values: ['enabled', 'disabled'] },
      { filterType: 'set', values: [] }, { filterType: 'set', mode: 'exclude', values: ['disabled'] }, { filterType: 'set', mode: 'exclude', values: ['enabled', 'disabled'] },
      { filterType: 'set', mode: 'exclude', values: [] }, { filterType: 'text', type: 'equals', filter: 'disabled' },
    ];
    statusModels.forEach((model, i) => {
      add(`status/model${i}`, { filters: f({ status: model }) }, ['ids', 'fv'], ['supplier_name']);
      add(`status/model${i}/all`, { ...all, filters: f({ status: model }) });
    });
    for (const status of ['enabled', 'disabled', undefined]) {
      for (const years of [undefined, String(Y + 2), `${Y - 1},${Y + 1}`]) {
        add(`scope/${status ?? 'default'}/${years ?? '-'}`, { ...(status ? { status } : {}), ...(years ? { years } : {}) }, ['ids', 'full'], ['supplier_name', 'currency']);
      }
    }
    const eov = (type: string, day: string) => ({ filterType: 'date', type, dateFrom: day });
    for (const operator of ['AND', 'OR']) {
      add(`eov/${operator}`, { ...all, filters: f({ disabled_at: { filterType: 'date', operator, conditions: [eov('greaterThan', `${Y - 2}-01-01`), eov('lessThan', `${Y}-06-01`)] } }) }, ['ids', 'full'], ['supplier_name']);
    }
    add('eov/blank', { ...all, filters: f({ disabled_at: { filterType: 'date', type: 'blank' } }) });
    add('eov/text-ignored', { ...all, filters: f({ disabled_at: { filterType: 'text', type: 'contains', filter: '2026' } }) });
    // The Ref column with the list's own reference (`opx-N`, `cpx-N`), every text operator, no draw from
    // the case stream (the cases above and the combined ones below stay those of earlier runs).
    const refNumber = (sample.get('item_number') ?? [1])[0];
    for (const type of TEXT_OPS.slice(0, 6)) {
      for (const [i, needle] of [`${ref}-${refNumber}`, `${ref.toUpperCase()}-${refNumber}`, `${ref}-`].entries()) {
        add(`item_number/ref-${type}${i}`, { ...all, filters: f({ item_number: { filterType: 'text', type, filter: needle } }) });
      }
    }
  }

  // Seeded combined states: 1 to 3 filters, maybe a quick search, a sort, a scope, maybe years and FTE keys.
  const filterable = [...fields.text, ...fields.uuid, ...fields.multi, ...fields.int, ...fields.money, ...fields.fte, ...fields.date];
  const sortable = [...filterable, 'status', 'disabled_at'];
  const filterableWithData = filterable.filter(hasData);
  const qPool = [...textValues(scope.nameField), ...textValues('supplier_name'), ...textValues('cost_center_path'), ...textValues('project_name'),
    ...textValues('analytics_category_name'), ...axisIds.flatMap((id) => textValues(`analytics_${id}`)), ...textValues('owner_it_name'),
    ...textValues('account_display'), ...textValues('contract_name'),
    'cyber', 'Électricité', 'electricite', `${ref}-1`, '12', 'headcount', 'company', 'en', 'able', '%', '_', 'zz-none', 'ete', 'été'];
  for (let k = 0; k < COMBINED; k++) {
    const filters: Record<string, unknown> = {};
    const count = r.pick([1, 1, 2, 2, 3]);
    for (let n = 0; n < count; n++) {
      const field = r.pick(filterableWithData);
      const values = textValues(field);
      // Combinations, not edges (the single-field matrix has them): needles that match, and after the
      // first filter broad ones (a range, values excluded, a short needle). Narrow filters ANDed on
      // 5,000 lines select nothing, which compares little.
      const broad = n > 0;
      if (fields.money.includes(field) || fields.fte.includes(field) || fields.int.includes(field)) {
        const nums = (sample.get(field) ?? []).filter((v) => typeof v === 'number') as number[];
        const type = r.pick(['lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual', ...(broad ? [] : ['notEqual'])]);
        filters[field] = !broad && r.chance(0.15) ? { filterType: 'number', type: r.pick(['blank', 'notBlank']) } : { filterType: 'number', type, filter: nums.length ? r.pick(nums) : 0 };
      } else if (fields.date.includes(field)) {
        filters[field] = { filterType: 'date', type: r.pick(broad ? ['greaterThan', 'lessThan'] : ['greaterThan', 'lessThan', 'equals']), dateFrom: `${r.int(2019, Y + 1)}-${String(r.int(1, 12)).padStart(2, '0')}-15` };
      } else if (r.chance(0.5) && values.length) {
        const chosen = Array.from(new Set([r.pick(values), r.pick(values), ...(r.chance(0.3) ? [null] : [])]));
        filters[field] = { filterType: 'set', ...(broad || r.chance(0.25) ? { mode: 'exclude' } : {}), values: chosen };
      } else if (broad) {
        filters[field] = { filterType: 'text', type: r.pick(['contains', 'notContains']), filter: Array.from(r.pick(values.length ? values : ['a']))[0] };
      } else {
        const type = r.pick(TEXT_OPS.slice(0, 6));
        filters[field] = { filterType: 'text', type, filter: textNeedle(r, values, type, 1) };
      }
    }
    const status = r.pick(['enabled', 'enabled', 'disabled', undefined, 'all']);
    const query: Query = {
      sort: `${r.pick(sortable)}:${r.pick(['ASC', 'DESC'])}`,
      limit: r.pick([10, 25, 50]),
      ...(status === 'all' ? { includeDisabled: 'true' } : status ? { status } : {}),
      // One word of a value (a whole name selects one line, which no other filter then keeps).
      ...(r.chance(0.3) ? { q: r.pick(r.pick(qPool).split(/[\s·,]+/).filter((word) => word.length >= 3).concat(['en'])) } : {}),
      ...(r.chance(0.3) ? { years: r.pick([`${Y + 3}`, `${Y - 1},${Y}`, `${Y + 1}`]) } : {}),
      ...(r.chance(0.4) ? { fte: r.pick([`fte_yBudget,fte_yPlus1Forecast`, `fte_y${Y + 3}Budget,fte_yRevision`, 'fte_nothing']) } : {}),
      filters: f(filters),
    };
    const fvFields = [r.pick(fvAllowed), r.pick(fvAllowed), ...Object.keys(filters).filter((key) => fvAllowed.includes(key))];
    const checks: Check[] = ['ids', 'full'];
    if (k % 5 === 0) checks.push('grid');
    if (k % 3 === 0) checks.push('neighbors');
    add(`combined/${k}`, query, checks, Array.from(new Set(fvFields)));
  }
  return ONLY ? cases.filter((c) => c.id === ONLY) : cases;
}

// ----- running a case -----

interface Engines {
  scope: SummaryScopeConfig;
  oracle: BudgetSummaryOracle;
  runner: QueryRunner;
  /** Lines of the tenant, every status. */
  lineCount: number;
  /** `analytics_<id>` of the dimensions the grid builds a column for (enabled, not the default one). */
  gridAxisKeys: string[];
}

async function runCase(env: Engines, c: Case, deps: ReturnType<typeof realSummaryDeps>): Promise<void> {
  const m = env.runner.manager;
  const scope = env.scope;
  const label = (what: string) => `[${scope.scope} seed ${SEED}] ${c.id} ${what} ${JSON.stringify(c.query)}`;
  await env.runner.query('SAVEPOINT diff_case');
  try {
    if (c.checks.includes('ids')) {
      const [e, o] = await settle(() => engine.budgetListIds(scope, deps, c.query, m), () => env.oracle.summaryIds(c.query), env.runner);
      if (!bothFailed(label('ids'), e, o) && same(label('ids'), e.value, o.value)) {
        const n = (o.value as any).total as number;
        const filtered = !!c.query.q || (!!c.query.filters && c.query.filters !== '{}');
        if (filtered) selectivity[n === 0 ? 'empty' : n === env.lineCount ? 'every' : 'some'] += 1;
        if (filtered && n === 0) {
          const kind = /^(combined|q)\//.test(c.id) ? c.id.split('/')[0] : c.id.split('/').slice(-1)[0].replace(/\d+(\.\d+)?$/, '');
          emptyByKind.set(kind, (emptyByKind.get(kind) ?? 0) + 1);
        }
      }
    }
    if (c.checks.includes('fv') || (c.checks.includes('full') && c.fvFields?.length)) {
      const query = { ...c.query, fields: (c.fvFields ?? []).join(',') };
      const [e, o] = await settle(() => engine.budgetListFilterValues(scope, deps, query, m), () => env.oracle.summaryFilterValues(query, engine.FILTER_VALUE_FIELDS), env.runner);
      if (!bothFailed(label('filter values'), e, o)) same(label('filter values'), e.value, o.value);
    }
    if (c.checks.includes('full')) {
      const [e, o] = await settle(
        () => engine.budgetListSummary(scope, deps, c.query, m, ROW_OPTIONS),
        () => env.oracle.summary(c.query),
        env.runner,
      );
      if (!bothFailed(label('page'), e, o)) {
        const ev = e.value as any;
        const ov = o.value as any;
        same(label('page total'), ev?.total, ov?.total);
        same(label('page 1 ids'), ev?.items?.map((row: any) => row.id), ov?.items?.map((row: any) => row.id));
        same(label('page 1 rows'), ev?.items, ov?.items);
        if (ov?.total > 0) {
          const limit = Number(c.query.limit ?? 20);
          const lastPage = Math.max(1, Math.ceil(ov.total / limit));
          for (const page of Array.from(new Set([Math.ceil(lastPage / 2), lastPage, lastPage + 1]))) {
            const pageIds = await engine.budgetListPageIds(scope, deps, { ...c.query, page }, m);
            same(label(`page ${page} ids`), pageIds.ids, ov.ids.slice((page - 1) * limit, page * limit));
            same(label(`page ${page} total`), pageIds.total, ov.total);
          }
        }
      }
      const [et, ot] = await settle(() => engine.budgetListTotals(scope, deps, c.query, m), () => env.oracle.summaryTotals(c.query), env.runner);
      if (!bothFailed(label('totals'), et, ot)) same(label('totals'), et.value && sortedObject(et.value as any), ot.value && sortedObject(ot.value as any));
    }
    if (c.checks.includes('grid')) {
      const grid = await engine.budgetListSummary(scope, deps, { ...c.query, shape: 'grid' }, m, ROW_OPTIONS);
      const full = await env.oracle.summary(c.query);
      const fteKeys = engine.parseFteKeys(c.query.fte, Y).map((k) => k.key);
      // The keys the list's grid reads, picked from the full row.
      const expected = full.items.map((row: any) => {
        const lean: any = {};
        for (const key of [...GRID_ITEM_KEYS[scope.scope], ...GRID_DERIVED_KEYS, ...env.gridAxisKeys]) if (row[key] !== undefined) lean[key] = row[key];
        if (row.latest_task !== undefined) lean.latest_task = row.latest_task ? { title: row.latest_task.title } : null;
        lean.versions = Object.fromEntries(GRID_SLOTS.map((slot) => {
          const v = row.versions[slot];
          const shown = v?.reporting ?? v?.totals;
          return [slot, v?.version_id ? { reporting: Object.fromEntries(SUMMARY_COLUMNS.map((col) => [col.key, shown[col.key]])) } : {}];
        }));
        for (const key of fteKeys) if (key in row) lean[key] = row[key];
        return lean;
      });
      same(label('grid rows'), deepSorted(JSON.parse(JSON.stringify(grid.items))), deepSorted(JSON.parse(JSON.stringify(expected))));
    }
    if (c.checks.includes('neighbors')) {
      const { ids } = await env.oracle.summaryIds(c.query);
      const pick = ids.length ? ids[Math.floor(ids.length / 3)] : UNKNOWN_AXIS;
      const n = await engine.budgetListNeighbors(scope, deps, c.query, pick, m);
      const index = ids.indexOf(pick);
      same(label('neighbors'), n, index < 0
        ? { index: null, total: ids.length, prev: null, next: null }
        : { index, total: ids.length, prev: neighbor(ids, index - 1, env), next: neighbor(ids, index + 1, env) });
    }
  } finally {
    await env.runner.query('RELEASE SAVEPOINT diff_case').catch(() => undefined);
  }
}

const itemNumbers = new Map<string, number>();
function neighbor(ids: string[], index: number, _env: Engines) {
  if (index < 0 || index >= ids.length) return null;
  return { id: ids[index], item_number: itemNumbers.get(ids[index]) };
}

type Settled = { value?: unknown; error?: Error };
/** Both sides failed (listed, not compared), or one only (a difference); false when both answered. */
function bothFailed(label: string, e: Settled, o: Settled): boolean {
  if (e.error && o.error) {
    bothFailedChecks.push(`${label}\n      engine: ${e.error.message.slice(0, 160)}\n      oracle: ${o.error.message.slice(0, 160)}`);
    return true;
  }
  if (e.error || o.error) {
    checksRun += 1;
    failures.push(`${label}: one side failed: engine=${e.error?.message ?? 'ok'} oracle=${o.error?.message ?? 'ok'}`);
    return true;
  }
  return false;
}

/** Runs both sides, each under its own savepoint (a SQL error aborts only its side). */
async function settle(e: () => Promise<unknown>, o: () => Promise<unknown>, runner: QueryRunner): Promise<[Settled, Settled]> {
  const one = async (fn: () => Promise<unknown>, side: 'engine' | 'oracle'): Promise<Settled> => {
    await runner.query('SAVEPOINT diff_side');
    const started = Date.now();
    try {
      const value = await fn();
      timing[side] += Date.now() - started;
      await runner.query('RELEASE SAVEPOINT diff_side');
      return { value };
    } catch (error) {
      await runner.query('ROLLBACK TO SAVEPOINT diff_side');
      return { error: error as Error };
    }
  };
  return [await one(e, 'engine'), await one(o, 'oracle')];
}

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    let tenantId: string;
    let emptyTenantId: string | null = null;
    if (TENANT_SLUG) {
      const [tenant] = await runner.query(`SELECT id FROM tenants WHERE slug = $1`, [TENANT_SLUG]);
      if (!tenant) throw new Error(`No tenant ${TENANT_SLUG}`);
      tenantId = tenant.id;
    } else {
      const fixture = await seedListFixture(runner, SEED);
      tenantId = fixture.tenantId;
      emptyTenantId = fixture.emptyTenantId;
    }
    const fold = await loadOracleFold(runner.manager);
    for (const scope of SCOPES) await runScope(scope, runner, fold, tenantId, emptyTenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`budget-list-differential: ${failures.length} differences\n  ${failures.slice(0, 40).join('\n  ')}`);
    process.exit(1);
  }
  console.log('budget-list-differential.integration.spec: ok');
}

/** Every case of one list (OPEX or CAPEX), drawn from its own sample, and its summary line. */
async function runScope(
  scope: SummaryScopeConfig,
  runner: QueryRunner,
  fold: Awaited<ReturnType<typeof loadOracleFold>>,
  tenantId: string,
  emptyTenantId: string | null,
): Promise<void> {
  const started = Date.now();
  const at = { failures: failures.length, checks: checksRun, bothFailed: bothFailedChecks.length };
  timing.engine = 0;
  timing.oracle = 0;
  Object.assign(selectivity, { empty: 0, every: 0, some: 0 });
  emptyByKind.clear();
  itemNumbers.clear();
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const m = runner.manager;
  // The list's own allocation calculator: CAPEX shares come from capex_allocations.
  const deps = realSummaryDeps(scope);
  const oracle = new BudgetSummaryOracle(scope, deps, m, tenantId, fold, ROW_OPTIONS);
  const axisRows: Array<{ id: string; grid: boolean }> = await m.query(
    `SELECT id, (NOT is_default AND status <> 'disabled' AND (disabled_at IS NULL OR disabled_at > now())) AS grid
       FROM analytics_axes WHERE tenant_id = $1 ORDER BY sort_order, id`,
    [tenantId],
  );
  const gridAxisKeys = axisRows.filter((a) => a.grid).map((a) => `analytics_${a.id}`);

  // Field values to draw needles from: the first 1,000 lines by item number (a stable order), every field.
  const sampleRows = await oracle.summary({ includeDisabled: 'true', years: String(Y + 3), limit: 1000, sort: 'item_number:ASC' });
  const sample = new Map<string, any[]>();
  const catalogue = fieldCatalogue(scope, axisRows.map((a) => a.id));
  for (const row of sampleRows.items) itemNumbers.set(row.id, row.item_number);
  const allIds = await oracle.summaryIds({ includeDisabled: 'true' });
  allIds.ids.forEach((id, i) => itemNumbers.set(id, allIds.item_numbers[i]));
  for (const field of Object.values(catalogue).flat()) {
    const values = new Set<any>();
    for (const row of sampleRows.items) {
      const value = getSummaryFieldValue(row, field);
      if (catalogue.multi.includes(field)) {
        for (const name of summaryFieldValues(row, field)) values.add(name);
        const joined = sample.get(`${field}#joined`) ?? [];
        if (value) joined.push(value);
        sample.set(`${field}#joined`, joined);
      } else values.add(value);
    }
    sample.set(field, Array.from(values));
  }

  const r = prng(SEED);
  const cases = buildCases(r, sample, axisRows.map((a) => a.id), scope);
  const digest = createHash('sha256').update(JSON.stringify(cases)).digest('hex').slice(0, 12);
  const env: Engines = { scope, oracle, runner, lineCount: allIds.total, gridAxisKeys };
  for (const c of cases) await runCase(env, c, deps);

  // An empty tenant answers empty everywhere, like the oracle.
  if (emptyTenantId && !ONLY) {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [emptyTenantId]);
    const emptyOracle = new BudgetSummaryOracle(scope, deps, m, emptyTenantId, fold, ROW_OPTIONS);
    for (const [i, query] of [{}, { q: 'x', fte: 'fte_yBudget' }, { status: 'enabled', sort: 'supplier_name:ASC' }].entries()) {
      await runCase({ scope, oracle: emptyOracle, runner, lineCount: 0, gridAxisKeys: [] }, { id: `empty/${i}`, query, checks: ['ids', 'full', 'neighbors'], fvFields: ['supplier_name', 'project_name'] }, deps);
    }
  }
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const both = bothFailedChecks.slice(at.bothFailed);
  console.log(`budget-list-differential (${TENANT_SLUG ?? 'fixture'}, ${scope.scope}, seed ${SEED}${FULL ? ', full' : ''}): ${allIds.total} lines, ${cases.length} cases (digest ${digest}), ${checksRun - at.checks} checks, ${failures.length - at.failures} differences, ${both.length} checks failed on both sides, ${seconds}s (engine ${(timing.engine / 1000).toFixed(1)}s, oracle ${(timing.oracle / 1000).toFixed(1)}s); filtered id checks selecting no line ${selectivity.empty}, every line ${selectivity.every}, some ${selectivity.some}`);
  console.log(`  selecting no line, most often: ${Array.from(emptyByKind.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([kind, n]) => `${kind} ${n}`).join(', ')}`);
  if (both.length) console.log(`  failed on both sides (same request refused by both):\n  ${both.slice(0, 20).join('\n  ')}${both.length > 20 ? `\n  … ${both.length - 20} more` : ''}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? `${err.message}\n${err.stack?.split('\n').slice(1, 6).join('\n')}` : err);
  process.exit(1);
});
