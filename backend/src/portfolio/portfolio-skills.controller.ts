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
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { PortfolioSkillsService } from './portfolio-skills.service';

const PORTFOLIO_READER_REQUIREMENTS = [
  { resource: 'tasks', level: 'reader' as const },
  { resource: 'portfolio_requests', level: 'reader' as const },
  { resource: 'portfolio_projects', level: 'reader' as const },
  { resource: 'portfolio_planning', level: 'reader' as const },
  { resource: 'portfolio_reports', level: 'reader' as const },
  { resource: 'portfolio_settings', level: 'reader' as const },
];

@UseGuards(JwtAuthGuard)
@Controller('portfolio/skills')
export class PortfolioSkillsController {
  constructor(private readonly svc: PortfolioSkillsService) {}

  @UseGuards(PermissionGuard)
  @RequireAnyLevel(PORTFOLIO_READER_REQUIREMENTS)
  @Get()
  list(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.list(tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireAnyLevel(PORTFOLIO_READER_REQUIREMENTS)
  @Get('categories')
  getCategories(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.getCategories(tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post()
  create(@Body() body: { category: string; name: string }, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    const userId = req?.user?.sub ?? null;
    return this.svc.create(body, tenantId, userId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post('seed-defaults')
  seedDefaults(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    const userId = req?.user?.sub ?? null;
    return this.svc.seedDefaults(tenantId, userId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { category?: string; name?: string; enabled?: boolean },
    @Req() req: any,
  ) {
    const userId = req?.user?.sub ?? null;
    return this.svc.update(id, body, userId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    const userId = req?.user?.sub ?? null;
    return this.svc.delete(id, userId, { manager: req?.queryRunner?.manager });
  }
}
