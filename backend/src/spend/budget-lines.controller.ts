import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { resolveBusinessContributorScopeForUser } from '../auth/business-contributor-scope';
import { PermissionGuard } from '../auth/permission.guard';
import { ReadOnlyRoute, RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { lookupUsersByIds, requiredUuid } from '../common/lookup/reference-lookups';
import { peopleWithCostCenterAccess, OWNER_SUGGESTIONS_MAX } from '../data-access/data-access-people';
import { resolveBudgetLine } from '../common/resolve-item-id';
import { canReadResource } from '../common/record-usages';
import { buildRelationsAccess } from '../common/relations/relations-access';
import {
  BUDGET_LINE_RELATION_READS,
  budgetLineRelationKindOrThrow,
  type BudgetLineRelationsContext,
} from './budget-line-relations';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { BudgetFileService } from './budget-file/budget-file.service';
import { exportListQuery } from './budget-file/export-file';
import { budgetFileBody } from './budget-file/send-export';
import { parseExportFormat } from '../common/xlsx';
import { budgetListAccess } from './budget-list/budget-list.runtime';
import { ListSpendQueryInput } from './dto';
import { BudgetLinesService } from './budget-lines.service';
import { SpendBudgetOperationsService } from './spend-budget-operations.service';
import type { BudgetOperationScope, CopyBudgetOperation } from './budget-copy';
import type { BudgetColumn } from './amounts-write.util';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';

@UseGuards(JwtAuthGuard)
@Controller('budget-lines')
export class BudgetLinesController {
  constructor(
    private readonly svc: BudgetLinesService,
    private readonly budgetFile: BudgetFileService,
    private readonly budgetOps: SpendBudgetOperationsService,
  ) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get('summary')
  summary(
    @Query() query: ListSpendQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summary(query, { manager: ctx.manager as EntityManager, access: budgetListAccess(ctx) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get('summary/filter-values')
  summaryFilterValues(
    @Query() query: any,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryFilterValues(query, { manager: ctx.manager as EntityManager, access: budgetListAccess(ctx) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get('summary/ids')
  summaryIds(
    @Query() query: ListSpendQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryIds(query, { manager: ctx.manager as EntityManager, access: budgetListAccess(ctx) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get('summary/neighbors')
  async summaryNeighbors(
    @Query() query: ListSpendQueryInput & { id?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    const id = await resolveBudgetLine(String(query?.id ?? ''), ctx.manager as EntityManager);
    return this.svc.summaryNeighbors(query, id.id, { manager: ctx.manager as EntityManager, access: budgetListAccess(ctx) });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get('summary/totals')
  summaryTotals(
    @Query() query: ListSpendQueryInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryTotals(query, { manager: ctx.manager as EntityManager, access: budgetListAccess(ctx) });
  }

  /**
   * Data-scoped access (spec §6.6): the lines of each dimension value that a limited person cannot
   * read, for the analytics report. Body `{ axis, values, year, scope }`: 500 values at most, the
   * report's first year, its tab. A read, so a frozen tenant keeps it; an unscoped person gets
   * `{ counts: {} }` without a counting query.
   */
  @ReadOnlyRoute()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Post('summary/hidden-by-value')
  @HttpCode(200)
  hiddenByValue(
    @Body() body: unknown,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.hiddenCategoryCounts(body, { manager: ctx.manager as EntityManager });
  }

  /**
   * The lines of a list state grouped and measured on the server (reports,
   * dashboard): body `{ query, spec }`, same read level as the list. A read:
   * a frozen tenant keeps it, like the GET routes.
   */
  @ReadOnlyRoute()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Post('summary/aggregate')
  @HttpCode(200)
  summaryAggregate(
    @Body() body: unknown,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.summaryAggregateRequest(body, { manager: ctx.manager as EntityManager, access: budgetListAccess(ctx) });
  }

  /** The budget file (C2a). A read: a frozen tenant keeps it. `ctx` is merged on GET. */
  @ReadOnlyRoute()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Get('budget-file/export')
  async exportBudgetFile(
    @Query() query: Record<string, string>,
    @Res() res: Response,
    @Tenant() ctx: TenantRequest,
  ): Promise<void> {
    const format = parseExportFormat(query.format);
    const listQuery = exportListQuery(query, query.all === 'true' || query.all === '1');
    const { ids } = await this.svc.summaryIds(listQuery, { manager: ctx.manager as EntityManager, access: budgetListAccess(ctx) });
    const exported = await this.budgetFile.exportFile('all', ids, {
      manager: ctx.manager as EntityManager,
      tenantId: ctx.tenantId,
      userId: ctx.userId || null,
    }, {
      language: query.language,
      amountYears: query.amountYears,
      columns: query.columns,
      detail: query.detail,
      format,
    });
    res.send(await budgetFileBody(res, exported));
  }

  // Which lines a delete would refuse (amounts in a frozen column), asked before the confirmation.
  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
  @Post('delete-check')
  deleteCheck(@Body() body: { ids?: unknown }, @Tenant() ctx: TenantRequest) {
    return this.svc.deleteCheck(Array.isArray(body?.ids) ? body.ids : [], { manager: ctx.manager as EntityManager });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Delete('bulk')
  bulkDelete(
    @Body() body: { ids: string[] },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.bulkDelete(body.ids, ctx.userId || null, { manager: ctx.manager as EntityManager });
  }

  /**
   * "Copy budget columns" of Budget administration: the amounts of a column, the allocations, or both, of
   * all lines (`scope: 'all'`) or of one nature, under one tenant lock (`budget-copy.ts`).
   */
  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('budget-operations/copy')
  copyBudget(@Body() body: CopyBudgetOperation, @Tenant() ctx: TenantRequest) {
    return this.budgetOps.copyBudget(body, ctx.userId || null, { manager: ctx.manager as EntityManager });
  }

  /** "Reset a column" of Budget administration, on all lines or one nature (`budget-copy.ts`). */
  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('budget-operations/clear-column')
  clearBudgetColumn(
    @Body() body: { scope: BudgetOperationScope; year: number; column: BudgetColumn },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.budgetOps.clearBudgetColumns(body, ctx.userId || null, { manager: ctx.manager as EntityManager });
  }

  /**
   * The people to propose first as IT or business owner of a line placed on this cost centre: the
   * ones who read it and may open a line there (`peopleWithCostCenterAccess`), names only, in the
   * `USER_LOOKUP` order. The picker still offers every enabled person; this group only comes first.
   *
   * A limited caller asks about a centre it reads or may place a line on, or about the centre of a
   * readable line passed as `line=` (an owner of a line outside its nodes). Out of its scope the
   * answer is empty, like an unknown centre. The group is empty when it leaves nobody out, and the
   * response is capped at `OWNER_SUGGESTIONS_MAX` with `has_more`.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
  @Get('owner-suggestions')
  async ownerSuggestions(@Query() query: any, @Tenant() ctx: TenantRequest) {
    const costCenterId = requiredUuid(query?.cost_center_id, 'cost_center_id');
    const manager = ctx.manager as EntityManager;
    const lineRef = query?.line == null ? '' : String(query.line).trim();
    let lineCostCenterId: string | null = null;
    if (lineRef) {
      // Under RLS: a line the caller cannot read answers 404, as a missing one.
      const line = await resolveBudgetLine(lineRef, manager);
      const [lineRow] = await manager.query(
        `SELECT cost_center_id FROM spend_items WHERE tenant_id = app_current_tenant() AND id = $1`,
        [line.id],
      );
      lineCostCenterId = lineRow?.cost_center_id ?? null;
    }
    const ids = await peopleWithCostCenterAccess(manager, ctx.tenantId, costCenterId, {
      enforceCallerScope: true,
      lineCostCenterId,
    });
    if (ids.length === 0) return { items: [], has_more: false };
    const result = await lookupUsersByIds({ manager, tenantId: ctx.tenantId }, ids, query);
    return {
      items: result.items.slice(0, OWNER_SUGGESTIONS_MAX),
      has_more: result.items.length > OWNER_SUGGESTIONS_MAX,
    };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get('resolve/:ref')
  resolve(@Param('ref') ref: string, @Tenant() ctx: TenantRequest) {
    return resolveBudgetLine(ref, ctx.manager as EntityManager);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
  @Post()
  create(@Body() body: unknown, @Tenant() ctx: TenantRequest) {
    return this.svc.create(body, ctx.userId || undefined, { manager: ctx.manager as EntityManager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: unknown, @Tenant() ctx: TenantRequest) {
    return this.svc.update(id, body, ctx.userId || undefined, { manager: ctx.manager as EntityManager });
  }

  /**
   * Projects, applications, technologies, contracts, assets and supplier suggestions, in one
   * round trip. `:id` is a uuid or a line reference (`BL-n`, `OPX-n`, `CPX-n`).
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get(':id/relations')
  relations(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.relationsContext(ctx).then((rel) => this.svc.relations(id, rel));
  }

  /** Link one project, application, technology, contract or asset (`{ id }`). */
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
  @Post(':id/relations/:kind')
  linkRelation(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Body() body: { id?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.writeRelation(kind, id, String(body?.id ?? ''), true, ctx);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'member')
  @Delete(':id/relations/:kind/:targetId')
  unlinkRelation(
    @Param('id') id: string,
    @Param('kind') kind: string,
    @Param('targetId') targetId: string,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.writeRelation(kind, id, targetId, false, ctx);
  }

  /**
   * An unknown kind is 404 before the participation scopes are read. The module read (403) is
   * the service's, before it parses the target id.
   */
  private writeRelation(kind: string, ref: string, targetId: string, add: boolean, ctx: TenantRequest) {
    budgetLineRelationKindOrThrow(kind);
    return this.relationsContext(ctx).then((rel) => this.svc.setRelation(kind, ref, targetId, add, rel));
  }

  /**
   * What the tab may show. One query after the other: the request's connection runs them in turn.
   * A Business Contributor's scope hides an application or a project they do not take part in.
   */
  private async relationsContext(ctx: TenantRequest): Promise<BudgetLineRelationsContext> {
    const manager = ctx.manager as EntityManager;
    const who = { manager, userId: ctx.userId, tenantId: ctx.tenantId, isAdmin: ctx.isAdmin === true };
    const { access } = buildRelationsAccess(ctx, { read: BUDGET_LINE_RELATION_READS });
    const applicationScope = await resolveBusinessContributorScopeForUser(who, 'applications');
    const projectScope = await resolveBusinessContributorScopeForUser(who, 'portfolio_projects');
    return {
      manager,
      userId: ctx.userId || null,
      access,
      applicationScope,
      projectScope,
    };
  }

  /**
   * The contract picker: each candidate the caller can read, with the fields that would differ
   * once linked. Without the contracts right the answer is empty and no contract is read.
   * `:id` is a uuid or a line reference. Declared before the generic detail route.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get(':id/contract-consistency')
  contractConsistency(@Param('id') id: string, @Query('ids') ids: string | undefined, @Tenant() ctx: TenantRequest) {
    return this.svc.contractConsistency(id, ids, {
      manager: ctx.manager as EntityManager,
      contractsAccess: canReadResource(ctx, 'contracts'),
    });
  }

  // Keep the generic detail route after every static GET path.
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get(':ref')
  get(@Param('ref') ref: string, @Tenant() ctx: TenantRequest) {
    return this.svc.get(ref, { manager: ctx.manager as EntityManager });
  }

}
