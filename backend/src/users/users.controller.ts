import { exportListQuery } from '../common/pagination';
import { Body, Controller, Delete, Get, NotFoundException, Param, Patch, Post, Put, Query, Req, Res, UseGuards, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersDeleteService } from './users-delete.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { csvImportMulterOptions } from '../common/upload';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators';
import { USER_LOOKUP_ACCESS, USER_LOOKUP_READERS, assertLookupSearch } from '../common/lookup/lookup-requirements';
import { lookupReference, USER_LOOKUP } from '../common/lookup/reference-lookups';
import { resolveAppBaseUrl } from '../common/url';
import { Features } from '../config/features';
import { throwFeatureDisabled } from '../common/feature-gates';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserRole } from './user-role.entity';
import { Role } from '../roles/role.entity';
import { User } from './user.entity';
import { AuditService } from '../audit/audit.service';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { createRequestCommitThenRun } from '../common/import-connection';
import { languageOf, parseDateOrder, parseDecimalMark } from '../common/csv-sheet';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';
import { csvExportFormat } from '../common/csv/csv-export.service';
import { csvExportBody } from '../common/csv/send-csv-export';

function canViewUserAdministration(req: any): boolean {
  return req?.isAdmin === true || req?.permissionLevel === 'admin';
}

const USER_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The `:id` of a user route. `/users/me` is not a route (the current user is `/auth/me`): a name
 * that is not an id answers 404 instead of a database cast error.
 */
function userIdParam(id: string): string {
  if (!USER_ID_RE.test(String(id || ''))) throw new NotFoundException('User not found');
  return id;
}

function toUserLookup(user: User | null | undefined) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    status: user.status,
  };
}

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly svc: UsersService,
    private readonly deleteSvc: UsersDeleteService,
    @InjectRepository(UserRole)
    private readonly userRoleRepo: Repository<UserRole>,
    @InjectRepository(Role)
    private readonly roleRepo: Repository<Role>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'reader')
  list(@Query() query: any, @Req() req: any) {
    return this.svc.list(query, {
      manager: req?.queryRunner?.manager,
      adminView: canViewUserAdministration(req),
      // The data-access column (spec §7.4) is for unscoped users administrators only.
      dataAccessView: canViewUserAdministration(req) && req?.dataAccessMode === 'all',
    });
  }

  // What a delete of `ids` would refuse, asked before the confirmation.
  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  @Post('delete-check')
  deleteCheck(@Body() body: { ids?: unknown }, @Req() req: any) {
    return this.deleteSvc.deleteCheck(Array.isArray(body?.ids) ? body.ids : [], req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  @Delete('bulk')
  bulkDelete(@Body() body: { ids: string[] }, @Req() req: any) {
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];
    return this.deleteSvc.bulkDelete(ids, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  @Get('export')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async export(
    @Query('scope') scope: 'template' | 'data' = 'data',
    @Query('language') languageRaw: string | undefined,
    @Query() query: any,
    @Res() res: Response,
    @Req() req: any,
  ) {
    const language = await languageOf(req?.queryRunner?.manager, req.tenant.id, req.user?.sub ?? null, languageRaw);
    const format = csvExportFormat(query?.format, scope);
    const file = await this.svc.exportCsv(scope, { manager: req?.queryRunner?.manager, language, listQuery: exportListQuery(query), format });
    res.send(await csvExportBody(res, file));
  }

  // Every person picker: names only (see common/lookup). Readable from every page that picks a person.
  @Get('lookup')
  @UseGuards(PermissionGuard)
  @RequireAnyLevel(USER_LOOKUP_READERS)
  lookup(@Query() query: any, @Tenant() ctx: TenantRequest) {
    // A role that only reads a picking page gets the chosen labels (`ids`), not the list.
    assertLookupSearch(USER_LOOKUP_ACCESS, ctx, query);
    return lookupReference({ manager: ctx.manager, tenantId: ctx.tenantId }, USER_LOOKUP, query);
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'reader')
  async getById(@Param('id') id: string, @Req() req: any) {
    const user = await this.svc.findById(userIdParam(id), { manager: req?.queryRunner?.manager });
    if (!user) return null;
    if (!canViewUserAdministration(req)) return toUserLookup(user);
    return { ...user, password_hash: undefined };
  }

  @ReservedToUnscopedDataAccess()
  @Post()
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  create(@Body() body: any, @Req() req: any) { return this.svc.createUser(body, { manager: req?.queryRunner?.manager }); }

  @Patch('me')
  updateMe(@Body() body: any, @Req() req: any) {
    const userId = req.user?.sub;
    return this.svc.updateUser(
      userId,
      body,
      { actorUserId: userId, canManageUsers: false },
      { manager: req?.queryRunner?.manager },
    );
  }

  @ReservedToUnscopedDataAccess()
  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'member')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.updateUser(
      userIdParam(id),
      body,
      {
        actorUserId: req.user?.sub ?? null,
        canManageUsers: req.isAdmin === true || req.permissionLevel === 'admin',
      },
      { manager: req?.queryRunner?.manager },
    );
  }

  @ReservedToUnscopedDataAccess()
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Query('language') languageRaw: string | undefined,
    @Query('dateOrder') dateOrderRaw: string | undefined,
    @Query('decimalMark') decimalMarkRaw: string | undefined,
    @Req() req: any,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    const language = await languageOf(req?.queryRunner?.manager, req.tenant.id, req.user?.sub ?? null, languageRaw);
    return this.svc.importCsv(
      {
        file,
        dryRun,
        userId: req.user?.sub ?? null,
        language,
        dateOrder: parseDateOrder(dateOrderRaw),
        decimalMark: parseDecimalMark(decimalMarkRaw),
      },
      { manager: req?.queryRunner?.manager },
    );
  }

  // Seat-controlled status endpoints (Admin only)
  @ReservedToUnscopedDataAccess()
  @Post(':id/enable')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async enable(@Param('id') id: string, @Req() req: any) { return this.svc.enableUser(id, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }); }

  @ReservedToUnscopedDataAccess()
  @Post(':id/disable')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async disable(@Param('id') id: string, @Req() req: any) { return this.svc.disableUser(id, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }); }

  @ReservedToUnscopedDataAccess()
  @Post(':id/invite')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async invite(@Param('id') id: string, @Req() req: any) {
    if (!Features.EMAIL_ENABLED) throwFeatureDisabled('email');
    const baseUrl = resolveAppBaseUrl(req);
    // The invitation is committed before its e-mail waits on the mail queue (see inviteUser).
    return this.svc.inviteUser(id, req.user?.sub ?? null, baseUrl, {
      manager: req?.queryRunner?.manager,
      commitThenRun: createRequestCommitThenRun(req),
    });
  }

  @ReservedToUnscopedDataAccess()
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req: any) {
    return this.deleteSvc.deleteUser(userIdParam(id), req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  // Per-user page permissions removed: permissions are now role-based

  // Multi-role management endpoints
  @Get(':id/roles')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async getUserRoles(@Param('id') id: string, @Req() req: any) {
    const userId = userIdParam(id);
    const manager = req?.queryRunner?.manager;
    const repo = manager ? manager.getRepository(UserRole) : this.userRoleRepo;
    const userRoles = await repo.find({
      where: { user_id: userId },
      relations: ['role'],
      order: { is_primary: 'DESC', created_at: 'ASC' },
    });
    return {
      items: userRoles.map((ur: UserRole) => ({
        id: ur.role_id,
        name: ur.role?.role_name ?? null,
        is_primary: ur.is_primary,
      })),
    };
  }

  @ReservedToUnscopedDataAccess()
  @Put(':id/roles')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async setUserRoles(
    @Param('id') id: string,
    @Body() body: { role_ids: string[] },
    @Req() req: any,
  ) {
    const userId = userIdParam(id);
    const manager = req?.queryRunner?.manager;
    const userRoleRepo = manager ? manager.getRepository(UserRole) : this.userRoleRepo;
    const roleRepo = manager ? manager.getRepository(Role) : this.roleRepo;
    const userRepo = manager ? manager.getRepository(User) : this.userRepo;

    // Empty list is allowed: the user keeps no app access and falls back to
    // the Contact system role (same state as a freshly provisioned SSO user).
    const roleIds: string[] = Array.isArray(body?.role_ids) ? body.role_ids : [];
    if (roleIds.length === 0 && req.user?.sub === userId) {
      throw new BadRequestException('You cannot remove your own last role.');
    }

    // Validate all roles exist
    const roles = roleIds.length > 0 ? await roleRepo.find({ where: roleIds.map(rid => ({ id: rid })) }) : [];
    if (roles.length !== roleIds.length) {
      throw new BadRequestException('One or more roles not found');
    }

    // Get user
    const user = await userRepo.findOne({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    // Snapshot current roles for the audit trail before replacing them
    const previousRoles = await userRoleRepo.find({ where: { user_id: userId }, relations: ['role'] });

    // Delete existing user roles
    await userRoleRepo.delete({ user_id: userId });

    // Create new user roles (first role is considered primary for backwards compat)
    for (let i = 0; i < roleIds.length; i++) {
      await userRoleRepo.save(userRoleRepo.create({
        tenant_id: user.tenant_id,
        user_id: userId,
        role_id: roleIds[i],
        is_primary: i === 0,
      }));
    }

    // Legacy role_id column is NOT NULL: first role, or the Contact system
    // role when the list is empty (no roles = no access -> pending).
    let legacyRoleId = roleIds[0];
    if (!legacyRoleId) {
      const contact = await roleRepo.findOne({ where: { role_name: 'Contact' } as any });
      if (!contact) throw new BadRequestException('Cannot clear roles: the Contact system role is missing.');
      legacyRoleId = contact.id;
    }
    user.role_id = legacyRoleId;
    await userRepo.save(user);

    // Role assignment changes a user's effective permissions — always audit it.
    await this.audit.log(
      {
        table: 'user_roles',
        recordId: userId,
        action: 'update',
        before: { roles: previousRoles.map((ur: UserRole) => ({ id: ur.role_id, name: ur.role?.role_name ?? null })) },
        after: { roles: roleIds.map((rid) => ({ id: rid, name: roles.find((r: Role) => r.id === rid)?.role_name ?? null })) },
        userId: req.user?.sub ?? null,
      },
      manager ? { manager } : undefined,
    );

    return this.getUserRoles(userId, req);
  }
}
