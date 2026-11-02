import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { DashboardService } from './dashboard.service';
import { DashboardDataService } from './dashboard-data.service';
import { UpdateDashboardConfigDto, UpdateHomeDashboardConfigDto } from './dto/update-dashboard-config.dto';
import { resolveBusinessContributorScopeForUser } from '../auth/business-contributor-scope';
import { existingRecentItems, type RecentItemRef } from './recent-items';
import { incidentViewerFromContext } from '../incidents/incident-visibility';

/** Query numbers come in as strings; keep them inside the bounds the tiles offer (a negative LIMIT is a 500). */
function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = parseInt(String(raw ?? ''), 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.min(max, Math.max(min, value));
}

@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly svc: DashboardService,
    private readonly dataSvc: DashboardDataService,
  ) {}

  // ==================== CONFIG ENDPOINTS ====================
  // These use JwtAuthGuard only - user's own data

  /**
   * Of the user's "Recently viewed" entries, the records that still exist (`recent-items.ts`);
   * the list drops the others.
   */
  @Post('recent-items/existing')
  existingRecentItems(@Body() body: { items?: RecentItemRef[] }, @Tenant() ctx: TenantRequest) {
    // The request transaction, with the tenant set (RLS), is always there behind JwtAuthGuard.
    return existingRecentItems(ctx.manager!, ctx.tenantId, Array.isArray(body?.items) ? body.items : []);
  }

  /**
   * Get user's dashboard configuration (or default if none exists)
   */
  @Get('config')
  async getConfig(@Tenant() ctx: TenantRequest) {
    return this.svc.getConfig(ctx.userId!, { manager: ctx.manager });
  }

  /**
   * Save user's dashboard configuration
   */
  @Put('config')
  async saveConfig(
    @Tenant() ctx: TenantRequest,
    @Body() dto: UpdateHomeDashboardConfigDto,
  ) {
    return this.svc.saveConfig(ctx.userId!, dto, { manager: ctx.manager });
  }

  /**
   * Reset user's dashboard configuration to defaults
   */
  @Post('config/reset')
  async resetConfig(@Tenant() ctx: TenantRequest) {
    return this.svc.resetConfig(ctx.userId!, { manager: ctx.manager });
  }

  @Get('budget-config')
  async getBudgetConfig(@Tenant() ctx: TenantRequest) {
    return this.svc.getBudgetConfig(ctx.userId!, { manager: ctx.manager });
  }

  @Put('budget-config')
  async saveBudgetConfig(@Tenant() ctx: TenantRequest, @Body() dto: UpdateDashboardConfigDto) {
    return this.svc.saveBudgetConfig(ctx.userId!, dto, { manager: ctx.manager });
  }

  @Post('budget-config/reset')
  async resetBudgetConfig(@Tenant() ctx: TenantRequest) {
    return this.svc.resetBudgetConfig(ctx.userId!, { manager: ctx.manager });
  }

  // ==================== TILE DATA ENDPOINTS ====================
  // These require specific permissions based on the data they access

  /** Same participant scope as the list endpoints: business contributors only see what they take part in. */
  private participantScope(ctx: TenantRequest, resource: 'portfolio_projects' | 'tasks') {
    return resolveBusinessContributorScopeForUser(
      { manager: ctx.manager!, userId: ctx.userId!, tenantId: ctx.tenantId ?? null, isAdmin: ctx.isAdmin === true },
      resource,
      'reader',
    );
  }

  /**
   * Get projects where the current user is a lead or sponsor
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get('my-leadership-projects')
  async getMyLeadershipProjects(
    @Query('limit') limit: string = '5',
    @Tenant() ctx: TenantRequest,
  ) {
    return this.dataSvc.getMyLeadershipProjects(
      ctx.userId!,
      clampInt(limit, 5, 1, 20),
      { manager: ctx.manager },
    );
  }

  /**
   * Get projects where the current user is a team member (but not lead/sponsor)
   * Includes count of tasks assigned to the user
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get('my-contribution-projects')
  async getMyContributionProjects(
    @Query('limit') limit: string = '5',
    @Tenant() ctx: TenantRequest,
  ) {
    return this.dataSvc.getMyContributionProjects(
      ctx.userId!,
      clampInt(limit, 5, 1, 20),
      { manager: ctx.manager },
    );
  }

  /**
   * Get time summary for the current user over the specified number of days
   * Includes time from both task time entries and direct project time entries
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get('time-summary')
  async getTimeSummary(
    @Query('days') days: string = '7',
    @Tenant() ctx: TenantRequest,
  ) {
    return this.dataSvc.getTimeSummary(
      ctx.userId!,
      clampInt(days, 7, 1, 90),
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get('team-activity')
  async getTeamActivity(
    @Query('limit') limit: string = '5',
    @Query('days') days: string = '7',
    @Tenant() ctx: TenantRequest,
  ) {
    return this.dataSvc.getTeamActivity(
      ctx.userId!,
      clampInt(limit, 5, 1, 10),
      clampInt(days, 7, 1, 30),
      { manager: ctx.manager },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'reader')
  @Get('project-status-changes')
  async getProjectStatusChanges(
    @Query('days') days: string = '5',
    @Query('limit') limit: string = '5',
    @Tenant() ctx: TenantRequest,
  ) {
    return this.dataSvc.getProjectStatusChanges(
      clampInt(days, 5, 1, 30),
      clampInt(limit, 5, 1, 10),
      { manager: ctx.manager, accessScope: await this.participantScope(ctx, 'portfolio_projects') },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get('stale-tasks')
  async getStaleTasks(
    @Query('scope') scope: string = 'my',
    @Query('thresholdDays') thresholdDays: string = '90',
    @Query('limit') limit: string = '5',
    @Tenant() ctx: TenantRequest,
  ) {
    const safeScope = scope === 'team' || scope === 'all' ? scope : 'my';
    return this.dataSvc.getStaleTasks(
      ctx.userId!,
      safeScope,
      clampInt(thresholdDays, 90, 1, 365),
      clampInt(limit, 5, 1, 10),
      {
        manager: ctx.manager,
        accessScope: await this.participantScope(ctx, 'tasks'),
        incidentViewer: incidentViewerFromContext(ctx),
      },
    );
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('knowledge', 'reader')
  @Get('knowledge-review-items')
  async getKnowledgeReviewItems(
    @Query('limit') limit: string = '5',
    @Tenant() ctx: TenantRequest,
  ) {
    return this.dataSvc.getKnowledgeReviewItems(
      ctx.userId!,
      clampInt(limit, 5, 1, 10),
      { manager: ctx.manager },
    );
  }
}
