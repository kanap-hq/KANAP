import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { PortfolioSettingsService } from './portfolio-settings.service';

const PORTFOLIO_SETTINGS_READER_REQUIREMENTS = [
  { resource: 'portfolio_requests', level: 'reader' as const },
  { resource: 'portfolio_projects', level: 'reader' as const },
  { resource: 'portfolio_settings', level: 'reader' as const },
];

@UseGuards(JwtAuthGuard)
@Controller('portfolio/settings')
export class PortfolioSettingsController {
  constructor(private readonly svc: PortfolioSettingsService) {}

  @UseGuards(PermissionGuard)
  @RequireAnyLevel(PORTFOLIO_SETTINGS_READER_REQUIREMENTS)
  @Get()
  get(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.get(tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Patch()
  update(@Body() body: any, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.update(tenantId, body, {
      manager: req?.queryRunner?.manager,
      userId: req?.user?.sub ?? null,
    });
  }
}
