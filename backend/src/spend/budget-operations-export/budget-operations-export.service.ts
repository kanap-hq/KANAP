import { BadRequestException, Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { localizedBudgetColumnName } from '../../budget-columns/budget-column-labels';
import { readBudgetColumns, type BudgetColumnsSettings } from '../../budget-columns/budget-columns.util';
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
import { clearColumnParams } from '../budget-column-operations';
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

/**
 * The table exports of the budget operations pages (`GET /budget-lines/budget-operations/<operation>/export`):
 * - `clear-column`: the lines of "Reset a column" with the column's amount, from the aggregate the screen
 *   reads (`operationLinesRequest`, the backend copy of `reportAggregates.ts`), in the screen's order
 *   (the amount, largest first).
 *
 * The routes are reserved to unscoped persons, as the operations they preview: the aggregate runs with
 * the caller's access all the same, on the request's transaction.
 */

type Ctx = Pick<TenantRequest, 'tenantId' | 'userId' | 'isAdmin' | 'permissions' | 'manager'>;
type Query = Record<string, unknown> | null | undefined;

const RESET_KEYS = ['scope', 'year', 'column'];

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
