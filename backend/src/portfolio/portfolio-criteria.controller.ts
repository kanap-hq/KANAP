import {
  Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { PortfolioCriteriaService } from './portfolio-criteria.service';

const PORTFOLIO_SCORING_READER_REQUIREMENTS = [
  { resource: 'portfolio_requests', level: 'reader' as const },
  { resource: 'portfolio_projects', level: 'reader' as const },
  { resource: 'portfolio_settings', level: 'reader' as const },
];

@UseGuards(JwtAuthGuard)
@Controller('portfolio/criteria')
export class PortfolioCriteriaController {
  constructor(private readonly svc: PortfolioCriteriaService) {}

  @UseGuards(PermissionGuard)
  @RequireAnyLevel(PORTFOLIO_SCORING_READER_REQUIREMENTS)
  @Get()
  list(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.list(tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireAnyLevel(PORTFOLIO_SCORING_READER_REQUIREMENTS)
  @Get(':id')
  get(@Param('id') id: string, @Req() req: any) {
    return this.svc.get(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post()
  create(@Body() body: any, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.create(body, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post('reorder')
  reorder(@Body() body: { criterion_ids: string[] }, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.reorder(body?.criterion_ids ?? [], tenantId, {
      manager: req?.queryRunner?.manager,
      userId: req?.user?.sub ?? null,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Patch(':id')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.update(id, body, tenantId, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Delete(':id')
  delete(@Param('id') id: string, @Req() req: any) {
    return this.svc.delete(id, req.user?.sub ?? null, {
      manager: req?.queryRunner?.manager,
    });
  }

  // Request scoring endpoints
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'member')
  @Post('requests/:requestId/score')
  updateRequestCriteria(
    @Param('requestId') requestId: string,
    @Body() body: { criteria_values: Record<string, string> },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.updateRequestCriteria(
      requestId,
      body?.criteria_values ?? {},
      tenantId,
      req.user?.sub ?? null,
      { manager: req?.queryRunner?.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'admin') // Higher permission for override
  @Post('requests/:requestId/override')
  setOverride(
    @Param('requestId') requestId: string,
    @Body() body: { enabled: boolean; value?: number; justification?: string },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.setOverride(
      requestId,
      body?.enabled === true,
      body?.value ?? null,
      body?.justification ?? null,
      tenantId,
      req.user?.sub ?? null,
      { manager: req?.queryRunner?.manager },
    );
  }

  // Project scoring endpoints
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'member')
  @Post('projects/:projectId/score')
  updateProjectCriteria(
    @Param('projectId') projectId: string,
    @Body() body: { criteria_values: Record<string, string> },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.updateProjectCriteria(
      projectId,
      body?.criteria_values ?? {},
      tenantId,
      req.user?.sub ?? null,
      { manager: req?.queryRunner?.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'admin') // Higher permission for override
  @Post('projects/:projectId/override')
  setProjectOverride(
    @Param('projectId') projectId: string,
    @Body() body: { enabled: boolean; value?: number; justification?: string },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.setProjectOverride(
      projectId,
      body?.enabled === true,
      body?.value ?? null,
      body?.justification ?? null,
      tenantId,
      req.user?.sub ?? null,
      { manager: req?.queryRunner?.manager },
    );
  }
}
