import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../../auth/platform-admin.guard';
import { MultiTenantOnlyGuard } from '../../common/feature-gates';
import { OpsSnapshotService } from './ops-snapshot.service';
import type { OpsSnapshotDto } from './dto/ops-snapshot.dto';

@UseGuards(MultiTenantOnlyGuard, JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/ops')
export class AdminOpsController {
  constructor(private readonly snapshots: OpsSnapshotService) {}

  @Get('snapshot')
  async snapshot(): Promise<OpsSnapshotDto> {
    return this.snapshots.build();
  }
}
