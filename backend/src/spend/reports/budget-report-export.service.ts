import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { DEFAULT_ANALYTICS_AXIS_LABELS } from '../../analytics/analytics-axes.util';
import { localizedBudgetColumnName } from '../../budget-columns/budget-column-labels';
import type { CsvLanguage } from '../../common/csv-sheet/types';
import type { TenantRequest } from '../../common/decorators/tenant.decorator';
import {
  fillLabel,
  reportAmount,
  reportExportRequest,
  writeReportExport,
  type ReportCell,
  type ReportExport,
  type ReportExportFile,
  type ReportTable,
} from '../../common/report-export';
import { budgetListAccess } from '../budget-list/budget-list.runtime';
import { BudgetLinesService } from '../budget-lines.service';
import { CapexItemsService, SpendItemsService } from '../spend-items.service';
import { BUDGET_REPORT_EXPORT_LABELS, type BudgetReportExportLabels } from './budget-report-export.labels';
import type { AnalyticsAxisInfo } from '../../analytics/analytics-axes.util';
import {
  BUDGET_REPORT_KEYS,
  parseBudgetReportParams,
  type BudgetReport,
  type BudgetReportParams,
  type LineExclusions,
  type ReportGroupParam,
} from './budget-report-params';
import {
  accountIdOptionsRequest,
  accountLabelOptions,
  analyticsLinesRequest,
  analyticsRequest,
  columnsCompareRequest,
  consolidationRequest,
  costPerFteRequests,
  dailyRateRequests,
  deltaRequests,
  excludedAccountValues,
  keepValues,
  LINE_NUMBER_FIELD,
  mergeAccountOptions,
  NAME_FIELD,
  NO_ANALYTICS_VALUE,
  NO_CONSOLIDATION_LINE,
  reportFilterModels,
  staffingRequest,
  topItemsRequest,
  trendRequest,
  type AccountRow,
  type AggregateRequest,
  type AggregateResult,
  type BudgetScope,
  type DeltaMode,
  type MetricKey,
  type StaffingLabels,
} from './shared/reportAggregates';
import {
  analyticsTable,
  columnsCompareTable,
  comparisonTable,
  consolidationTable,
  costPerFteTable,
  deltaTable,
  pairLabel,
  shortMonthNames,
  sortColumnSelections,
  staffingTable,
  topLinesTable,
  type ReportTableData,
  type ReportTableLabels,
} from './shared/reportTables';

/**
 * The table exports of the budget aggregate reports (`GET reports/budget/<report>/export`, `<report>` =
 * `comparison`, `columns-compare`, `top-lines`, `increases-decreases`, `consolidation`, `analytics`,
 * `staffing`, `cost-per-fte`): the
 * screen's request, rebuilt with the backend copy of `reportAggregates.ts`, runs on the aggregate
 * route's own path (`summaryAggregateRequest` on the scope's service, the request's manager, the
 * caller's access), and the answer becomes the screen's table through the copy of `reportTables.ts`.
 * A person under data-scoped access gets the figures of their lines (the request's transaction), the
 * access line on the Parameters sheet and no total row.
 */

type Ctx = Pick<TenantRequest, 'tenantId' | 'userId' | 'isAdmin' | 'permissions' | 'manager'>;
type Aggregate = AggregateResult & { dataAccessLimited?: true };

/** The parameters of each report, with the words the Parameters sheet names. */
type Named = { language: CsvLanguage; labels: BudgetReportExportLabels; columnName: (metric: MetricKey) => string };

@Injectable()
export class BudgetReportExportService {
  constructor(
    private readonly opex: SpendItemsService,
    private readonly capex: CapexItemsService,
    private readonly lines: BudgetLinesService,
  ) {}

  async export(report: BudgetReport, query: Record<string, unknown> | null | undefined, ctx: Ctx): Promise<ReportExportFile> {
    const manager = ctx.manager;
    if (!manager) throw new Error('A tenant-bound EntityManager is required');
    const source = query ?? {};
    const request = await reportExportRequest(source, { manager, tenantId: ctx.tenantId, userId: ctx.userId }, BUDGET_REPORT_KEYS[report]);
    const params = await parseBudgetReportParams(report, source, { manager, tenantId: ctx.tenantId, currentYear: new Date().getFullYear() });
    const language = request.language;
    const labels = BUDGET_REPORT_EXPORT_LABELS[language];
    const columnName = (metric: MetricKey) => localizedBudgetColumnName(params.columns, metric, language);
    const named: Named = { language, labels, columnName };
    const tableLabels: ReportTableLabels = {
      columnNames: { budget: columnName('budget'), revision: columnName('revision'), forecast: columnName('forecast'), follow_up: columnName('follow_up'), landing: columnName('landing') },
      columnFte: (column) => fillLabel(labels.columnFte, 'column', column),
      metric: labels.metric,
      year: labels.year,
      column: labels.column,
      selection: labels.selection,
      total: labels.total,
      totalFte: labels.totalFte,
      item: labels.item,
      reference: labels.reference,
      shareOfTotal: labels.shareOfTotal,
      delta: labels.delta,
      pctIncrease: labels.pctIncrease,
      consolidationAccount: labels.consolidationAccount,
      consolidationUnassigned: labels.consolidationUnassigned,
      consolidationTotal: (metric) => fillLabel(labels.consolidationTotal, 'metric', metric),
      analyticsUnassigned: labels.analyticsUnassigned,
      analyticsUnnamed: labels.analyticsUnnamed,
      analyticsTotal: (metric) => fillLabel(labels.analyticsTotal, 'metric', metric),
      analyticsLines: labels.analyticsLines,
      analyticsNature: labels.analyticsNature,
      analyticsLevel: labels.analyticsLevel,
      analyticsLevelValue: labels.analyticsLevelValue,
      analyticsLevelLine: labels.analyticsLevelLine,
      natureOpex: labels.scope_opex,
      natureCapex: labels.scope_capex,
      monthNames: shortMonthNames(language),
      average: labels.average,
      peak: labels.peak,
      fte: labels.measure_fte,
      staffCost: labels.staffCost,
      costPerFte: labels.costPerFte,
      days: labels.days,
      dayCost: labels.dayCost,
      dailyRate: labels.dailyRate,
    };
    // Rows of equal value in the order of the export's language, as the screen in that language.
    const compare = new Intl.Collator(language).compare;
    const run = (aggregate: AggregateRequest) => this.aggregate(params.scope, aggregate, manager, ctx);
    const filters = reportFilterModels(params.picks);

    let table: ReportTableData;
    let answer: Aggregate;
    // Every answer the table reads (two for both directions): one limited answer limits the file.
    let limited = false;
    let sheet: string;
    let fileBase: string;
    let own: Array<[string, string]>;
    if (params.report === 'comparison') {
      const Y = new Date().getFullYear();
      const years: number[] = [];
      for (let y = params.startYear; y <= params.endYear; y += 1) years.push(y);
      // The window the screen reads: the lines still active on 1 January of Y-2.
      answer = await run(trendRequest({ years, metrics: params.metrics, windowYears: [Y - 2, Y - 1, Y, Y + 1, Y + 2], filters, measure: params.measure }));
      table = comparisonTable({ years, metrics: params.metrics, measure: params.measure }, answer, tableLabels);
      sheet = labels.comparisonSheet;
      fileBase = `comparison-${params.scope}-${params.startYear}-${params.endYear}`;
      own = [
        [labels.startYear, String(params.startYear)],
        [labels.endYear, String(params.endYear)],
        [labels.metrics, params.metrics.map(columnName).join(', ')],
      ];
    } else if (params.report === 'columns-compare') {
      const selections = sortColumnSelections(params.selections);
      answer = await run(columnsCompareRequest({ selections, filters, measure: params.measure }));
      const compared = columnsCompareTable({ selections, measure: params.measure, yearGrouping: params.yearGrouping }, answer, tableLabels);
      table = compared;
      sheet = labels.columnsCompareSheet;
      fileBase = `budget-columns-compare-${params.scope}`;
      own = [
        [labels.selection, selections.map((selection) => `${selection.year} ${columnName(selection.metric)}`).join(', ')],
        ...(compared.grouped ? [[labels.yearGrouping, labels.yes] as [string, string]] : []),
      ];
    } else if (params.report === 'top-lines') {
      const excludedLines = await this.excludedLines(params, manager, ctx);
      const excludedAccounts = await this.excludedAccounts(params, manager, ctx, language);
      answer = await run(topItemsRequest({
        scope: params.scope,
        year: params.year,
        metric: params.metric,
        topCount: params.top,
        excludedIds: params.excludeIds,
        excludedAccounts,
        filters,
        measure: params.measure,
      }));
      table = topLinesTable({ year: params.year, metric: params.metric, measure: params.measure }, answer, tableLabels);
      sheet = labels.topLinesSheet;
      fileBase = `top${table.rows.length}-${params.scope}-${params.year}-${params.metric}`;
      own = [
        [labels.year, String(params.year)],
        [labels.metric, columnName(params.metric)],
        [labels.topCount, String(params.top)],
        ...(excludedLines.length ? [[labels.excludeItems, excludedLines.join(', ')] as [string, string]] : []),
        ...(params.excludeAccounts.length ? [[labels.excludeAccounts, params.excludeAccounts.join(', ')] as [string, string]] : []),
      ];
    } else if (params.report === 'increases-decreases') {
      const { source, destination } = params;
      const modes: DeltaMode[] = params.direction === 'both' ? ['increase', 'decrease'] : [params.direction];
      const excludedLines = await this.excludedLines(params, manager, ctx);
      const excludedAccounts = await this.excludedAccounts(params, manager, ctx, language);
      // One request per direction, as the screen (the request's connection: one after the other).
      const answers: Aggregate[] = [];
      for (const request of deltaRequests({
        scope: params.scope,
        source,
        destination,
        modes,
        topCount: params.top,
        excludedIds: params.excludeIds,
        excludedAccounts,
        filters,
        measure: params.measure,
      })) answers.push(await run(request));
      answer = answers[0];
      limited = answers.some((one) => one.dataAccessLimited === true);
      table = deltaTable({ source, destination, modes, measure: params.measure }, answers, tableLabels);
      sheet = labels.deltaSheet;
      const counts = modes.map((mode) => table.rows.filter((row) => row.direction === mode).length);
      fileBase = `top${counts.join('-')}-${params.scope}-delta-${source.year}-${source.metric}-to-${destination.year}-${destination.metric}-${[...modes].sort().join('-')}`;
      own = [
        [labels.sourceYear, String(source.year)],
        [labels.sourceMetric, columnName(source.metric)],
        [labels.destinationYear, String(destination.year)],
        [labels.destinationMetric, columnName(destination.metric)],
        [labels.direction, labels[`direction_${params.direction}`]],
        [labels.topCount, String(params.top)],
        ...(excludedLines.length ? [[labels.excludeItems, excludedLines.join(', ')] as [string, string]] : []),
        ...(params.excludeAccounts.length ? [[labels.excludeAccounts, params.excludeAccounts.join(', ')] as [string, string]] : []),
      ];
    } else if (params.report === 'staffing') {
      const grouped = groupWords(params.group, named);
      answer = await run(staffingRequest({ scope: params.scope, year: params.year, metric: params.metric, group: params.group.group, filters }));
      table = staffingTable({ groupHeader: grouped.header, groupLabels: grouped.labels, compare }, answer, tableLabels);
      sheet = labels.staffingSheet;
      fileBase = `staffing-${params.scope}-${params.year}-${params.metric}-${GROUP_FILE_NAME[params.group.kind]}`;
      own = [
        [labels.groupBy, grouped.header],
        [labels.year, String(params.year)],
        [labels.column, columnName(params.metric)],
      ];
    } else if (params.report === 'cost-per-fte') {
      const grouped = groupWords(params.group, named);
      const pairs = { scope: params.scope, columns: params.pairs, group: params.group.group, filters };
      // One request per pair, as the screen (the request's connection: one after the other).
      const answers: Aggregate[] = [];
      for (const request of (params.view === 'rate' ? dailyRateRequests(pairs) : costPerFteRequests(pairs))) answers.push(await run(request));
      answer = answers[0];
      limited = answers.some((one) => one.dataAccessLimited === true);
      table = costPerFteTable({ groupHeader: grouped.header, groupLabels: grouped.labels, compare, view: params.view, columns: params.pairs }, answers, tableLabels);
      sheet = labels.costPerFteSheet;
      const first = params.pairs[0];
      fileBase = `${params.view === 'rate' ? 'daily-rate' : 'cost-per-fte'}-${params.scope}-${GROUP_FILE_NAME[params.group.kind]}-${first.year}-${first.metric}`;
      own = [
        [labels.groupBy, grouped.header],
        [labels.show, params.view === 'rate' ? labels.dailyRate : labels.costPerFte],
        [labels.pairs, params.pairs.map((pair) => pairLabel(tableLabels, pair)).join(', ')],
      ];
    } else {
      const years: number[] = [];
      for (let y = params.startYear; y <= params.endYear; y += 1) years.push(y);
      const range: Array<[string, string]> = [
        [labels.startYear, String(params.startYear)],
        [labels.endYear, String(params.endYear)],
        [labels.metric, columnName(params.metric)],
      ];
      if (params.report === 'consolidation') {
        const excluded = await this.excludedAccountIds(params, manager, ctx, labels, language);
        answer = await run(consolidationRequest({ years, metric: params.metric, excludedAccountIds: params.excludeAccounts, filters, measure: params.measure }));
        table = consolidationTable({ years, metric: params.metric, measure: params.measure }, answer, tableLabels);
        sheet = labels.consolidationSheet;
        fileBase = `consolidation-${params.scope}-${params.startYear}-${params.endYear}`;
        own = [...range, ...(excluded.length ? [[labels.excludeAccounts, excluded.join(', ')] as [string, string]] : [])];
      } else {
        const excluded = await this.excludedValues(params, manager, ctx, labels);
        const analytics = {
          axisId: params.axis?.id ?? null,
          years,
          metric: params.metric,
          excludedIds: params.excludeValues,
          filters,
          measure: params.measure,
        };
        answer = await run(analyticsRequest(analytics));
        const lineAnswer = params.detail ? await run(analyticsLinesRequest({ ...analytics, scope: params.scope })) : undefined;
        if (lineAnswer?.dataAccessLimited === true) limited = true;
        // The screen's header: the dimension's name, the product name of the default one.
        const dimension = params.axis ? axisLabel(params.axis, language) : labels.analyticsDimension;
        table = analyticsTable({ scope: params.scope, years, metric: params.metric, measure: params.measure, dimension, detail: params.detail }, answer, tableLabels, lineAnswer);
        sheet = labels.analyticsSheet;
        fileBase = `analytics-${params.scope}-${params.startYear}-${params.endYear}`;
        own = [
          ...(params.detail ? [[labels.analyticsDetail, labels.yes] as [string, string]] : []),
          [labels.dimension, dimension],
          ...range,
          ...(excluded.length ? [[labels.excludeValues, excluded.join(', ')] as [string, string]] : []),
        ];
      }
    }

    const exp: ReportExport = {
      fileBase: params.measure === 'fte' ? `${fileBase}-fte` : fileBase,
      limited: limited || answer.dataAccessLimited === true,
      tables: [reportTable(report, sheet, table)],
      parameters: [...filterParameters(params, named, answer), ...own],
    };
    return writeReportExport(exp, request);
  }

  /** The aggregate route's own path: the scope's service, the request's manager, the caller's access. */
  private async aggregate(scope: BudgetScope, request: AggregateRequest, manager: EntityManager, ctx: Ctx): Promise<Aggregate> {
    const opts = { manager, access: budgetListAccess(ctx) };
    const answer = scope === 'all'
      ? await this.lines.summaryAggregateRequest(request, opts)
      : await (scope === 'capex' ? this.capex : this.opex).summaryAggregateRequest(request, opts);
    return answer as unknown as Aggregate;
  }

  /**
   * The excluded lines as `BL-n name`, in the order given. Each must be a line the exclusion picker
   * offers (`itemOptionsRequest`: the lines of the default window the caller reads).
   */
  private async excludedLines(params: LineExclusions, manager: EntityManager, ctx: Ctx): Promise<string[]> {
    if (params.excludeIds.length === 0) return [];
    const found = await this.aggregate(params.scope, {
      query: { filters: { id: keepValues([...params.excludeIds]) } },
      spec: { groupBy: ['id', NAME_FIELD[params.scope], LINE_NUMBER_FIELD[params.scope]], measures: [] },
    }, manager, ctx);
    const byId = new Map(found.groups.map((group) => [String(group.keys[0]), group]));
    return params.excludeIds.map((id) => {
      const group = byId.get(id);
      if (!group) throw new BadRequestException(`excludeIds: ${id} is not a line of this report.`);
      const name = (group.keys[1] ?? '').trim();
      return group.keys[2] != null ? `BL-${group.keys[2]} ${name}`.trim() : name;
    });
  }

  /**
   * The account labels as the lines hold them, for the picked labels (`excludedAccountValues` on the
   * screen's options: `summary/filter-values?fields=account_display`). A label no line holds is a 400.
   */
  private async excludedAccounts(params: LineExclusions, manager: EntityManager, ctx: Ctx, language: CsvLanguage): Promise<string[]> {
    if (params.excludeAccounts.length === 0) return [];
    const opts = { manager, access: budgetListAccess(ctx) };
    const query = { fields: 'account_display' };
    const values = params.scope === 'all'
      ? await this.lines.summaryFilterValues(query, opts)
      : await (params.scope === 'capex' ? this.capex : this.opex).summaryFilterValues(query, opts);
    const collator = new Intl.Collator(language);
    const options = accountLabelOptions(values.account_display ?? [], (a, b) => collator.compare(a, b));
    const known = new Set(options.map((option) => option.id));
    const unknown = params.excludeAccounts.filter((label) => !known.has(label));
    if (unknown.length) throw new BadRequestException(`excludeAccounts: no line holds the account ${unknown.join(', ')}.`);
    return excludedAccountValues(params.excludeAccounts, options);
  }

  /**
   * The excluded accounts of the consolidation report by label (`[number] name`), in the order given.
   * Each must be one the picker offers: an account the lines use (the aggregate, the caller's access)
   * or, for a reader of the accounts page, any account of the tenant (`/accounts`); `none` is the
   * unassigned lines.
   */
  private async excludedAccountIds(
    params: BudgetReportParams & { report: 'consolidation' },
    manager: EntityManager,
    ctx: Ctx,
    labels: BudgetReportExportLabels,
    language: CsvLanguage,
  ): Promise<string[]> {
    const ids = params.excludeAccounts.filter((id) => id !== NO_CONSOLIDATION_LINE);
    const byId = new Map<string, string>();
    if (ids.length) {
      const used = await this.aggregate(params.scope, accountIdOptionsRequest(), manager, ctx);
      const accounts: AccountRow[] = budgetListAccess(ctx).accounts
        ? await manager.query(`SELECT id, account_number, account_name FROM accounts WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [ctx.tenantId, ids])
        : [];
      const collator = new Intl.Collator(language);
      for (const option of mergeAccountOptions(accounts, used, labels.unnamedAccount, (a, b) => collator.compare(a, b))) byId.set(option.id, option.label);
    }
    return params.excludeAccounts.map((id) => {
      if (id === NO_CONSOLIDATION_LINE) return labels.consolidationUnassigned;
      const label = byId.get(id);
      if (label === undefined) throw new BadRequestException(`excludeAccounts: ${id} is not an account of this report.`);
      return label;
    });
  }

  /**
   * The excluded values of the analytics report by name, in the order given: each a value of the
   * dimension grouped on (the default one when none is named); `none` is the lines without a value.
   */
  private async excludedValues(
    params: BudgetReportParams & { report: 'analytics' },
    manager: EntityManager,
    ctx: Ctx,
    labels: BudgetReportExportLabels,
  ): Promise<string[]> {
    const ids = params.excludeValues.filter((id) => id !== NO_ANALYTICS_VALUE);
    const values: Array<{ id: string; name: string | null }> = ids.length
      ? await manager.query(
        `SELECT c.id, c.name FROM analytics_categories c
          WHERE c.tenant_id = $1 AND c.id = ANY($2::uuid[])
            AND c.axis_id = COALESCE($3::uuid, (SELECT a.id FROM analytics_axes a WHERE a.tenant_id = $1 AND a.is_default))`,
        [ctx.tenantId, ids, params.axis?.id ?? null],
      )
      : [];
    const byId = new Map(values.map((value) => [value.id, value.name?.trim() || labels.analyticsUnnamed]));
    return params.excludeValues.map((id) => {
      if (id === NO_ANALYTICS_VALUE) return labels.analyticsUnassigned;
      const name = byId.get(id);
      if (name === undefined) throw new BadRequestException(`excludeValues: ${id} is not a value of this dimension.`);
      return name;
    });
  }
}

/** A dimension as the screens name it: its name, else the product name of the default one. */
function axisLabel(axis: AnalyticsAxisInfo, language: CsvLanguage): string {
  return axis.name?.trim() || DEFAULT_ANALYTICS_AXIS_LABELS[(['en', 'fr', 'de', 'es'] as const).indexOf(language)];
}

/** The grouping in a file name, as the screens name it. */
const GROUP_FILE_NAME: Record<ReportGroupParam['kind'], string> = { costCenter: 'cost-center', item: 'item', supplier: 'supplier', axis: 'dimension' };

/**
 * A grouping as the screens word it (`useReportGroup`): the group column's header (the kind, or the
 * dimension's name) and the rows without a key or without a name.
 */
function groupWords(group: ReportGroupParam, named: Named): { header: string; labels: StaffingLabels } {
  const { labels, language } = named;
  const unnamed = labels.analyticsUnnamed;
  if (group.kind === 'axis') return { header: group.axis ? axisLabel(group.axis, language) : labels.analyticsDimension, labels: { none: labels.none_axis, unnamed } };
  return { header: labels[`group_${group.kind}`], labels: { none: group.kind === 'item' ? '' : labels[`none_${group.kind}`], unnamed } };
}

/** The reports with no measure picker: FTE only, or their own measures. */
const NO_MEASURE: ReadonlySet<BudgetReport> = new Set(['staffing', 'cost-per-fte']);

/** The filter bar's picks in words, then the reporting currency of the amounts. */
function filterParameters(params: BudgetReportParams, named: Named, answer: Aggregate): Array<[string, string]> {
  const { labels, language } = named;
  const out: Array<[string, string]> = [[labels.scope, labels[`scope_${params.scope}`]]];
  if (!NO_MEASURE.has(params.report)) out.push([labels.measure, labels[`measure_${params.measure}`]]);
  if (params.costCenter) out.push([labels.costCenter, params.costCenter]);
  if (params.picks.runBuild) out.push([labels.runBuild, labels[`runBuild_${params.picks.runBuild}`]]);
  if (params.picks.withFte) out.push([labels.fteItems, labels.fteItemsWith]);
  for (const pick of params.analytics) {
    out.push([axisLabel(pick.axis, language), pick.valueName ?? labels.analyticsNone]);
  }
  if (params.measure === 'amount' && params.report !== 'staffing' && answer.reportingCurrency) out.push([labels.reportingCurrency, answer.reportingCurrency.toUpperCase()]);
  return out;
}

/** A shared table as a file table: amounts to the cent, FTE (two decimals shown) and years as numbers, shares as fractions. */
function reportTable(key: string, sheet: string, table: ReportTableData): ReportTable {
  const cells = (row: Record<string, unknown>): ReportCell[] => table.columns.map((column): ReportCell => {
    const value = row[column.key];
    if (value === null || value === undefined) return null;
    if (column.kind === 'text') return String(value);
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    if (column.kind === 'amount') return { kind: 'amount', value: reportAmount(value) };
    return { kind: column.kind === 'count' ? 'number' : column.kind, value };
  });
  return {
    key,
    sheet,
    // FTE and days show two decimals, as the screens; a year and a count stay whole numbers.
    columns: table.columns.map((column) => (column.kind === 'number' && column.key !== 'year'
      ? { header: column.header, kind: column.kind, decimals: 2 as const }
      : { header: column.header, kind: column.kind === 'count' ? 'number' as const : column.kind })),
    rows: table.rows.map(cells),
    footer: table.footer.map(cells),
  };
}
