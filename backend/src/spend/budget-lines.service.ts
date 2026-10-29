import { BadRequestException, Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { BulkDeleteResult } from '../common/delete.types';
import { checkIds, type DeleteRefusal } from '../common/record-in-use';
import { resolveBudgetLine } from '../common/resolve-item-id';
import { FxRateService } from '../currency/fx-rate.service';
import { AllocationCalculatorService } from './allocation-calculator.service';
import { SUMMARY_SCOPES, summaryTenantId } from './spend-summary.builder';
import { BudgetListAccess } from './budget-list/budget-list.runtime';
import * as budgetList from './budget-list/budget-list.service';
import { CapexItemsDeleteService, SpendItemsDeleteService } from './spend-items-delete.service';
import { BUDGET_NATURES, naturesAnd, type BudgetNature } from './budget-nature';
import {
  readBudgetLineRelations,
  setBudgetLineRelation,
  type BudgetLineRelationsContext,
} from './budget-line-relations';
import { budgetLineContractConsistency } from '../contracts/contract-line-match';
import { CapexItemsService, SpendItemsService } from './spend-items.service';
import { hiddenCategoryLineCounts } from '../data-access/hidden-links';

type ReadOptions = { manager: EntityManager; access?: BudgetListAccess };

/** The most values one hidden-count request names. */
const MAX_HIDDEN_VALUES = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The neutral list routes use the same SQL engine with its explicit all-natures scope. */
@Injectable()
export class BudgetLinesService {
  constructor(
    private readonly allocationCalculator: AllocationCalculatorService,
    private readonly fxRates: FxRateService,
    private readonly opexDelete: SpendItemsDeleteService,
    private readonly capexDelete: CapexItemsDeleteService,
    private readonly opexItems: SpendItemsService,
    private readonly capexItems: CapexItemsService,
    private readonly audit: AuditService,
  ) {}

  private items(nature: BudgetNature) {
    return nature === 'opex' ? this.opexItems : this.capexItems;
  }

  private nativeBody(body: unknown, nature: BudgetNature, updating: boolean): Record<string, unknown> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('A budget line body is required.');
    }
    const input = body as Record<string, unknown>;
    if (updating && Object.prototype.hasOwnProperty.call(input, 'nature')) {
      throw new BadRequestException('Use change-type to change the type of a budget line.');
    }
    if (nature === 'capex' && Object.prototype.hasOwnProperty.call(input, 'contract_id')) {
      throw new BadRequestException('Contract cannot be written on a CAPEX line.');
    }
    return input;
  }

  async get(ref: string, opts: { manager: EntityManager }) {
    const line = await resolveBudgetLine(ref, opts.manager);
    return this.items(line.nature).getDetail(line.id, { ...opts, native: true });
  }

  async create(body: unknown, userId: string | undefined, opts: { manager: EntityManager }) {
    const nature = (body as any)?.nature;
    if (nature !== 'opex' && nature !== 'capex') throw new BadRequestException('nature must be opex or capex.');
    const input = this.nativeBody(body, nature, false);
    const created = await this.items(nature).create(input, userId, { ...opts, fields: 'columns', native: true });
    return this.get(created.id, opts);
  }

  async update(ref: string, body: unknown, userId: string | undefined, opts: { manager: EntityManager }) {
    const line = await resolveBudgetLine(ref, opts.manager);
    const input = this.nativeBody(body, line.nature, true);
    await this.items(line.nature).update(line.id, input, userId, { ...opts, fields: 'columns', native: true });
    return this.get(line.id, opts);
  }

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

  /**
   * Data-scoped access (spec §6.6): the lines of each dimension value that the person cannot read,
   * for the analytics report. Body `{ axis, values, year?, scope }`: the dimension, its values (500
   * at most), the report's first year and its tab (`all`, `opex` or `capex`). The window is the
   * engine's `windowScope`, computed here in UTC: 1 January of `year`, or of the server's current
   * year - 1 when none is given. An unscoped person gets an empty answer without a counting query
   * (`hiddenCategoryLineCounts`).
   */
  async hiddenCategoryCounts(body: unknown, opts: { manager: EntityManager }) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('A body is required.');
    const input = body as Record<string, unknown>;
    const axis = input.axis;
    if (typeof axis !== 'string' || !UUID.test(axis)) throw new BadRequestException('axis must be a dimension id.');
    if (!Array.isArray(input.values)) throw new BadRequestException('values must be a list of value ids.');
    if (input.values.length === 0) throw new BadRequestException('values must name at least one value id.');
    if (input.values.length > MAX_HIDDEN_VALUES) throw new BadRequestException(`values holds ${MAX_HIDDEN_VALUES} values at most.`);
    const values: string[] = [];
    for (const value of input.values) {
      if (typeof value !== 'string' || !UUID.test(value)) throw new BadRequestException('values must be value ids.');
      values.push(value.toLowerCase());
    }
    const scope = input.scope;
    if (scope !== 'all' && scope !== 'opex' && scope !== 'capex') throw new BadRequestException('scope must be all, opex or capex.');
    const currentYear = new Date().getFullYear();
    let year: number;
    if (input.year == null) {
      year = currentYear - 1;
    } else {
      if (typeof input.year !== 'number' || !Number.isInteger(input.year)) throw new BadRequestException('year must be a whole year.');
      year = input.year;
    }
    budgetList.assertBudgetYearsWithinBounds([year], currentYear);
    const counts = await hiddenCategoryLineCounts(
      opts.manager,
      axis.toLowerCase(),
      Array.from(new Set(values)),
      `${year}-01-01`,
      scope === 'all' ? null : scope,
    );
    return { counts: Object.fromEntries(counts) };
  }

  /** The lines of `ids` as the unified list draws them (the AI detail, which names its line by id). */
  summaryRowsByIds(
    ids: string[],
    query: {
      years?: number[];
      includeRecipientDetails?: boolean;
      includeLatestTask?: boolean;
      includeNextYearAllocation?: boolean;
    } = {},
    opts: { manager: EntityManager },
  ) {
    return budgetList.budgetListRowsByIds(SUMMARY_SCOPES.all, this.deps(), { ...query, ids }, opts.manager);
  }

  /** The lines of a list state grouped and measured, both natures (`budgetListAggregate`). */
  summaryAggregate(query: any, spec: unknown, opts: ReadOptions) {
    return budgetList.budgetListAggregate(SUMMARY_SCOPES.all, this.deps(opts.access), query, spec as any, opts.manager);
  }

  // The children of one line, read through the service of its nature (their routes' contract).
  listApplications(id: string, nature: BudgetNature, opts: { manager: EntityManager }) {
    return this.items(nature).listApplications(id, opts);
  }

  listProjects(id: string, nature: BudgetNature, opts: { manager: EntityManager }) {
    return this.items(nature).listProjects(id, opts);
  }

  listLinks(id: string, nature: BudgetNature, opts: { manager: EntityManager }) {
    return this.items(nature).listLinks(id, opts);
  }

  listAttachments(id: string, nature: BudgetNature, opts: { manager: EntityManager }) {
    return this.items(nature).listAttachments(id, opts);
  }

  /**
   * The check before a delete (`POST /budget-lines/delete-check`): the lines of either nature
   * with amounts in a frozen budget column, in the order asked (each nature's `deleteCheck`).
   */
  async deleteCheck(ids: unknown[], opts: { manager: EntityManager }): Promise<{ refused: DeleteRefusal[] }> {
    // One after the other: both read on the request's connection.
    const opex = await this.opexDelete.deleteCheck(ids, opts);
    const capex = await this.capexDelete.deleteCheck(ids, opts);
    const position = new Map(checkIds(ids).map((id, index) => [id, index]));
    return { refused: [...opex.refused, ...capex.refused].sort((a, b) => position.get(a.id)! - position.get(b.id)!) };
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

  /** The Relations tab in one round trip (`budget-line-relations.ts`). */
  relations(ref: string, ctx: BudgetLineRelationsContext) {
    return readBudgetLineRelations(ctx.manager, ref, ctx);
  }

  /**
   * The contract picker: mismatches a candidate would have once linked. Without the contracts
   * right the answer is empty and no contract is read. A missing line, or one outside data access, is 404.
   */
  contractConsistency(ref: string, rawIds: unknown, opts: { manager: EntityManager; contractsAccess: boolean }) {
    return budgetLineContractConsistency(opts.manager, ref, rawIds, opts.contractsAccess);
  }

  /** Link or unlink one row of the tab. The line is locked; one audit row when the set changes. */
  setRelation(kind: string, ref: string, targetId: string, add: boolean, ctx: BudgetLineRelationsContext) {
    return setBudgetLineRelation(
      { manager: ctx.manager, audit: this.audit },
      kind,
      ref,
      targetId,
      add,
      ctx.userId,
      ctx,
    );
  }
}
