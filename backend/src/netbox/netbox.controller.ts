import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import {
  NetboxConfigService,
  NetboxIntegrationSaveInput,
  NetboxTestInput,
} from './netbox-config.service';
import { NetboxResolveInput, NetboxSyncInput, NetboxSyncService } from './netbox-sync.service';
import { LongRunningRequest, OUTSIDE_WORK_TIMEOUTS } from '../common/request-db-timeouts';

// Netbox inventory administration. Everything is infrastructure:admin except
// the status endpoint, which the home tile reads.
//
// These handlers run inside the request's tenant transaction like the rest of
// the application: PermissionGuard resolves the caller's roles through that
// same query runner, and row-level security would hide them without it. The
// endpoints that call Netbox over HTTP therefore hold their transaction while
// they wait; the manual run does not, because it answers immediately and does
// its work in the background.
@UseGuards(JwtAuthGuard)
@Controller('netbox')
export class NetboxController {
  constructor(
    private readonly config: NetboxConfigService,
    private readonly sync: NetboxSyncService,
  ) {}

  private manager(req: any) {
    return req?.queryRunner?.manager;
  }

  private tenantId(req: any): string {
    return req?.tenant?.id ?? '';
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Get('integration')
  async getIntegration(@Req() req: any) {
    const manager = this.manager(req);
    return this.config.toView(await this.config.getConfig(manager, this.tenantId(req)));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Put('integration')
  saveIntegration(@Body() body: NetboxIntegrationSaveInput, @Req() req: any) {
    return this.config.save(this.manager(req), this.tenantId(req), body ?? {});
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @Post('integration/test')
  testIntegration(@Body() body: NetboxTestInput, @Req() req: any) {
    return this.sync.testConnection(this.manager(req), this.tenantId(req), body ?? {});
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @Get('mapping-options')
  mappingOptions(@Req() req: any) {
    return this.sync.mappingOptions(this.manager(req), this.tenantId(req));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Put('mapping')
  saveMapping(@Body() body: { role_map?: unknown; site_map?: unknown; os_map?: unknown }, @Req() req: any) {
    return this.config.saveMapping(this.manager(req), this.tenantId(req), body ?? {});
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
  @Post('sync/preview')
  preview(@Body() body: NetboxSyncInput, @Req() req: any) {
    return this.sync.preview(this.manager(req), this.tenantId(req), body ?? {});
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Post('sync')
  startSync(@Body() body: NetboxSyncInput, @Req() req: any) {
    return this.sync.startManualRun(this.manager(req), this.tenantId(req), body ?? {});
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('status')
  status(@Req() req: any) {
    return this.sync.getStatus(this.manager(req), this.tenantId(req));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Get('records')
  listRecords(@Query() query: any, @Req() req: any) {
    return this.sync.listRecords(this.manager(req), this.tenantId(req), query ?? {});
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Post('records/:id/resolve')
  resolveRecord(@Param('id') id: string, @Body() body: NetboxResolveInput, @Req() req: any) {
    return this.sync.resolveRecord(this.manager(req), this.tenantId(req), id, body ?? {});
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Post('records/:id/unignore')
  unignoreRecord(@Param('id') id: string, @Req() req: any) {
    return this.sync.unignoreRecord(this.manager(req), this.tenantId(req), id);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'admin')
  @Post('records/:id/retire-asset')
  retireAsset(@Param('id') id: string, @Req() req: any) {
    return this.sync.retireAsset(this.manager(req), this.tenantId(req), id, req?.user?.sub ?? null);
  }
}
