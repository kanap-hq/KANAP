import { compileAgFilterCondition, createParamNameGenerator } from '../../common/ag-grid-filtering';
import type { FieldSql, ListConfig } from '../../common/list-engine/list-engine.types';
import { bindNamed, SqlStatement } from '../../common/list-engine/sql-statement';
import { decimal2ToFloat, fold, jsRound, jsTrim, sqlLiteral } from '../../common/list-engine/sql-fragments';
import type { LifecycleScope } from '../../common/status';
import { ACTIVE_TASK_STATUSES } from '../../tasks/task.entity';
import { parseAnalyticsFieldKey } from '../../analytics/analytics-axes.util';
import { formatAllocationMethodLabel } from '../allocation-utils';
import {
  FIXED_SLOTS,
  FIXED_SORT_ORDERS,
  PROJECT_LIST_FIELDS,
  resolveAmountField,
  resolveFteField,
} from '../spend-summary.builder';
import { fxJoinCurrency, fxTableSql } from './budget-fx-table';
import type { BudgetListRuntime, RuntimeNeeds } from './budget-list.runtime';

/**
 * The OPEX and CAPEX lists as a list-engine config, built from the scope
 * config of `spend-summary.builder.ts` (tables, name field, link tables,
 * reference prefix). Every field reads what the row builder shows for it
 * (`getSummaryFieldValue`), so sorts, filters, the quick search and the
 * filter values agree with the rows the page draws. Table and column names
 * come from the scope config only; every value from the request is bound.
 */

/** Allocation methods a version keeps as is; any other resolves through the year's rule. */
const OWN_METHODS = ['manual_pct', 'manual_company', 'manual_department', 'headcount', 'it_users', 'turnover'];

/** Item columns of the entity (what the row spreads), by kind. */
const ITEM_COLUMNS: Record<string, FieldSql['kind']> = {
  id: 'uuid',
  tenant_id: 'uuid',
  item_number: 'int',
  paying_company_id: 'uuid',
  supplier_id: 'uuid',
  account_id: 'uuid',
  currency: 'text',
  effective_start: 'day',
  status: 'enum',
  disabled_at: 'ts',
  owner_it_id: 'uuid',
  owner_business_id: 'uuid',
  project_id: 'uuid',
  cost_center_id: 'uuid',
  run_build: 'enum',
  notes: 'text',
  created_at: 'ts',
  updated_at: 'ts',
  description: 'text',
};

const OPEX_ONLY_COLUMNS: Record<string, FieldSql['kind']> = { product_name: 'text', contract_id: 'uuid' };
const CAPEX_ONLY_COLUMNS: Record<string, FieldSql['kind']> = { ppe_type: 'enum', investment_type: 'enum', priority: 'enum' };

const SEP = `E'\\x1f'`;

export class BudgetListConfig implements ListConfig {
  readonly alias = 'i';
  readonly from: string;
  readonly tieBreak = ['i.created_at DESC', 'i.id DESC'];
  readonly scopeFields = ['disabled_at'] as const;
  private readonly columns: Record<string, FieldSql['kind']>;

  constructor(private readonly rt: BudgetListRuntime) {
    this.from = `${rt.scope.itemTable} i`;
    this.columns = { ...ITEM_COLUMNS, ...(rt.scope.scope === 'opex' ? OPEX_ONLY_COLUMNS : CAPEX_ONLY_COLUMNS) };
  }

  private get scope() {
    return this.rt.scope;
  }

  tenantWhere(stmt: SqlStatement): string {
    return `i.tenant_id = ${stmt.tenant}`;
  }

  /**
   * The lifecycle scope on `disabled_at`, AND the grid's date filter on that
   * column with every condition of a combined model (`disabledAtWhere`),
   * the day read in UTC.
   */
  scopeWhere(stmt: SqlStatement, scope: LifecycleScope, filters: Record<string, any>): string | null {
    const parts: string[] = [];
    if (scope === 'active') parts.push('i.disabled_at IS NULL OR i.disabled_at > NOW()');
    else if (scope === 'inactive') parts.push('i.disabled_at IS NOT NULL AND i.disabled_at <= NOW()');
    else if (scope === 'none') parts.push('1 = 0');
    else if (scope && scope.activeSince) parts.push(`i.disabled_at IS NULL OR i.disabled_at >= ${stmt.bind(scope.activeSince.toISOString(), 'timestamptz')}`);

    const raw = filters?.disabled_at;
    const combined = raw && typeof raw === 'object' && Array.isArray(raw.conditions) && raw.conditions.length > 0
      && (raw.operator === 'AND' || raw.operator === 'OR');
    const models: any[] = combined ? raw.conditions : [raw && typeof raw === 'object' && raw.operator && Array.isArray(raw.conditions) && raw.conditions.length > 0 ? raw.conditions[0] : raw];
    const nextParam = createParamNameGenerator('eov_');
    const compiled: string[] = [];
    for (const model of models) {
      if (!model || typeof model !== 'object' || model.filterType !== 'date') continue;
      const condition = compileAgFilterCondition(model, { expression: `(i.disabled_at AT TIME ZONE 'UTC')` }, nextParam);
      if (condition) compiled.push(bindNamed(stmt, condition.sql, condition.params));
    }
    if (compiled.length === 1) parts.push(compiled[0]);
    else if (compiled.length > 1) parts.push(compiled.map((part) => `(${part})`).join(raw.operator === 'OR' ? ' OR ' : ' AND '));
    return parts.length ? parts.map((part) => `(${part})`).join(' AND ') : null;
  }

  // ----- joins -----

  private join(stmt: SqlStatement, key: string, sql: string | (() => string), deps: string[] = []): string {
    return stmt.join(key, typeof sql === 'function' ? sql : () => sql, deps);
  }

  private version(stmt: SqlStatement, year: number): string {
    const s = this.scope;
    return this.join(
      stmt,
      `v${year}`,
      `LEFT JOIN ${s.versionTable} v${year} ON v${year}.tenant_id = ${stmt.tenant} AND v${year}.${s.versionItemFk} = i.id AND v${year}.budget_year = ${year}
        AND (i.disabled_at IS NULL OR ${year} <= extract(year FROM i.disabled_at AT TIME ZONE 'UTC'))`,
    );
  }

  private fxCte(stmt: SqlStatement): string {
    const fx = this.rt.fx;
    if (!fx) throw new Error('FX rates were not loaded for this statement');
    return stmt.cte('fx', () => fxTableSql((value, cast) => stmt.bind(value, cast), fx));
  }

  /** The converted cents of one measure of the version of `year` (0 without a version or without amounts). */
  private amountCents(stmt: SqlStatement, year: number, measure: string): FieldSql {
    const v = this.version(stmt, year);
    const t = this.join(stmt, `t${year}`, `LEFT JOIN ${this.scope.totalsTable} t${year} ON t${year}.tenant_id = ${stmt.tenant} AND t${year}.version_id = ${v}.id`, [v]);
    this.fxCte(stmt);
    const fx = this.join(
      stmt,
      `fx${year}`,
      () => `LEFT JOIN fx fx${year} ON fx${year}.yr = ${year} AND fx${year}.cur = ${fxJoinCurrency('i')}
        AND fx${year}.set_key = CASE WHEN ${v}.fx_rate_set_id = ANY(${stmt.bind(this.rt.fx!.knownSets, 'uuid[]')}) THEN ${v}.fx_rate_set_id::text ELSE 'live' END`,
      [v],
    );
    // The builder's chain: `Math.round(Number(formatCents(local)) * rate * 100)`.
    const x = `${decimal2ToFloat(`${t}.${measure}`)} * coalesce(${fx}.rate, 1::float8) * 100`;
    return { kind: 'money', sql: `(CASE WHEN ${t}.version_id IS NULL THEN 0::bigint ELSE ${jsRound(x)}::bigint END)`, joins: [t, fx] };
  }

  private fte(stmt: SqlStatement, year: number, measure: string): FieldSql {
    const v = this.version(stmt, year);
    const key = `ri${year}_${measure}`;
    this.join(
      stmt,
      key,
      `LEFT JOIN ${this.scope.roundTable} ${key} ON ${key}.tenant_id = ${stmt.tenant} AND ${key}.version_id = ${v}.id AND ${key}.measure = '${measure}' AND ${key}.fte IS NOT NULL`,
      [v],
    );
    return { kind: 'fte', sql: `(CASE WHEN ${v}.id IS NULL THEN NULL ELSE ${key}.fte END)`, joins: [key] };
  }

  /** The allocation label of the version of `year` ('' without one): its own method, else the year's rule. */
  private allocationLabelSql(versionAlias: string, year: number): string {
    const ruleLabel = this.rt.ruleLabels?.get(year);
    if (ruleLabel == null) throw new Error(`Allocation rule of ${year} was not loaded for this statement`);
    const cases = OWN_METHODS.map((method) => `WHEN ${sqlLiteral(method)} THEN ${sqlLiteral(formatAllocationMethodLabel(method))}`).join(' ');
    // The rule's label is one of the calculator's fixed labels: a constant of the engine, not a request value.
    return `(CASE ${versionAlias}.allocation_method ${cases} ELSE ${sqlLiteral(ruleLabel)} END)`;
  }

  private allocationLabel(stmt: SqlStatement, year: number): FieldSql {
    const v = this.version(stmt, year);
    return { kind: 'text', sql: `(CASE WHEN ${v}.id IS NULL THEN NULL ELSE ${this.allocationLabelSql(v, year)} END)`, joins: [v] };
  }

  private supplier(stmt: SqlStatement): string {
    return this.join(stmt, 'sup', `LEFT JOIN suppliers sup ON sup.tenant_id = ${stmt.tenant} AND sup.id = i.supplier_id`);
  }

  private payingCompany(stmt: SqlStatement): string {
    return this.join(stmt, 'pc', `LEFT JOIN companies pc ON pc.tenant_id = ${stmt.tenant} AND pc.id = i.paying_company_id`);
  }

  private account(stmt: SqlStatement): string {
    return this.join(stmt, 'acc', `LEFT JOIN accounts acc ON acc.tenant_id = ${stmt.tenant} AND acc.id = i.account_id`);
  }

  private owner(stmt: SqlStatement, column: 'owner_it_id' | 'owner_business_id'): FieldSql {
    const alias = column === 'owner_it_id' ? 'uit' : 'ubiz';
    this.join(stmt, alias, `LEFT JOIN users ${alias} ON ${alias}.tenant_id = ${stmt.tenant} AND ${alias}.id = i.${column}`);
    return { kind: 'text', sql: `(CASE WHEN ${alias}.id IS NULL THEN NULL ELSE NULLIF(${displayNameSql(alias)}, '') END)`, joins: [alias] };
  }

  private costCenter(stmt: SqlStatement): string {
    const nodes = this.rt.costCenters;
    if (!nodes) throw new Error('Cost centres were not loaded for this statement');
    stmt.cte('cc_nodes', () => `SELECT * FROM unnest(${stmt.bind(nodes.map((n) => n.id), 'uuid[]')}, ${stmt.bind(nodes.map((n) => n.code), 'text[]')}, ${stmt.bind(nodes.map((n) => n.name), 'text[]')}, ${stmt.bind(nodes.map((n) => n.path), 'text[]')}, ${stmt.bind(nodes.map((n) => n.holder_id), 'uuid[]')}, ${stmt.bind(nodes.map((n) => n.holder_name), 'text[]')}) AS t(id, code, name, path, holder_id, holder_name)`);
    return this.join(stmt, 'cc', `LEFT JOIN cc_nodes cc ON cc.id = i.cost_center_id`);
  }

  private latestContract(stmt: SqlStatement): string {
    const link = this.scope.contractLink;
    stmt.cte('lc', () => `SELECT DISTINCT ON (l.${link.itemColumn}) l.${link.itemColumn} AS item_id, c.id AS contract_id, c.name AS contract_name
      FROM ${link.table} l JOIN contracts c ON c.id = l.contract_id AND c.tenant_id = l.tenant_id
      WHERE l.tenant_id = ${stmt.tenant}
      ORDER BY l.${link.itemColumn}, l.created_at DESC, l.id DESC`);
    return this.join(stmt, 'lc', `LEFT JOIN lc ON lc.item_id = i.id`);
  }

  private projectsCte(stmt: SqlStatement): string {
    const s = this.scope;
    return stmt.cte('proj', () => `SELECT l.item_id,
        string_agg(p.name, ', ' ORDER BY p.name COLLATE "und-x-icu") AS project_name,
        array_agg(p.name ORDER BY p.name COLLATE "und-x-icu") AS project_names,
        string_agg(DISTINCT st.name COLLATE "und-x-icu", ', ' ORDER BY st.name COLLATE "und-x-icu") FILTER (WHERE st.name <> '') AS project_stream_name,
        array_agg(DISTINCT st.name COLLATE "und-x-icu" ORDER BY st.name COLLATE "und-x-icu") FILTER (WHERE st.name <> '') AS project_stream_names,
        string_agg(DISTINCT pc.name COLLATE "und-x-icu", ', ' ORDER BY pc.name COLLATE "und-x-icu") FILTER (WHERE pc.name <> '') AS project_category_name,
        array_agg(DISTINCT pc.name COLLATE "und-x-icu" ORDER BY pc.name COLLATE "und-x-icu") FILTER (WHERE pc.name <> '') AS project_category_names
      FROM (
        SELECT pl.${s.projectLink.itemColumn} AS item_id, pl.project_id FROM ${s.projectLink.table} pl WHERE pl.tenant_id = ${stmt.tenant}
        UNION
        SELECT i2.id, i2.project_id FROM ${s.itemTable} i2 WHERE i2.tenant_id = ${stmt.tenant} AND i2.project_id IS NOT NULL
      ) l
      JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = ${stmt.tenant}
      LEFT JOIN portfolio_streams st ON st.id = p.stream_id AND st.tenant_id = p.tenant_id
      LEFT JOIN portfolio_categories pc ON pc.id = p.category_id AND pc.tenant_id = p.tenant_id
      GROUP BY l.item_id`);
  }

  private projects(stmt: SqlStatement): string {
    this.projectsCte(stmt);
    return this.join(stmt, 'proj', `LEFT JOIN proj ON proj.item_id = i.id`);
  }

  private latestTask(stmt: SqlStatement): string {
    stmt.cte('ltask', () => `SELECT DISTINCT ON (t.related_object_id) t.related_object_id AS item_id, t.title
      FROM tasks t
      WHERE t.tenant_id = ${stmt.tenant} AND t.related_object_type = ${stmt.bind(this.scope.taskObjectType, 'text')}
        AND t.status = ANY(${stmt.bind(ACTIVE_TASK_STATUSES, 'text[]')})
      ORDER BY t.related_object_id, t.created_at DESC, t.id DESC`);
    return this.join(stmt, 'ltask', `LEFT JOIN ltask ON ltask.item_id = i.id`);
  }

  private axisValue(stmt: SqlStatement, axisId: string): FieldSql {
    const axes = this.rt.axes;
    if (!axes) throw new Error('Analytics dimensions were not loaded for this statement');
    const index = axes.ids.indexOf(axisId);
    // A key naming no dimension of the tenant: the rows have no such key.
    if (index < 0) return { kind: 'text', sql: 'NULL::text', joins: [] };
    const link = `ax${index}`;
    const category = `axc${index}`;
    // The axis id is one of the tenant's dimension ids read from the database (a validated uuid), not request text.
    this.join(stmt, link, `LEFT JOIN ${this.scope.analyticsLink.table} ${link} ON ${link}.tenant_id = ${stmt.tenant} AND ${link}.item_id = i.id AND ${link}.axis_id = ${sqlLiteral(axes.ids[index])}::uuid`);
    this.join(stmt, category, `LEFT JOIN analytics_categories ${category} ON ${category}.tenant_id = ${stmt.tenant} AND ${category}.id = ${link}.category_id`, [link]);
    return { kind: 'text', sql: `${category}.name`, joins: [category] };
  }

  private defaultAxisLink(stmt: SqlStatement): string | null {
    const axes = this.rt.axes;
    if (!axes) throw new Error('Analytics dimensions were not loaded for this statement');
    if (!axes.defaultAxisId) return null;
    this.axisValue(stmt, axes.defaultAxisId);
    return `ax${axes.ids.indexOf(axes.defaultAxisId)}`;
  }

  // ----- fields -----

  field(stmt: SqlStatement, key: string): FieldSql {
    const s = this.scope;
    const Y = this.rt.currentYear;

    const amount = resolveAmountField(key);
    if (amount) {
      const year = amount.year ?? Y + FIXED_SLOTS.find((slot) => slot.key === amount.slot)!.offset;
      return this.amountCents(stmt, year, amount.column.measure);
    }
    const fte = resolveFteField(key);
    if (fte) {
      const year = fte.year ?? Y + FIXED_SLOTS.find((slot) => slot.key === fte.slot)!.offset;
      return this.fte(stmt, year, fte.column.measure);
    }
    const axisId = parseAnalyticsFieldKey(key);
    if (axisId) return this.axisValue(stmt, axisId);

    if (key in this.columns) {
      const kind = this.columns[key];
      const column = `i.${key}`;
      switch (kind) {
        case 'uuid':
        case 'enum':
        case 'text':
          return {
            kind,
            sql: `${column}::text`,
            joins: [],
            ...(FIXED_SORT_ORDERS[key] ? { rank: FIXED_SORT_ORDERS[key] } : {}),
          };
        case 'int':
          return {
            kind,
            sql: column,
            joins: [],
            ...(key === 'item_number' ? { textCandidates: (text: string) => [`${sqlLiteral(`${s.refPrefix}-`)} || ${text}`] } : {}),
          };
        default:
          return { kind, sql: column, joins: [] };
      }
    }

    switch (key) {
      case 'supplier_name': {
        const sup = this.supplier(stmt);
        return { kind: 'text', sql: `${sup}.name`, joins: [sup] };
      }
      case 'paying_company_name':
      case 'company_name': {
        const pc = this.payingCompany(stmt);
        return { kind: 'text', sql: `${pc}.name`, joins: [pc] };
      }
      case 'account_display': {
        const acc = this.account(stmt);
        return { kind: 'text', sql: `(CASE WHEN ${acc}.id IS NULL THEN NULL ELSE concat(${acc}.account_number::text, ' - ', ${acc}.account_name) END)`, joins: [acc] };
      }
      case 'account_name': {
        const acc = this.account(stmt);
        return { kind: 'text', sql: `${acc}.account_name`, joins: [acc] };
      }
      case 'account_number': {
        const acc = this.account(stmt);
        return { kind: 'int', sql: `${acc}.account_number`, joins: [acc] };
      }
      case 'account_warning': {
        const acc = this.account(stmt);
        const pc = this.payingCompany(stmt);
        return {
          kind: 'text',
          sql: `(CASE WHEN ${acc}.coa_id IS NOT NULL AND ${pc}.coa_id IS NOT NULL AND ${acc}.coa_id <> ${pc}.coa_id THEN 'coa_mismatch' END)`,
          joins: [acc, pc],
        };
      }
      case 'owner_it_name':
        return this.owner(stmt, 'owner_it_id');
      case 'owner_business_name':
        return this.owner(stmt, 'owner_business_id');
      case 'analytics_category_name':
      case 'analytics_category_id': {
        const link = this.defaultAxisLink(stmt);
        if (!link) return { kind: key === 'analytics_category_id' ? 'uuid' : 'text', sql: 'NULL::text', joins: [] };
        const index = link.slice(2);
        return key === 'analytics_category_id'
          ? { kind: 'uuid', sql: `${link}.category_id::text`, joins: [link] }
          : { kind: 'text', sql: `axc${index}.name`, joins: [`axc${index}`] };
      }
      case 'cost_center_code':
      case 'cost_center_name':
      case 'cost_center_path': {
        const cc = this.costCenter(stmt);
        return { kind: 'text', sql: `${cc}.${key.replace('cost_center_', '')}`, joins: [cc] };
      }
      case 'cost_center_label': {
        const cc = this.costCenter(stmt);
        return { kind: 'text', sql: `(CASE WHEN ${cc}.id IS NULL THEN NULL ELSE ${cc}.code || ' · ' || ${cc}.name END)`, joins: [cc] };
      }
      case 'budget_holder_id': {
        const cc = this.costCenter(stmt);
        return { kind: 'uuid', sql: `${cc}.holder_id::text`, joins: [cc] };
      }
      case 'budget_holder_name': {
        const cc = this.costCenter(stmt);
        return { kind: 'text', sql: `${cc}.holder_name`, joins: [cc] };
      }
      case 'latest_contract_id': {
        const lc = this.latestContract(stmt);
        return { kind: 'uuid', sql: `${lc}.contract_id::text`, joins: [lc] };
      }
      case 'latest_contract_name':
      case 'contract_name': {
        const lc = this.latestContract(stmt);
        return { kind: 'text', sql: `${lc}.contract_name`, joins: [lc] };
      }
      case 'project_name':
      case 'project_stream_name':
      case 'project_category_name': {
        const proj = this.projects(stmt);
        return { kind: 'multi', sql: `${proj}.${key}`, names: `${proj}.${key.replace(/_name$/, '_names')}`, joins: [proj] };
      }
      case 'latest_task_text': {
        const lt = this.latestTask(stmt);
        return { kind: 'text', sql: `${lt}.title`, joins: [lt] };
      }
      case 'allocation_label':
      case 'allocation_method_label':
        return this.allocationLabel(stmt, Y);
      case 'next_year_allocation_method_label':
        return this.allocationLabel(stmt, Y + 1);
      case 'spread_mode_for_y': {
        const v = this.version(stmt, Y);
        return { kind: 'text', sql: `(CASE WHEN ${v}.id IS NULL THEN NULL WHEN ${v}.input_grain::text = 'annual' THEN 'flat' ELSE 'manual' END)`, joins: [v] };
      }
      default:
        // Object keys (versions, supplier, account, latest_task, analytics_value_ids,
        // main_recipient), the computed allocation warning and any other key: no SQL value.
        return { kind: 'unknown', sql: 'NULL::text', joins: [] };
    }
  }

  // ----- quick search -----

  /**
   * The quick search bag of the builder, dimension first: small tables are
   * matched once per request, a line matches when any one of its entries
   * contains the needle (accents and case folded, Q2). The raw status code is
   * not in the bag (Q2); the joined project strings and the cost centre path
   * are, as on the rows.
   */
  quickSearch(stmt: SqlStatement, q: string): string {
    const s = this.scope;
    const t = stmt.tenant;
    stmt.cte('qs_needle', () => `SELECT ${fold(stmt.bind(q, 'text'))} AS n`);
    const N = `(SELECT n FROM qs_needle)`;
    const match = (expr: string) => `strpos(${fold(expr)}, ${N}) > 0`;
    const Y = this.rt.currentYear;

    stmt.cte('qs_sup', () => `SELECT x.id FROM suppliers x WHERE x.tenant_id = ${t} AND ${match('x.name')}`);
    stmt.cte('qs_comp', () => `SELECT x.id FROM companies x WHERE x.tenant_id = ${t} AND ${match('x.name')}`);
    stmt.cte('qs_acc', () => `SELECT x.id FROM accounts x WHERE x.tenant_id = ${t} AND ${match(`concat(x.account_number::text, ' - ', x.account_name)`)}`);
    stmt.cte('qs_user', () => `SELECT x.id FROM users x WHERE x.tenant_id = ${t} AND ${match(displayNameSql('x'))}`);
    this.costCenter(stmt);
    stmt.cte('qs_cc', () => `SELECT x.id FROM cc_nodes x WHERE ${match(`concat_ws(${SEP}, x.code, x.name, x.path, x.holder_name)`)}`);
    this.projectsCte(stmt);
    this.latestContract(stmt);
    const axes = this.rt.axes;
    if (!axes) throw new Error('Analytics dimensions were not loaded for this statement');
    stmt.cte('qs_items', () => `SELECT x.item_id FROM proj x WHERE ${match(`concat_ws(${SEP}, x.project_name, x.project_stream_name, x.project_category_name)`)}
      UNION SELECT x.item_id FROM lc x WHERE ${match('x.contract_name')}
      UNION SELECT a.item_id FROM ${s.analyticsLink.table} a
        WHERE a.tenant_id = ${t} AND a.axis_id = ANY(${stmt.bind(axes.ids, 'uuid[]')})
          AND a.category_id IN (SELECT c.id FROM analytics_categories c WHERE c.tenant_id = ${t} AND ${match('c.name')})`);
    stmt.cte('qs_alloc', () => `SELECT v.${s.versionItemFk} AS item_id FROM ${s.versionTable} v
      WHERE v.tenant_id = ${t} AND v.budget_year = ${Y} AND ${match(this.allocationLabelSql('v', Y))}`);

    const own = Array.from(new Set([
      'i.item_number::text',
      `${sqlLiteral(`${s.refPrefix}-`)} || i.item_number::text`,
      `i.${s.nameField}`,
      'i.description',
      'i.notes',
      'i.currency::text',
      ...s.extraFields.map((field) => `i.${field}::text`),
    ]));
    // The dimension matches first: hashed lookups, cheaper than folding the line's own text.
    return `(i.supplier_id IN (SELECT id FROM qs_sup)
      OR i.paying_company_id IN (SELECT id FROM qs_comp)
      OR i.account_id IN (SELECT id FROM qs_acc)
      OR i.owner_it_id IN (SELECT id FROM qs_user)
      OR i.owner_business_id IN (SELECT id FROM qs_user)
      OR i.cost_center_id IN (SELECT id FROM qs_cc)
      OR i.id IN (SELECT item_id FROM qs_items)
      OR ((i.disabled_at IS NULL OR ${Y} <= extract(year FROM i.disabled_at AT TIME ZONE 'UTC')) AND i.id IN (SELECT item_id FROM qs_alloc))
      OR ${match(`concat_ws(${SEP}, ${own.join(', ')})`)})`;
  }
}

/** The builder's `displayName`: trimmed first and last name joined by one space, else the email, else ''. */
function displayNameSql(alias: string): string {
  return `coalesce(NULLIF(concat_ws(' ', NULLIF(${jsTrim(`${alias}.first_name`)}, ''), NULLIF(${jsTrim(`${alias}.last_name`)}, '')), ''), ${alias}.email, '')`;
}

/** The runtime pre-reads the fields of a request need. */
export function budgetRuntimeNeeds(currentYear: number, keys: string[], hasQuickSearch: boolean): RuntimeNeeds {
  const fxYears = new Set<number>();
  const ruleYears = new Set<number>();
  let axes = hasQuickSearch;
  let costCenters = hasQuickSearch;
  if (hasQuickSearch) ruleYears.add(currentYear);
  for (const key of keys) {
    const amount = resolveAmountField(key);
    if (amount) {
      fxYears.add(amount.year ?? currentYear + FIXED_SLOTS.find((slot) => slot.key === amount.slot)!.offset);
      continue;
    }
    if (parseAnalyticsFieldKey(key) || key === 'analytics_category_name' || key === 'analytics_category_id') axes = true;
    if (['cost_center_code', 'cost_center_name', 'cost_center_path', 'cost_center_label', 'budget_holder_id', 'budget_holder_name'].includes(key)) costCenters = true;
    if (key === 'allocation_label' || key === 'allocation_method_label') ruleYears.add(currentYear);
    if (key === 'next_year_allocation_method_label') ruleYears.add(currentYear + 1);
  }
  return { fxYears: Array.from(fxYears), ruleYears: Array.from(ruleYears), axes, costCenters };
}

/** Project fields are lists of names; the others one value. */
export const MULTI_FIELDS = PROJECT_LIST_FIELDS;
