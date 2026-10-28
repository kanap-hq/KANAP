import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { recordHistoryModules } from './record-history.inventory';
import { RecordHistoryService } from './record-history.service';

/**
 * The history tab of a record (lot 1B). No new right: the route needs the record's module at
 * `reader` (the guard), and the service checks that exact module for the `:table` (the guard's
 * any-level list only lets a caller through to the table they read). The record is then read under
 * the request transaction before any audit row; an out-of-access record is a 404, as its page.
 *
 * Not reserved to unscoped persons: the history of a record follows the record.
 */
@UseGuards(JwtAuthGuard)
@Controller('records')
export class RecordHistoryController {
  constructor(private readonly history: RecordHistoryService) {}

  @UseGuards(PermissionGuard)
  @RequireAnyLevel(recordHistoryModules().map((resource) => ({ resource, level: 'reader' as const })))
  @Get(':table/:id/history')
  list(
    @Param('table') table: string,
    @Param('id') id: string,
    @Query() query: { cursor?: string; limit?: string },
    @Tenant() ctx: TenantRequest,
  ) {
    return this.history.list(ctx, table, id, { cursor: query?.cursor, limit: query?.limit });
  }
}
