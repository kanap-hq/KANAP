import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { BulkDeleteResult } from '../common/delete.types';
import { FxRateService } from '../currency/fx-rate.service';
import { AllocationCalculatorService } from './allocation-calculator.service';
import { SUMMARY_SCOPES, summaryTenantId } from './spend-summary.builder';
import { BudgetListAccess } from './budget-list/budget-list.runtime';
import * as budgetList from './budget-list/budget-list.service';
import { CapexItemsDeleteService, SpendItemsDeleteService } from './spend-items-delete.service';
import { BUDGET_NATURES, naturesAnd } from './budget-nature';

type ReadOptions = { manager: EntityManager; access?: BudgetListAccess };

/** The neutral list routes use the same SQL engine with its explicit all-natures scope. */
@Injectable()
export class BudgetLinesService {
  constructor(
    private readonly allocationCalculator: AllocationCalculatorService,
    private readonly fxRates: FxRateService,
    private readonly opexDelete: SpendItemsDeleteService,
    private readonly capexDelete: CapexItemsDeleteService,
  ) {}

  private deps(access?: BudgetListAccess) {
    return { allocationCalculator: this.allocationCalculator, fxRates: this.fxRates, access };
  }

  summary(query: any, opts: ReadOptions) {
    return budgetList.budgetListSummary(SUMMARY_SCOPES.all, this.deps(opts.access), query, opts.manager, {
      includeRecipientDetails: true, includeNextYearAllocation: true,
    });
  }

  summaryTotals(query: any, opts: ReadOptions) {
    return budgetList.budgetListTotals(SUMMARY_SCOPES.all, this.deps(opts.access), query, opts.manager);
  }

  summaryFilterValues(query: any, opts: ReadOptions) {
    return budgetList.budgetListFilterValues(SUMMARY_SCOPES.all, this.deps(opts.access), query, opts.manager);
  }

  summaryIds(query: any, opts: ReadOptions) {
    return budgetList.budgetListIds(SUMMARY_SCOPES.all, this.deps(opts.access), query, opts.manager);
  }

  summaryNeighbors(query: any, id: string, opts: ReadOptions) {
    return budgetList.budgetListNeighbors(SUMMARY_SCOPES.all, this.deps(opts.access), query, id, opts.manager);
  }

  summaryAggregateRequest(body: unknown, opts: ReadOptions) {
    return budgetList.budgetListAggregateRequest(SUMMARY_SCOPES.all, this.deps(opts.access), body, opts.manager);
  }

  async bulkDelete(ids: string[], userId: string | null, opts: { manager: EntityManager }): Promise<BulkDeleteResult> {
    if (!ids.length) return { deleted: [], failed: [] };
    const tenantId = await summaryTenantId(opts.manager);
    // Partition once, locking in global id order before delegating either nature's deletes.
    // Text comparison lets the existing per-item savepoints report malformed ids too.
    const lines: Array<{ id: string; nature: 'opex' | 'capex' }> = await opts.manager.query(
      `SELECT i.id, i.nature FROM spend_items i
       WHERE i.tenant_id = $1${naturesAnd('i', BUDGET_NATURES)} AND i.id::text = ANY($2::text[])
       ORDER BY i.id FOR UPDATE`, [tenantId, ids.map((id) => String(id).toLowerCase())],
    );
    const natureOf = new Map(lines.map((line) => [line.id, line.nature]));
    // Unknown or foreign ids go through the existing not-found path of the OPEX deleter.
    const first = await this.opexDelete.bulkDelete(ids.filter((id) => natureOf.get(String(id).toLowerCase()) !== 'capex'), userId, opts);
    const second = await this.capexDelete.bulkDelete(ids.filter((id) => natureOf.get(String(id).toLowerCase()) === 'capex'), userId, opts);
    const position = new Map(ids.map((id, index) => [id, index]));
    return {
      deleted: [...first.deleted, ...second.deleted].sort((a, b) => position.get(a)! - position.get(b)!),
      failed: [...first.failed, ...second.failed].sort((a, b) => position.get(a.id)! - position.get(b.id)!),
    };
  }
}
