import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { PortfolioClassificationService, type ClassificationKind } from './portfolio-classification.service';

const PORTFOLIO_READER_REQUIREMENTS = [
  { resource: 'tasks', level: 'reader' as const },
  { resource: 'portfolio_requests', level: 'reader' as const },
  { resource: 'portfolio_projects', level: 'reader' as const },
  { resource: 'portfolio_planning', level: 'reader' as const },
  { resource: 'portfolio_reports', level: 'reader' as const },
  { resource: 'portfolio_settings', level: 'reader' as const },
];

@UseGuards(JwtAuthGuard)
@Controller('portfolio/classification')
export class PortfolioClassificationController {
  constructor(private readonly svc: PortfolioClassificationService) {}

  // ============================================
  // Combined endpoint for dropdown data
  // ============================================

  @UseGuards(PermissionGuard)
  @RequireAnyLevel(PORTFOLIO_READER_REQUIREMENTS)
  @Get('all')
  getAll(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.getAll(tenantId, { manager: req?.queryRunner?.manager });
  }

  // ============================================
  // Sources
  // ============================================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get('sources')
  listSources(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.listSources(tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get('sources/:id')
  getSource(@Param('id') id: string, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.getSource(id, tenantId, { manager: req?.queryRunner?.manager });
  }

  /** The check before a delete: the items of `ids` it would refuse, and why. Nothing is written. */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post('sources/delete-check')
  deleteCheckSources(@Body() body: { ids?: unknown }, @Req() req: any) {
    return this.deleteCheck('sources', body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post('sources')
  createSource(
    @Body() body: { name: string; description?: string; is_active?: boolean; display_order?: number },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.createSource(tenantId, body, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Patch('sources/:id')
  updateSource(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; is_active?: boolean; display_order?: number },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.updateSource(id, tenantId, body, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Delete('sources/:id')
  deleteSource(@Param('id') id: string, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.deleteSource(id, tenantId, { manager: req?.queryRunner?.manager });
  }

  // ============================================
  // Categories
  // ============================================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get('categories')
  listCategories(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.listCategories(tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get('categories/with-streams')
  getCategoriesWithStreams(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.getCategoriesWithStreams(tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get('categories/:id')
  getCategory(@Param('id') id: string, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.getCategory(id, tenantId, { manager: req?.queryRunner?.manager });
  }

  /** The check before a delete: the items of `ids` it would refuse, and why. Nothing is written. */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post('categories/delete-check')
  deleteCheckCategories(@Body() body: { ids?: unknown }, @Req() req: any) {
    return this.deleteCheck('categories', body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post('categories')
  createCategory(
    @Body() body: { name: string; description?: string; is_active?: boolean; display_order?: number },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.createCategory(tenantId, body, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Patch('categories/:id')
  updateCategory(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; is_active?: boolean; display_order?: number },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.updateCategory(id, tenantId, body, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Delete('categories/:id')
  deleteCategory(@Param('id') id: string, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.deleteCategory(id, tenantId, { manager: req?.queryRunner?.manager });
  }

  // ============================================
  // Streams
  // ============================================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get('streams')
  listStreams(@Query('categoryId') categoryId: string | undefined, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.listStreams(tenantId, categoryId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_requests', 'reader')
  @Get('streams/:id')
  getStream(@Param('id') id: string, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.getStream(id, tenantId, { manager: req?.queryRunner?.manager });
  }

  /** The check before a delete: the items of `ids` it would refuse, and why. Nothing is written. */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post('streams/delete-check')
  deleteCheckStreams(@Body() body: { ids?: unknown }, @Req() req: any) {
    return this.deleteCheck('streams', body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post('streams')
  createStream(
    @Body()
    body: {
      category_id: string;
      name: string;
      description?: string;
      is_active?: boolean;
      display_order?: number;
    },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.createStream(tenantId, body, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Patch('streams/:id')
  updateStream(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      description?: string;
      is_active?: boolean;
      display_order?: number;
      category_id?: string;
    },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.updateStream(id, tenantId, body, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Delete('streams/:id')
  deleteStream(@Param('id') id: string, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.deleteStream(id, tenantId, { manager: req?.queryRunner?.manager });
  }

  // ============================================
  // Task Types
  // ============================================

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get('task-types')
  listTaskTypes(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.listTaskTypes(tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get('task-types/:id')
  getTaskType(@Param('id') id: string, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.getTaskType(id, tenantId, { manager: req?.queryRunner?.manager });
  }

  /** The check before a delete: the items of `ids` it would refuse, and why. Nothing is written. */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post('task-types/delete-check')
  deleteCheckTaskTypes(@Body() body: { ids?: unknown }, @Req() req: any) {
    return this.deleteCheck('task-types', body, req);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post('task-types')
  createTaskType(
    @Body() body: { name: string; description?: string; is_active?: boolean; display_order?: number },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.createTaskType(tenantId, body, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Patch('task-types/:id')
  updateTaskType(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; is_active?: boolean; display_order?: number },
    @Req() req: any,
  ) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.updateTaskType(id, tenantId, body, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Delete('task-types/:id')
  deleteTaskType(@Param('id') id: string, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.deleteTaskType(id, tenantId, { manager: req?.queryRunner?.manager });
  }

  private deleteCheck(kind: ClassificationKind, body: { ids?: unknown }, req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.deleteCheck(kind, Array.isArray(body?.ids) ? body.ids : [], tenantId, { manager: req?.queryRunner?.manager });
  }

  // ============================================
  // Seeding
  // ============================================

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Post('seed-defaults')
  seedDefaults(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.seedAllDefaults(tenantId, req?.queryRunner?.manager);
  }
}
