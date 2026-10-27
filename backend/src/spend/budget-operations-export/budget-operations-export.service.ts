import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { localizedBudgetColumnName } from '../../budget-columns/budget-column-labels';
import { readBudgetColumns, type BudgetColumnsSettings } from '../../budget-columns/budget-columns.util';
import { csvProfile } from '../../common/csv-sheet/language';
import type { TenantRequest } from '../../common/decorators/tenant.decorator';
import {
  fillLabel,
  reportAmount,
  reportExportRequest,
  writeReportExport,
  type ReportCell,
  type ReportColumn,
  type ReportExportFile,
} from '../../common/report-export';
import { BUDGET_COLUMN_MEASURE, type BudgetColumn } from '../amounts-write.util';
import { clearColumnParams, operationYear } from '../budget-column-operations';
import type { CopyBudgetOperation } from '../budget-copy';
import { CHARGEBACK_EXPORT_LABELS, chargebackMethodLabel } from '../chargeback-report.export';
import { SpendBudgetOperationsService } from '../spend-budget-operations.service';
import { budgetListAccess } from '../budget-list/budget-list.runtime';
import { BudgetLinesService } from '../budget-lines.service';
import { CapexItemsService, SpendItemsService } from '../spend-items.service';
import {
  operationLinesRequest,
  readOperationLines,
  type AggregateRequest,
  type AggregateResult,
  type BudgetScope,
} from '../reports/shared/reportAggregates';
import { BUDGET_OPERATIONS_EXPORT_LABELS } from './budget-operations-export.labels';
import {
  copyAfterValue,
  copyAllocationsStatus,
  copyAmountsStatus,
  copyBudgetRows,
  type CopyStatus,
} from './shared/copyBudgetRows';

/**
 * The table exports of the budget operations pages (`GET /budget-lines/budget-operations/<operation>/export`):
 * - `clear-column`: the lines of "Reset a column" with the column's amount, from the aggregate the screen
 *   reads (`operationLinesRequest`, the backend copy of `reportAggregates.ts`), in the screen's order
 *   (the amount, largest first).
 * - `copy`: the preview of "Copy budget columns" for the screen's parameters: the aggregate window the
 *   screen reads and the copy's dry run, joined by the rule the screen runs (`shared/copyBudgetRows.ts`,
 *   a byte-identical copy of the frontend file), with the preview's columns and statuses, in the screen's
 *   order (the source amount, largest first, when the amounts are copied). After a real copy the screen
 *   shows what it did and offers no export.
 *
 * The routes are reserved to unscoped persons, as the operations they preview: the aggregate runs with
 * the caller's access all the same, on the request's transaction.
 */

type Ctx = Pick<TenantRequest, 'tenantId' | 'userId' | 'isAdmin' | 'permissions' | 'manager'>;
type Query = Record<string, unknown> | null | undefined;

const RESET_KEYS = ['scope', 'year', 'column'];
const COPY_KEYS = ['scope', 'sourceYear', 'destinationYear', 'amounts', 'allocations', 'sourceColumn', 'destinationColumn', 'percentageIncrease', 'overwrite'];

function text(query: Record<string, unknown>, key: string): string | undefined {
  const value = query[key];
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function required(query: Record<string, unknown>, key: string): string {
  const value = text(query, key);
  if (value === undefined) throw new BadRequestException(`${key} is required.`);
  return value;
}

function scopeOf(query: Record<string, unknown>): BudgetScope {
  const scope = required(query, 'scope');
  if (scope !== 'all' && scope !== 'opex' && scope !== 'capex') throw new BadRequestException('scope must be all, opex or capex.');
  return scope;
}

function flagOf(query: Record<string, unknown>, key: string): boolean {
  const value = query[key];
  if (value === undefined || value === 'false') return false;
  if (value === 'true') return true;
  throw new BadRequestException(`${key} must be true or false.`);
}

/** A column the screen offers: one of the five, shown by the tenant. */
function columnOf(query: Record<string, unknown>, key: string, columns: BudgetColumnsSettings): BudgetColumn {
  const raw = required(query, key);
  if (!Object.prototype.hasOwnProperty.call(BUDGET_COLUMN_MEASURE, raw)) {
    throw new BadRequestException(`${key} must be one of ${Object.keys(BUDGET_COLUMN_MEASURE).join(', ')}.`);
  }
  return shownColumn(raw as BudgetColumn, key, columns);
}

/** A column the screen offers: one of the five, shown by the tenant. */
function shownColumn(column: BudgetColumn, key: string, columns: BudgetColumnsSettings): BudgetColumn {
  if (!columns.enabled[BUDGET_COLUMN_MEASURE[column]]) throw new BadRequestException(`${key}: the column ${column} is hidden.`);
  return column;
}

/** A header of the screen with its year and column (the year first: a column's own name is never read as a placeholder). */
function columnHeader(template: string, column: string, year: number): string {
  return fillLabel(fillLabel(template, 'year', String(year)), 'column', column);
}

@Injectable()
export class BudgetOperationsExportService {
  constructor(
    private readonly opex: SpendItemsService,
    private readonly capex: CapexItemsService,
    private readonly lines: BudgetLinesService,
    private readonly operations: SpendBudgetOperationsService,
  ) {}

  /** "Reset a column": the lines of the year with the column's amount, as the screen's grid. */
  async clearColumn(query: Query, ctx: Ctx): Promise<ReportExportFile> {
    const manager = this.managerOf(ctx);
    const source = query ?? {};
    const request = await reportExportRequest(source, { manager, tenantId: ctx.tenantId, userId: ctx.userId }, RESET_KEYS);
    const scope = scopeOf(source);
    const params = clearColumnParams({ year: required(source, 'year'), column: required(source, 'column') });
    const columns = await readBudgetColumns(manager, ctx.tenantId);
    const column = shownColumn(params.column, 'column', columns);
    const { language } = request;
    const labels = BUDGET_OPERATIONS_EXPORT_LABELS[language];
    const columnName = localizedBudgetColumnName(columns, column, language);

    const answer = await this.aggregate(scope, operationLinesRequest(scope, [params.year], [{ id: 'current', year: params.year, metric: column }]), manager, ctx);
    // The screen's order: the amount, largest first (a stable sort keeps the aggregate's order between equals).
    const lines = readOperationLines(answer, scope)
      .map((line) => ({ line, value: line.values.current ?? 0 }))
      .sort((a, b) => b.value - a.value);

    const tableColumns: ReportColumn[] = [
      { header: labels.resetLine, kind: 'text' },
      ...(scope === 'all' ? [{ header: labels.scope, kind: 'text' } as ReportColumn] : []),
      { header: columnHeader(labels.resetCurrent, columnName, params.year), kind: 'amount' },
    ];
    const rows = lines.map(({ line, value }): ReportCell[] => [
      line.name,
      ...(scope === 'all' ? [line.nature ? labels[`scope_${line.nature}`] : null] : []),
      { kind: 'amount', value: reportAmount(value) },
    ]);
    return writeReportExport({
      fileBase: `column-reset-${scope}-${params.year}-${column}`,
      limited: answer.dataAccessLimited === true,
      tables: [{ key: 'lines', sheet: labels.resetSheet, columns: tableColumns, rows }],
      parameters: [
        [labels.scope, labels[`scope_${scope}`]],
        [labels.resetYear, String(params.year)],
        [labels.resetColumn, columnName],
      ],
    }, request);
  }

  /** "Copy budget columns": the preview of the screen's parameters, as the screen's grid shows it. */
  async copy(query: Query, ctx: Ctx): Promise<ReportExportFile> {
    const manager = this.managerOf(ctx);
    const source = query ?? {};
    const request = await reportExportRequest(source, { manager, tenantId: ctx.tenantId, userId: ctx.userId }, COPY_KEYS);
    const scope = scopeOf(source);
    const sourceYear = operationYear(required(source, 'sourceYear'), 'sourceYear');
    const destinationYear = operationYear(required(source, 'destinationYear'), 'destinationYear');
    const withAmounts = flagOf(source, 'amounts');
    const withAllocations = flagOf(source, 'allocations');
    const overwrite = flagOf(source, 'overwrite');
    const columns = await readBudgetColumns(manager, ctx.tenantId);
    let amounts: { sourceColumn: BudgetColumn; destinationColumn: BudgetColumn; percentage: string } | null = null;
    if (withAmounts) {
      const percentage = text(source, 'percentageIncrease') ?? '0';
      if (!/^-?\d+(\.\d+)?$/.test(percentage)) throw new BadRequestException('percentageIncrease must be a decimal number.');
      amounts = { sourceColumn: columnOf(source, 'sourceColumn', columns), destinationColumn: columnOf(source, 'destinationColumn', columns), percentage };
    } else {
      const unused = ['sourceColumn', 'destinationColumn', 'percentageIncrease'].filter((key) => source[key] !== undefined);
      if (unused.length) throw new BadRequestException(`${unused.join(', ')}: the amounts are not copied.`);
    }
    const { language } = request;
    const labels = BUDGET_OPERATIONS_EXPORT_LABELS[language];
    const columnName = (column: BudgetColumn) => localizedBudgetColumnName(columns, column, language);

    // The two answers the screen joins: the window of lines, then the copy's dry run (it checks the rest:
    // a part asked, the allocations between two years, the percentage, the freeze).
    const window = await this.aggregate(scope, operationLinesRequest(
      scope,
      [sourceYear, destinationYear],
      amounts
        ? [{ id: 'source', year: sourceYear, metric: amounts.sourceColumn }, { id: 'destination', year: destinationYear, metric: amounts.destinationColumn }]
        : [],
    ), manager, ctx);
    const operation: CopyBudgetOperation = {
      scope,
      sourceYear,
      destinationYear,
      amounts: amounts ? { sourceColumn: amounts.sourceColumn, destinationColumn: amounts.destinationColumn, percentageIncrease: amounts.percentage } : null,
      allocations: withAllocations,
      overwrite,
      dryRun: true,
    };
    const preview = await this.operations.copyBudget(operation, ctx.userId || null, { manager });
    const joined = copyBudgetRows(readOperationLines(window, scope), preview.results);
    // The screen's order: the source amount, largest first, when the amounts are copied (a stable sort).
    const rows = amounts ? [...joined].sort((a, b) => b.sourceValue - a.sourceValue) : joined;

    const context = { done: false, sourceYear, destinationYear };
    const methods = CHARGEBACK_EXPORT_LABELS[language];
    const words = (status: CopyStatus | null): string | null => {
      if (!status) return null;
      let out = labels[`status_${status.key}`];
      if (status.year !== undefined) out = fillLabel(out, 'year', String(status.year));
      if (status.method !== undefined) out = fillLabel(out, 'method', chargebackMethodLabel(methods, status.method));
      if (status.message !== undefined) out = fillLabel(out, 'message', status.message);
      return out;
    };
    const method = (code: string | null | undefined): string | null => chargebackMethodLabel(methods, code) || null;
    const amount = (value: number): ReportCell => ({ kind: 'amount', value: reportAmount(value) });

    const tableColumns: ReportColumn[] = [
      { header: labels.copyLine, kind: 'text' },
      ...(scope === 'all' ? [{ header: labels.scope, kind: 'text' } as ReportColumn] : []),
      ...(amounts ? [
        { header: columnHeader(labels.sourceHeader, columnName(amounts.sourceColumn), sourceYear), kind: 'amount' },
        { header: columnHeader(labels.currentHeader, columnName(amounts.destinationColumn), destinationYear), kind: 'amount' },
        { header: columnHeader(labels.afterHeader, columnName(amounts.destinationColumn), destinationYear), kind: 'amount' },
        { header: labels.amountsStatus, kind: 'text' },
      ] as ReportColumn[] : []),
      ...(withAllocations ? [
        { header: fillLabel(labels.allocationSource, 'year', String(sourceYear)), kind: 'text' },
        { header: fillLabel(labels.allocationCurrent, 'year', String(destinationYear)), kind: 'text' },
        { header: fillLabel(labels.allocationAfter, 'year', String(destinationYear)), kind: 'text' },
        { header: labels.allocationsStatus, kind: 'text' },
      ] as ReportColumn[] : []),
    ];
    const cells = rows.map((row): ReportCell[] => [
      row.name,
      ...(scope === 'all' ? [row.nature ? labels[`scope_${row.nature}`] : null] : []),
      ...(amounts ? [amount(row.sourceValue), amount(row.destinationValue), amount(copyAfterValue(row)), words(copyAmountsStatus(row, context))] : []),
      ...(withAllocations ? [
        row.allocations ? method(row.allocations.sourceMethod) : null,
        row.allocations ? method(row.allocations.destinationMethod) : null,
        row.allocations ? method(row.allocations.resultMethod) : null,
        words(copyAllocationsStatus(row, context)),
      ] : []),
    ]);

    const percent = amounts ? `${amounts.percentage.replace('.', csvProfile(language).decimal)}%` : '';
    return writeReportExport({
      fileBase: `copy-budget-${scope}-${sourceYear}-${destinationYear}`,
      limited: window.dataAccessLimited === true,
      tables: [{ key: 'lines', sheet: labels.copySheet, columns: tableColumns, rows: cells }],
      parameters: [
        [labels.scope, labels[`scope_${scope}`]],
        [labels.sourceYear, String(sourceYear)],
        [labels.destinationYear, String(destinationYear)],
        [labels.partsLabel, [...(amounts ? [labels.amounts] : []), ...(withAllocations ? [labels.allocations] : [])].join(', ')],
        ...(amounts ? [
          [labels.sourceColumn, columnName(amounts.sourceColumn)],
          [labels.destinationColumn, columnName(amounts.destinationColumn)],
          [labels.percentageIncrease, percent],
        ] as Array<[string, string]> : []),
        [labels.overwrite, overwrite ? labels.yes : labels.no],
      ],
    }, request);
  }

  private managerOf(ctx: Ctx): EntityManager {
    if (!ctx.manager) throw new Error('A tenant-bound EntityManager is required');
    return ctx.manager;
  }

  /** The aggregate route's own path: the scope's service, the request's manager, the caller's access. */
  private async aggregate(scope: BudgetScope, request: AggregateRequest, manager: EntityManager, ctx: Ctx): Promise<AggregateResult & { dataAccessLimited?: true }> {
    const opts = { manager, access: budgetListAccess(ctx) };
    const answer = scope === 'all'
      ? await this.lines.summaryAggregateRequest(request, opts)
      : await (scope === 'capex' ? this.capex : this.opex).summaryAggregateRequest(request, opts);
    return answer as unknown as AggregateResult & { dataAccessLimited?: true };
  }
}
