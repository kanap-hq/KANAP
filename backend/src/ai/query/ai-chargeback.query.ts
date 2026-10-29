import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { transactionDataAccessMode } from '../../data-access/data-access';
import { describeAllocationWarning } from '../../spend/allocation-distribution';
import type { BudgetNature } from '../../spend/budget-nature';
import type {
  ChargebackAllocationReason,
  ChargebackMetricKey,
  ChargebackReportService,
  ChargebackScope,
  ChargebackWarning,
} from '../../spend/chargeback-report.service';
import { SUMMARY_COLUMNS } from '../../spend/spend-summary.builder';
import { compareText, numberMatch, paged, setMatch, textMatch } from './ai-support.query';

/**
 * Reporting › Global chargeback and Company chargeback as the screens show them, for the assistant
 * and the MCP server: the families `chargeback` (the rows of the "Detailed allocations" table of the
 * global report: each beneficiary company, then its departments) and `chargeback_lines` (the lines
 * charged to one company, the company report). Read through `ChargebackReportService`
 * (`GET /reports/chargeback/global`, `GET /reports/chargeback/company`), which recomputes every
 * allocation of the year with the calculator of the Allocations tab: never a read of
 * `spend_allocations`, whose default splits are not stored.
 *
 * One call of the service serves the whole family (filters, sort, page and groups in memory). The
 * report parameters are filters: `year` (one year), `column` (the assistant's column keys, turned
 * into the service's names through `SUMMARY_COLUMNS`), `nature` (none or both: the two natures, the
 * screens opening on OPEX alone) and, for the lines, `company`. The service's warnings come back in
 * English words. Read with the reporting right, as the routes; a person in limited access gets the
 * service's own rules (global: the lines they read, here without the group total; company: refused
 * outside their company nodes, the lines they do not read named by their reference only).
 */

export type AiChargebackColumn = 'budget' | 'review' | 'forecast' | 'actual' | 'landing';
export type AiChargebackLevel = 'company' | 'department' | 'common';
export type AiChargebackAllocationMethod = 'headcount' | 'it_users' | 'turnover' | 'manual_company' | 'manual_department' | 'manual_pct';

export const AI_CHARGEBACK_COLUMNS: readonly AiChargebackColumn[] = SUMMARY_COLUMNS.map((column) => column.ai);
export const AI_CHARGEBACK_NATURES: readonly BudgetNature[] = ['opex', 'capex'];
export const AI_CHARGEBACK_LEVELS: readonly AiChargebackLevel[] = ['company', 'department', 'common'];
export const AI_CHARGEBACK_ALLOCATION_METHODS: readonly AiChargebackAllocationMethod[] = [
  'headcount', 'it_users', 'turnover', 'manual_company', 'manual_department', 'manual_pct',
];

/** A department row whose department no longer exists: the screen shows no name for it. */
export const AI_CHARGEBACK_MISSING_DEPARTMENT = 'deleted department';
export const AI_CHARGEBACK_YEAR_REFUSAL = 'The chargeback reads one year: give year as {"op": "eq", "value": 2026}.';
export const AI_CHARGEBACK_COLUMN_REFUSAL = `The chargeback reads one column: give column as one of ${AI_CHARGEBACK_COLUMNS.join(', ')}.`;
export const AI_CHARGEBACK_COMPANY_REQUIRED = 'chargeback_lines lists the lines charged to one company: give the company filter (its name).';
export const AI_CHARGEBACK_WARNINGS_NOTE = 'Each warning names what these figures leave out or how a line was spread: repeat every warning in the answer, in the person\'s words.';
export const AI_CHARGEBACK_LIMITED_NOTE = 'Within your access: the report adds up the shares of the budget lines your data access lets you read. The group total is not given, as on the screen.';
export const AI_CHARGEBACK_LINES_LIMITED_NOTE = 'Every share charged to this company is listed, the lines outside your access included: those are named by their reference only (readable false, no link). The group total is not given, as on the screen.';

const NATURE_NOTES: Record<'opex' | 'capex' | 'both', string> = {
  opex: 'OPEX lines only.',
  capex: 'CAPEX lines only, each on its amount of the year in the column (not its depreciation).',
  both: 'Both natures, OPEX and CAPEX: no nature was asked. The chargeback screens open on OPEX only, so their figures differ unless set to all.',
};

export type AiChargebackServices = { chargeback: Pick<ChargebackReportService, 'resolveMetric' | 'generateGlobal' | 'generateCompany'> };

type ReportOpts = { manager: EntityManager; tenantId: string; year?: number | null };

/** The report's parameters, as the result says them. */
export type AiChargebackReport = {
  report: 'global' | 'company';
  year: number;
  column: AiChargebackColumn;
  nature: 'opex' | 'capex' | 'both';
  nature_note: string;
  /** The amount the report spreads (the sum of the companies' consumed amounts); null in limited access. */
  report_total: number | null;
  /** Null when no company is named so (`chargeback_lines`). */
  reporting_currency: string | null;
  /** The service's warnings in English words. */
  warnings: string[];
  warnings_note?: string;
  access_note?: string;
  /** `chargeback_lines`: the company of the report and its figures; null when no company is named so. */
  company?: AiChargebackCompany | null;
  company_note?: string;
};

export type AiChargebackCompany = {
  name: string;
  consumed: number;
  paid: number | null;
  net: number | null;
  headcount: number | null;
  it_users: number | null;
  turnover: number | null;
  cost_per_user: number | null;
  cost_per_it_user: number | null;
  cost_vs_turnover_pct: number | null;
  /** The company's departments, as the company report lists them (`common` is the costs without a department). */
  departments: Array<{ department: string | null; level: 'department' | 'common'; amount: number; share_pct: number | null; headcount: number | null; cost_per_user: number | null }>;
  /** The listed lines' total, and its fraction of the company's consumed amount. */
  lines_total: number;
  lines_total_share: number | null;
  /** The amount the whole report spreads; null in limited access. */
  group_total: number | null;
};

export type AiChargebackRow = {
  key: string;
  level: AiChargebackLevel;
  company_id: string;
  company: string;
  department_id: string | null;
  /** The department's name; null on a company row and on common costs. */
  department: string | null;
  /** The nature of the report the row comes from; null when it covers both. */
  nature: BudgetNature | null;
  amount: number;
  /** Fraction of the report total (0.125 is 12.5 %). */
  share: number | null;
  headcount: number | null;
  cost_per_user: number | null;
  /** Company rows only (null on the department rows). */
  paid: number | null;
  net: number | null;
  it_users: number | null;
  turnover: number | null;
  cost_per_it_user: number | null;
  cost_vs_turnover_pct: number | null;
};

export type AiChargebackLineRow = {
  key: string;
  /** The line's id; null for a line the person does not read. */
  item_id: string | null;
  ref: string | null;
  /** The line's name; null for a line the person does not read (named by `ref` only). */
  line: string | null;
  nature: BudgetNature | null;
  allocation_method: string;
  amount: number;
  /** Percent of the company's consumed amount. */
  share_pct: number | null;
  readable: boolean;
  /** Limited access only, as the screen. */
  paying_company?: string | null;
  allocation_pct?: number | null;
  departments?: string[];
};

export type AiChargebackList<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  report: AiChargebackReport;
};

export const CHARGEBACK_SORTS = new Set([
  'amount', 'company', 'department', 'level', 'share', 'paid', 'net', 'headcount', 'cost_per_user',
]);
export const CHARGEBACK_LINE_SORTS = new Set(['amount', 'line', 'allocation_method', 'share_pct']);

// ---------------------------------------------------------------------------------------------
// Parameters.

function yearOf(filters: Record<string, any> | undefined, fallback?: number | null): number {
  const model = filters?.year;
  if (model) {
    const value = Number(model.filter);
    if (model.filterType !== 'number' || model.type !== 'equals' || !Number.isInteger(value)) {
      throw new BadRequestException(AI_CHARGEBACK_YEAR_REFUSAL);
    }
    return value;
  }
  const year = Number(fallback);
  return Number.isInteger(year) && year > 0 ? year : new Date().getFullYear();
}

function setValues(model: any): string[] {
  if (!model || model.filterType !== 'set' || !Array.isArray(model.values) || model.mode === 'exclude') return [];
  return Array.from(new Set(model.values.filter((value: unknown): value is string => typeof value === 'string')));
}

function columnOf(filters: Record<string, any> | undefined): AiChargebackColumn | null {
  const values = setValues(filters?.column);
  if (values.length > 1) throw new BadRequestException(AI_CHARGEBACK_COLUMN_REFUSAL);
  return (values[0] as AiChargebackColumn | undefined) ?? null;
}

/** One nature asked: that one; none or both: the two natures. */
function scopeOf(filters: Record<string, any> | undefined): ChargebackScope {
  const values = setValues(filters?.nature).filter((value) => value === 'opex' || value === 'capex');
  return values.length === 1 ? values[0] as ChargebackScope : 'all';
}

function serviceColumn(column: AiChargebackColumn): ChargebackMetricKey {
  return SUMMARY_COLUMNS.find((entry) => entry.ai === column)!.key;
}

function aiColumn(metric: ChargebackMetricKey): AiChargebackColumn {
  return SUMMARY_COLUMNS.find((entry) => entry.key === metric)?.ai ?? 'budget';
}

function natureWord(scope: ChargebackScope): 'opex' | 'capex' | 'both' {
  return scope === 'all' ? 'both' : scope;
}

async function resolveParams(services: AiChargebackServices, query: Record<string, any>, opts: ReportOpts) {
  const year = yearOf(query.filters, opts.year);
  const column = columnOf(query.filters);
  const metric = await services.chargeback.resolveMetric(column ? serviceColumn(column) : undefined, opts.tenantId, { manager: opts.manager });
  return { year, metric, scope: scopeOf(query.filters) };
}

// ---------------------------------------------------------------------------------------------
// Warnings in words.

function reasonWords(reason: ChargebackAllocationReason): string {
  switch (reason.code) {
    case 'select_company': return 'no company is selected for its manual allocation.';
    case 'select_department': return 'no department is selected for its manual allocation.';
    case 'no_enabled_companies': return 'no company is enabled for the allocation.';
    case 'departments_not_found': return 'some departments of its manual allocation no longer exist.';
    case 'provide_department_headcount': return 'the selected departments have no headcount for the year.';
    case 'driver_sum_zero': return 'the values of its allocation driver add up to zero.';
    case 'companies_unavailable': return 'some companies of its manual allocation are not available.';
    case 'turnover_rate': return 'the turnover of the selected companies has no exchange rate.';
    case 'provide_driver': return `the selected companies have no ${reason.driver === 'it_users' ? 'IT users' : reason.driver} for the year.`;
    default: return reason.text;
  }
}

/** A warning of the report as a short English sentence (the screen words the same codes). */
export function chargebackWarningWords(warning: ChargebackWarning): string {
  switch (warning.code) {
    case 'amount_fx_missing':
    case 'turnover_fx_missing':
      return describeAllocationWarning(warning);
    case 'stored_allocation_used':
      return `"${warning.item}" (${warning.year}) is spread on its stored allocation, which could not be recomputed: ${reasonWords(warning.reason)}`;
    case 'allocations_skipped':
      return `"${warning.item}" (${warning.year}) is left out of the chargeback, its allocation could not be computed: ${reasonWords(warning.reason)}`;
    case 'missing_paying_company':
      return `"${warning.item}" (${warning.year}) has no paying company: it counts for the companies it is charged to, in no paid total.`;
    default:
      return 'A line of the report could not be fully counted.';
  }
}

function warningsOf(...lists: ChargebackWarning[][]): string[] {
  return Array.from(new Set(lists.flat().map(chargebackWarningWords)));
}

function withWarnings(report: Omit<AiChargebackReport, 'warnings_note'>): AiChargebackReport {
  return report.warnings.length > 0 ? { ...report, warnings_note: AI_CHARGEBACK_WARNINGS_NOTE } : report;
}

// ---------------------------------------------------------------------------------------------
// Global report: `chargeback`.

type GlobalReport = Awaited<ReturnType<ChargebackReportService['generateGlobal']>>;

function globalRows(report: GlobalReport, nature: BudgetNature | null): AiChargebackRow[] {
  const companies = new Map(report.companies.map((row) => [row.companyId, row] as const));
  const kpis = new Map(report.kpis.map((row) => [row.companyId, row] as const));
  return report.detailedRows.map((row) => {
    const common = { company_id: row.companyId, company: row.companyName, nature, amount: row.amount, share: row.share, headcount: row.headcount, cost_per_user: row.costPerUser };
    if (row.rowType === 'company') {
      const company = companies.get(row.companyId);
      const kpi = kpis.get(row.companyId);
      return {
        ...common,
        key: `${nature ?? 'all'}:${row.companyId}`,
        level: 'company' as const,
        department_id: null,
        department: null,
        paid: company?.paid ?? null,
        net: company?.net ?? null,
        it_users: kpi?.itUsers ?? null,
        turnover: kpi?.turnover ?? null,
        cost_per_it_user: kpi?.costPerItUser ?? null,
        cost_vs_turnover_pct: kpi?.costVsTurnoverPct ?? null,
      };
    }
    return {
      ...common,
      key: `${nature ?? 'all'}:${row.companyId}:${row.departmentId ?? 'common'}`,
      level: row.departmentId ? 'department' as const : 'common' as const,
      department_id: row.departmentId,
      department: row.departmentId ? row.departmentName ?? AI_CHARGEBACK_MISSING_DEPARTMENT : null,
      paid: null,
      net: null,
      it_users: null,
      turnover: null,
      cost_per_it_user: null,
      cost_vs_turnover_pct: null,
    };
  });
}

/**
 * The rows of the global report for the request's parameters. `perNature`: both natures asked, one
 * report per nature, each row naming its own (grouping by nature); otherwise one report.
 */
export async function readChargebackRows(
  services: AiChargebackServices,
  query: Record<string, any>,
  opts: ReportOpts,
  perNature = false,
): Promise<{ rows: AiChargebackRow[]; report: AiChargebackReport }> {
  const { year, metric, scope } = await resolveParams(services, query, opts);
  const scopes: ChargebackScope[] = perNature && scope === 'all' ? ['opex', 'capex'] : [scope];
  const reports: Array<{ scope: ChargebackScope; report: GlobalReport }> = [];
  for (const each of scopes) {
    reports.push({ scope: each, report: await services.chargeback.generateGlobal(year, metric, opts.tenantId, { manager: opts.manager, scope: each }) });
  }
  const limited = (await transactionDataAccessMode(opts.manager)) === 'limited';
  const rows = reports.flatMap(({ scope: each, report }) => globalRows(report, each === 'all' ? null : each));
  const total = Math.round(reports.reduce((sum, { report }) => sum + report.total, 0) * 100) / 100;
  return {
    rows,
    report: withWarnings({
      report: 'global',
      year,
      column: aiColumn(metric),
      nature: natureWord(scope),
      nature_note: NATURE_NOTES[natureWord(scope)],
      report_total: limited ? null : total,
      reporting_currency: reports[0].report.reportingCurrency,
      warnings: warningsOf(...reports.map(({ report }) => report.warnings)),
      ...(limited ? { access_note: AI_CHARGEBACK_LIMITED_NOTE } : {}),
    }),
  };
}

function filterRows(rows: AiChargebackRow[], query: Record<string, any>): AiChargebackRow[] {
  const filters = query.filters;
  const needle = String(query.q ?? '').trim().toLowerCase();
  return rows.filter((row) => textMatch(row.company, filters?.company)
    && textMatch(row.department, filters?.department)
    && setMatch(row.level, filters?.level)
    && numberMatch(row.amount, filters?.amount)
    && numberMatch(row.share, filters?.share)
    && numberMatch(row.paid, filters?.paid)
    && numberMatch(row.net, filters?.net)
    && numberMatch(row.headcount, filters?.headcount)
    && numberMatch(row.cost_per_user, filters?.cost_per_user)
    && (!needle || [row.company, row.department].some((value) => value != null && value.toLowerCase().includes(needle))));
}

function sortedBy<T>(rows: T[], sort: string | undefined, allowed: Set<string>, fallback: string, valueOf: (row: T, field: string) => string | number | null): T[] {
  const [requested, requestedDirection] = String(sort ?? '').split(':');
  const field = allowed.has(requested) ? requested : fallback;
  const descending = String(requestedDirection ?? (field === fallback ? 'desc' : 'asc')).toLowerCase() === 'desc';
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row, field) }))
    .sort((a, b) => {
      if (a.value == null || b.value == null) {
        // Rows without a value come last, whatever the direction.
        if (a.value != null) return -1;
        if (b.value != null) return 1;
        return a.index - b.index;
      }
      const order = typeof a.value === 'number' && typeof b.value === 'number'
        ? a.value - b.value
        : compareText(String(a.value), String(b.value));
      // Ties keep the screen's order.
      if (order === 0) return a.index - b.index;
      return descending ? -order : order;
    })
    .map((entry) => entry.row);
}

function chargebackSortValue(row: AiChargebackRow, field: string): string | number | null {
  switch (field) {
    case 'company': return row.company;
    case 'department': return row.department;
    case 'level': return AI_CHARGEBACK_LEVELS.indexOf(row.level);
    case 'share': return row.share;
    case 'paid': return row.paid;
    case 'net': return row.net;
    case 'headcount': return row.headcount;
    case 'cost_per_user': return row.cost_per_user;
    default: return row.amount;
  }
}

export async function listAiChargeback(
  services: AiChargebackServices,
  query: Record<string, any>,
  opts: ReportOpts,
  readAll = false,
): Promise<AiChargebackList<AiChargebackRow>> {
  const { rows, report } = await readChargebackRows(services, query, opts);
  const kept = sortedBy(filterRows(rows, query), query.sort, CHARGEBACK_SORTS, 'amount', chargebackSortValue);
  return { ...paged(kept, query, readAll), report };
}

/** The rows of the filtered report an aggregate adds up: grouped by nature, one report per nature. */
export async function chargebackAggregateRows(
  services: AiChargebackServices,
  query: Record<string, any>,
  opts: ReportOpts,
  groupBy: string,
): Promise<{ rows: AiChargebackRow[]; report: AiChargebackReport }> {
  const { rows, report } = await readChargebackRows(services, query, opts, groupBy === 'nature');
  const kept = filterRows(rows, query);
  // A company's total row and its department rows hold the same amount twice: a group adds up
  // the company rows, or the department and common rows when grouped by department, unless the
  // `level` filter or a group by level says which.
  if (groupBy === 'level' || query.filters?.level) {
    const levels = new Set(kept.map((row) => row.level));
    if (groupBy === 'level' || !(levels.has('company') && levels.size > 1)) return { rows: kept, report };
  }
  const departments = groupBy === 'department';
  return { rows: kept.filter((row) => (departments ? row.level !== 'company' : row.level === 'company')), report };
}

export function chargebackGroupValue(row: AiChargebackRow, groupBy: string): string | null {
  switch (groupBy) {
    case 'company': return row.company;
    case 'department': return row.department;
    case 'level': return row.level;
    case 'nature': return row.nature;
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Company report: `chargeback_lines`.

type CompanyReport = Awaited<ReturnType<ChargebackReportService['generateCompany']>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The company a `company` filter names: its id, its exact name without case, else the one name that
 * contains it. Several names that contain it are refused with the names; none gives null.
 */
async function resolveCompany(manager: EntityManager, tenantId: string, model: any): Promise<{ id: string; name: string } | null> {
  const needle = String(model?.filter ?? '').trim();
  if (!needle) throw new BadRequestException(AI_CHARGEBACK_COMPANY_REQUIRED);
  const companies: Array<{ id: string; name: string }> = await manager.query(
    `SELECT id, name FROM companies WHERE tenant_id = $1 ORDER BY name, id`,
    [tenantId],
  );
  if (UUID_RE.test(needle)) return companies.find((company) => company.id.toLowerCase() === needle.toLowerCase()) ?? null;
  const lower = needle.toLowerCase();
  const exact = companies.filter((company) => company.name.trim().toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const matches = exact.length > 1 ? exact : companies.filter((company) => company.name.toLowerCase().includes(lower));
  if (matches.length > 1) {
    const names = matches.slice(0, 10).map((company) => company.name).join(', ');
    throw new BadRequestException(`Several companies match "${needle}": ${names}${matches.length > 10 ? ', and more' : ''}. Give the company's exact name.`);
  }
  return matches[0] ?? null;
}

function lineRows(report: CompanyReport): AiChargebackLineRow[] {
  return report.items.map((item, index) => {
    const readable = item.readable !== false;
    const ref = item.itemNumber != null ? `BL-${item.itemNumber}` : null;
    return {
      key: readable && item.versionId ? item.versionId : `${ref ?? 'line'}:${index}`,
      item_id: readable ? item.itemId : null,
      ref,
      line: readable ? item.itemName : null,
      nature: item.nature,
      allocation_method: item.allocationMethod,
      amount: item.amount,
      share_pct: item.sharePct,
      readable,
      ...(item.readable !== undefined ? {
        paying_company: item.payingCompanyName ?? null,
        allocation_pct: item.allocationPct ?? null,
        departments: (item.departments ?? []).map((name) => name ?? AI_CHARGEBACK_MISSING_DEPARTMENT),
      } : {}),
    };
  });
}

function companyBlock(report: CompanyReport): AiChargebackCompany {
  const company = report.company;
  return {
    name: company.name,
    consumed: company.total,
    paid: company.paid ?? null,
    net: company.net ?? null,
    headcount: company.headcount,
    it_users: company.itUsers,
    turnover: company.turnover,
    cost_per_user: company.costPerUser,
    cost_per_it_user: company.costPerItUser,
    cost_vs_turnover_pct: company.costVsTurnoverPct,
    departments: report.departments.map((row) => ({
      department: row.departmentId ? row.departmentName ?? AI_CHARGEBACK_MISSING_DEPARTMENT : null,
      level: row.departmentId ? 'department' as const : 'common' as const,
      amount: row.amount,
      share_pct: row.sharePct,
      headcount: row.headcount,
      cost_per_user: row.costPerUser,
    })),
    lines_total: report.itemsTotal,
    lines_total_share: report.itemsTotalShare,
    group_total: report.globalKpi ? report.globalKpi.amount : null,
  };
}

/** A line filter: a BL reference compares exactly, any other text is part of the name. */
function lineMatch(row: AiChargebackLineRow, model: any): boolean {
  if (!model) return true;
  const needle = String(model.filter ?? '').trim();
  if (!needle) return true;
  if (/^BL-\d+$/i.test(needle)) return row.ref != null && row.ref.toLowerCase() === needle.toLowerCase();
  return row.line != null && row.line.toLowerCase().includes(needle.toLowerCase());
}

function lineSortValue(row: AiChargebackLineRow, field: string): string | number | null {
  switch (field) {
    case 'line': return row.line ?? row.ref;
    case 'allocation_method': return row.allocation_method;
    case 'share_pct': return row.share_pct;
    default: return row.amount;
  }
}

export async function listAiChargebackLines(
  services: AiChargebackServices,
  query: Record<string, any>,
  opts: ReportOpts,
  readAll = false,
): Promise<AiChargebackList<AiChargebackLineRow>> {
  const { year, metric, scope } = await resolveParams(services, query, opts);
  const company = await resolveCompany(opts.manager, opts.tenantId, query.filters?.company);
  const base = {
    report: 'company' as const,
    year,
    column: aiColumn(metric),
    nature: natureWord(scope),
    nature_note: NATURE_NOTES[natureWord(scope)],
  };
  if (!company) {
    const empty = paged<AiChargebackLineRow>([], query, readAll);
    return {
      ...empty,
      report: {
        ...base,
        report_total: null,
        reporting_currency: null,
        warnings: [],
        company: null,
        company_note: `No company is named "${String(query.filters?.company?.filter ?? '').trim()}": query_entities on companies gives their names.`,
      },
    };
  }
  // A limited person outside their company nodes: the service's refusal, in its words.
  const report = await services.chargeback.generateCompany(year, metric, company.id, opts.tenantId, { manager: opts.manager, scope });
  const limited = report.dataAccessLimited === true;
  const hidden = (report.fxMissingHiddenLines ?? []).map((number) => `BL-${number}`);
  const warnings = warningsOf(report.warnings);
  if (hidden.length > 0) {
    warnings.push(`Lines outside your access charged to this company have no exchange rate and are left out of its figures: ${hidden.join(', ')}.`);
  }
  const filters = query.filters;
  const needle = String(query.q ?? '').trim().toLowerCase();
  const rows = lineRows(report).filter((row) => lineMatch(row, filters?.line)
    && setMatch(row.allocation_method, filters?.allocation_method)
    && numberMatch(row.amount, filters?.amount)
    && numberMatch(row.share_pct, filters?.share_pct)
    && (!needle || [row.line, row.ref].some((value) => value != null && value.toLowerCase().includes(needle))));
  const kept = sortedBy(rows, query.sort, CHARGEBACK_LINE_SORTS, 'amount', lineSortValue);
  return {
    ...paged(kept, query, readAll),
    report: withWarnings({
      ...base,
      report_total: report.globalKpi ? report.globalKpi.amount : null,
      reporting_currency: report.reportingCurrency,
      warnings,
      ...(limited ? { access_note: AI_CHARGEBACK_LINES_LIMITED_NOTE } : {}),
      company: companyBlock(report),
    }),
  };
}

export function chargebackLineGroupValue(row: AiChargebackLineRow, groupBy: string): string | null {
  switch (groupBy) {
    case 'nature': return row.nature;
    case 'allocation_method': return row.allocation_method;
    default: return null;
  }
}

// ---------------------------------------------------------------------------------------------
// Groups.

export type AiChargebackGroup = { key: string | null; count: number } | { key: string | null; value: number | null };

/** count, or the sum, average, minimum or maximum of a figure, per group (nulls left out). */
export function aggregateChargebackRows<T>(
  rows: T[],
  groupOf: (row: T) => string | null,
  fn: 'count' | 'sum' | 'avg' | 'min' | 'max',
  metric: string | null,
): AiChargebackGroup[] {
  const groups = new Map<string | null, T[]>();
  for (const row of rows) {
    const key = groupOf(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(row);
  }
  const byKey = (a: { key: string | null }, b: { key: string | null }) => compareText(a.key, b.key);
  if (fn === 'count' || !metric) {
    return [...groups.entries()].map(([key, entries]) => ({ key, count: entries.length }))
      .sort((a, b) => b.count - a.count || byKey(a, b));
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  return [...groups.entries()].map(([key, entries]) => {
    const values = entries
      .map((row) => (row as Record<string, unknown>)[metric])
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (values.length === 0) return { key, value: null };
    const sum = values.reduce((acc, value) => acc + value, 0);
    const value = fn === 'sum' ? sum : fn === 'avg' ? sum / values.length : fn === 'min' ? Math.min(...values) : Math.max(...values);
    return { key, value: round(value) };
  }).sort((a, b) => {
    if (a.value == null || b.value == null) return a.value != null ? -1 : b.value != null ? 1 : byKey(a, b);
    return (fn === 'min' ? a.value - b.value : b.value - a.value) || byKey(a, b);
  });
}
