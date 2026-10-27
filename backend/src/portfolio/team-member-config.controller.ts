import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  UnauthorizedException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { EntityManager } from 'typeorm';
import { resolveToUuid } from '../common/resolve-item-id';
import { PermissionLevel, PermissionsService } from '../permissions/permissions.service';
import { ContributorProfileActor, TeamMemberConfigService } from './team-member-config.service';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { reportExportBody, reportExportRequest, writeReportExport } from '../common/report-export';
import { PortfolioSkillsService } from './portfolio-skills.service';
import { PortfolioTeamsService } from './portfolio-teams.service';
import {
  skillsMatrixExport,
  SKILLS_MATRIX_EXPORT_QUERY_KEYS,
  skillsMatrixExportQuery,
} from './services/skills-matrix-export';
import { UNASSIGNED_GROUP } from './shared/contributorsOrdering';

const RANK: Record<PermissionLevel, number> = {
  reader: 1,
  contributor: 2,
  member: 3,
  admin: 4,
};

/**
 * The JWT payload carries the user id as `sub` and has no `id`, so the former
 * `req.user.id ?? null` stamped every contributor audit row with no author.
 */
function actorId(req: any): string | null {
  return req?.user?.id ?? req?.user?.sub ?? null;
}

const PORTFOLIO_READER_REQUIREMENTS = [
  { resource: 'tasks', level: 'reader' as const },
  { resource: 'portfolio_requests', level: 'reader' as const },
  { resource: 'portfolio_projects', level: 'reader' as const },
  { resource: 'portfolio_planning', level: 'reader' as const },
  { resource: 'portfolio_reports', level: 'reader' as const },
  { resource: 'portfolio_settings', level: 'reader' as const },
];

@UseGuards(JwtAuthGuard)
@Controller('portfolio/team-members')
export class TeamMemberConfigController {
  constructor(
    private readonly svc: TeamMemberConfigService,
    private readonly permissionsSvc: PermissionsService,
    private readonly teamsSvc: PortfolioTeamsService,
    private readonly skillsSvc: PortfolioSkillsService,
  ) {}

  /**
   * The job title is a `users` column, and these routes are gated on
   * `portfolio_settings`, so `req.permissionLevel` says nothing about the
   * caller's rights over the directory. Resolve the `users` level from their
   * roles, as `portfolio-requests.controller.ts` does for `tasks`.
   *
   * Editing someone else's job title stays reserved to `users:admin`
   * (fried, 2026-09-12): a portfolio maintainer would otherwise gain a write on
   * the directory from a portfolio permission. Editing one's own is already
   * self-service, and `UsersService.updateUser` enforces that rule itself.
   */
  private async profileActor(req: any): Promise<ContributorProfileActor> {
    const actorUserId = actorId(req);
    if (req?.isAdmin === true) return { actorUserId, canManageUsers: true };

    const manager: EntityManager | undefined = req?.queryRunner?.manager;
    if (!actorUserId || !manager) return { actorUserId, canManageUsers: false };

    const userRows = await manager.query(
      'SELECT role_id FROM users WHERE id = $1 LIMIT 1',
      [actorUserId],
    ) as Array<{ role_id: string | null }>;
    const extraRoleRows = await manager.query(
      'SELECT role_id FROM user_roles WHERE user_id = $1',
      [actorUserId],
    ) as Array<{ role_id: string | null }>;
    const roleIds = Array.from(new Set([
      userRows[0]?.role_id,
      ...extraRoleRows.map((row) => row.role_id),
    ].filter(Boolean) as string[]));

    const permissions = await this.permissionsSvc.listForRoles(roleIds, { manager });
    const usersLevel = permissions.get('users');
    return {
      actorUserId,
      canManageUsers: !!usersLevel && RANK[usersLevel] >= RANK.admin,
    };
  }

  /**
   * Resolving the caller's directory rights costs two reads, and every autosave
   * of a note, a skill or a slider comes through these routes. Only pay for it
   * when the body carries the one field that needs it; without it the service
   * never looks at the actor.
   */
  private profileActorFor(body: any, req: any): Promise<ContributorProfileActor> | undefined {
    if (!body || !Object.prototype.hasOwnProperty.call(body, 'job_title')) return undefined;
    return this.profileActor(req);
  }

  /** `:id` routes accept the row UUID or the CTR-N business reference. */
  private resolveId(idOrRef: string, req: any): Promise<string> {
    return resolveToUuid(idOrRef, 'contributor', req?.queryRunner?.manager as EntityManager);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'reader')
  @Get()
  list(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.list(tenantId, { manager: req?.queryRunner?.manager });
  }

  /**
   * The skills matrix as the screen draws it, from the same three reads (the contributors, the teams,
   * the skills) and the same code (`shared/skillsMatrix.ts`): `teamId`, `employmentTypeId`,
   * `orientation`, `showUnused`, `hiddenCategories` (a JSON list), plus `format`, `language` and `tz`.
   * The guard of the contributors list. Recorded as an export.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'reader')
  @Get('skills-matrix/export')
  async exportSkillsMatrix(@Query() query: Record<string, unknown>, @Tenant() ctx: TenantRequest, @Res() res: Response) {
    const request = await reportExportRequest(query, ctx, SKILLS_MATRIX_EXPORT_QUERY_KEYS);
    const parsed = skillsMatrixExportQuery(query);
    const opts = { manager: ctx.manager };
    const [{ items: contributors }, teams, { items: skills }] = await Promise.all([
      this.svc.list(ctx.tenantId, opts),
      this.teamsSvc.list(ctx.tenantId, opts),
      this.skillsSvc.list(ctx.tenantId, opts),
    ]);
    if (parsed.teamId !== 'all' && parsed.teamId !== UNASSIGNED_GROUP && !teams.some((team) => team.id === parsed.teamId)) {
      throw new BadRequestException('teamId is not a team of this workspace.');
    }
    let employmentTypeName: string | null = null;
    if (parsed.employmentTypeId !== 'all') {
      const rows: Array<{ name: string }> = await ctx.manager!.query(
        'SELECT name FROM portfolio_employment_types WHERE tenant_id = $1 AND id = $2',
        [ctx.tenantId, parsed.employmentTypeId],
      );
      if (rows.length === 0) throw new BadRequestException('employmentTypeId is not a contract type of this workspace.');
      employmentTypeName = rows[0].name;
    }
    const exp = skillsMatrixExport({ contributors, teams, skills, employmentTypeName }, parsed, request.language);
    res.send(await reportExportBody(res, writeReportExport(exp, request)));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get('by-user/:userId')
  getByUser(@Param('userId') userId: string, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.getByUserId(userId, tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireAnyLevel(PORTFOLIO_READER_REQUIREMENTS)
  @Get('me')
  getMe(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    const userId = req?.user?.id ?? req?.user?.sub;
    if (!userId) throw new UnauthorizedException('User context is required');
    return this.svc.getMe(userId, tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'reader')
  @Get('time-stats')
  getAllTimeStats(@Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.getAllTimeStats(tenantId, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'reader')
  @Get(':id/time-stats')
  async getTimeStats(@Param('id') idOrRef: string, @Req() req: any) {
    const id = await this.resolveId(idOrRef, req);
    return this.svc.getTimeStats(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'reader')
  @Get(':id/time-entries')
  async listTimeEntries(@Param('id') idOrRef: string, @Req() req: any) {
    const id = await this.resolveId(idOrRef, req);
    return this.svc.listTimeEntries(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'reader')
  @Get(':id')
  async get(@Param('id') idOrRef: string, @Req() req: any) {
    const id = await this.resolveId(idOrRef, req);
    return this.svc.get(id, { manager: req?.queryRunner?.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'member')
  @Post()
  async create(@Body() body: any, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    const userId = actorId(req);
    return this.svc.create(body, tenantId, userId, {
      manager: req?.queryRunner?.manager,
      profileActor: await this.profileActorFor(body, req),
    });
  }

  @UseGuards(PermissionGuard)
  @RequireAnyLevel(PORTFOLIO_READER_REQUIREMENTS)
  @Patch('me')
  updateMe(@Body() body: any, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    const userId = req?.user?.id ?? req?.user?.sub ?? null;
    if (!userId) throw new UnauthorizedException('User context is required');
    const safeBody = {
      areas_of_expertise: body?.areas_of_expertise,
      skills: body?.skills,
      project_availability: body?.project_availability,
      notes: body?.notes,
      default_source_id: body?.default_source_id,
      default_category_id: body?.default_category_id,
      default_stream_id: body?.default_stream_id,
      default_company_id: body?.default_company_id,
      job_title: body?.job_title,
    };

    return this.svc.upsertMe(userId, safeBody, tenantId, userId, {
      manager: req?.queryRunner?.manager,
      // Self-service: `users:admin` is irrelevant here and the service's own
      // rule (own profile) is what lets the job title through.
      profileActor: { actorUserId: userId, canManageUsers: false },
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'member')
  @Patch(':id')
  async update(@Param('id') idOrRef: string, @Body() body: any, @Req() req: any) {
    const id = await this.resolveId(idOrRef, req);
    const userId = actorId(req);
    return this.svc.update(id, body, userId, {
      manager: req?.queryRunner?.manager,
      profileActor: await this.profileActorFor(body, req),
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'member')
  @Post('by-user/:userId')
  async upsertByUser(@Param('userId') targetUserId: string, @Body() body: any, @Req() req: any) {
    const tenantId = req?.tenant?.id ?? '';
    const userId = actorId(req);
    return this.svc.upsertByUser(targetUserId, body, tenantId, userId, {
      manager: req?.queryRunner?.manager,
      profileActor: await this.profileActorFor(body, req),
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_settings', 'admin')
  @Delete(':id')
  async delete(@Param('id') idOrRef: string, @Req() req: any) {
    const id = await this.resolveId(idOrRef, req);
    const userId = actorId(req);
    return this.svc.delete(id, userId, { manager: req?.queryRunner?.manager });
  }
}
