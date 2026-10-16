import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { PortfolioTeamsService } from './portfolio-teams.service';

@UseGuards(JwtAuthGuard)
@Controller('portfolio/teams')
export class PortfolioTeamsController {
  constructor(private readonly svc: PortfolioTeamsService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get()
  list(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.list(tenantId, { manager: req?.queryRunner?.manager });
  }

  /** The check before a delete: the teams of `ids` it would refuse, and why. Nothing is written. */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post('delete-check')
  deleteCheck(@Body() body: { ids?: unknown }, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.deleteCheck(Array.isArray(body?.ids) ? body.ids : [], tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.get(id, tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post()
  create(
    @Body() body: { name: string; description?: string; is_active?: boolean; display_order?: number; parent_id?: string },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.create(tenantId, body, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; is_active?: boolean; display_order?: number; parent_id?: string | null },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.update(id, tenantId, body, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.delete(id, tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post('seed-defaults')
  seedDefaults(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.seedDefaults(tenantId, req?.queryRunner?.manager);
  }
}
