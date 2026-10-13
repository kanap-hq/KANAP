import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { ReadOnlyRoute, RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { resolveBudgetLine } from '../common/resolve-item-id';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { contentDisposition } from '../common/content-disposition';
import { BudgetFileService } from './budget-file/budget-file.service';
import { exportListQuery } from './budget-file/export-file';
import { budgetListAccess } from './budget-list/budget-list.runtime';
import { ListSpendQueryInput } from './dto';
import { BudgetLinesService } from './budget-lines.service';
import { SpendBudgetOperationsService } from './spend-budget-operations.service';
import type { BudgetOperationScope, CopyBudgetOperation } from './budget-copy';
import type { BudgetColumn } from './amounts-write.util';

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
    const listQuery = exportListQuery(query, query.all === 'true' || query.all === '1');
    const { ids } = await this.svc.summaryIds(listQuery, { manager: ctx.manager as EntityManager, access: budgetListAccess(ctx) });
    const { filename, content } = await this.budgetFile.exportFile('all', ids, {
      manager: ctx.manager as EntityManager,
      tenantId: ctx.tenantId,
      userId: ctx.userId || null,
    }, {
      language: query.language,
      amountYears: query.amountYears,
      columns: query.columns,
      detail: query.detail,
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

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
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('budget-operations/copy')
  copyBudget(@Body() body: CopyBudgetOperation, @Tenant() ctx: TenantRequest) {
    return this.budgetOps.copyBudget(body, ctx.userId || null, { manager: ctx.manager as EntityManager });
  }

  /** "Reset a column" of Budget administration, on all lines or one nature (`budget-copy.ts`). */
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

  // Keep the generic detail route after every static GET path.
  @UseGuards(PermissionGuard)
  @RequireLevel('budget', 'reader')
  @Get(':ref')
  get(@Param('ref') ref: string, @Tenant() ctx: TenantRequest) {
    return this.svc.get(ref, { manager: ctx.manager as EntityManager });
  }

}
