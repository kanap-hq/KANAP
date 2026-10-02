import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, Res, UseGuards, UploadedFile, UseInterceptors, BadRequestException } from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersDeleteService } from './users-delete.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { csvImportMulterOptions } from '../common/upload';
import { contentDisposition } from '../common/content-disposition';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
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

function canViewUserAdministration(req: any): boolean {
  return req?.isAdmin === true || req?.permissionLevel === 'admin';
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
    });
  }

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
  async export(@Query('scope') scope: 'template' | 'data' = 'data', @Res() res: Response, @Req() req: any) {
    const { filename, content } = await this.svc.exportCsv(scope, { manager: req?.queryRunner?.manager });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(filename));
    res.send(content);
  }

  @Get(':id')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'reader')
  async getById(@Param('id') id: string, @Req() req: any) {
    const user = await this.svc.findById(id, { manager: req?.queryRunner?.manager });
    if (!user) return null;
    if (!canViewUserAdministration(req)) return toUserLookup(user);
    return { ...user, password_hash: undefined };
  }

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

  @Patch(':id')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'member')
  update(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    return this.svc.updateUser(
      id,
      body,
      {
        actorUserId: req.user?.sub ?? null,
        canManageUsers: req.isAdmin === true || req.permissionLevel === 'admin',
      },
      { manager: req?.queryRunner?.manager },
    );
  }

  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('import')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  @UseInterceptors(FileInterceptor('file', csvImportMulterOptions))
  async import(
    @UploadedFile() file: Express.Multer.File,
    @Query('dryRun') dryRunRaw: string,
    @Req() req: any,
  ) {
    const dryRun = String(dryRunRaw ?? 'true').toLowerCase() !== 'false';
    return this.svc.importCsv({ file, dryRun, userId: req.user?.sub ?? null }, { manager: req?.queryRunner?.manager });
  }

  // Seat-controlled status endpoints (Admin only)
  @Post(':id/enable')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async enable(@Param('id') id: string, @Req() req: any) { return this.svc.enableUser(id, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }); }

  @Post(':id/disable')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async disable(@Param('id') id: string, @Req() req: any) { return this.svc.disableUser(id, req.user?.sub ?? null, { manager: req?.queryRunner?.manager }); }

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

  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req: any) {
    return this.deleteSvc.deleteUser(id, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }

  // Per-user page permissions removed: permissions are now role-based

  // Multi-role management endpoints
  @Get(':id/roles')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async getUserRoles(@Param('id') id: string, @Req() req: any) {
    const manager = req?.queryRunner?.manager;
    const repo = manager ? manager.getRepository(UserRole) : this.userRoleRepo;
    const userRoles = await repo.find({
      where: { user_id: id },
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

  @Put(':id/roles')
  @UseGuards(PermissionGuard)
  @RequireLevel('users', 'admin')
  async setUserRoles(
    @Param('id') id: string,
    @Body() body: { role_ids: string[] },
    @Req() req: any,
  ) {
    const manager = req?.queryRunner?.manager;
    const userRoleRepo = manager ? manager.getRepository(UserRole) : this.userRoleRepo;
    const roleRepo = manager ? manager.getRepository(Role) : this.roleRepo;
    const userRepo = manager ? manager.getRepository(User) : this.userRepo;

    // Empty list is allowed: the user keeps no app access and falls back to
    // the Contact system role (same state as a freshly provisioned SSO user).
    const roleIds: string[] = Array.isArray(body?.role_ids) ? body.role_ids : [];
    if (roleIds.length === 0 && req.user?.sub === id) {
      throw new BadRequestException('You cannot remove your own last role.');
    }

    // Validate all roles exist
    const roles = roleIds.length > 0 ? await roleRepo.find({ where: roleIds.map(rid => ({ id: rid })) }) : [];
    if (roles.length !== roleIds.length) {
      throw new BadRequestException('One or more roles not found');
    }

    // Get user
    const user = await userRepo.findOne({ where: { id } });
    if (!user) throw new BadRequestException('User not found');

    // Snapshot current roles for the audit trail before replacing them
    const previousRoles = await userRoleRepo.find({ where: { user_id: id }, relations: ['role'] });

    // Delete existing user roles
    await userRoleRepo.delete({ user_id: id });

    // Create new user roles (first role is considered primary for backwards compat)
    for (let i = 0; i < roleIds.length; i++) {
      await userRoleRepo.save(userRoleRepo.create({
        tenant_id: user.tenant_id,
        user_id: id,
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
        recordId: id,
        action: 'update',
        before: { roles: previousRoles.map((ur: UserRole) => ({ id: ur.role_id, name: ur.role?.role_name ?? null })) },
        after: { roles: roleIds.map((rid) => ({ id: rid, name: roles.find((r: Role) => r.id === rid)?.role_name ?? null })) },
        userId: req.user?.sub ?? null,
      },
      manager ? { manager } : undefined,
    );

    return this.getUserRoles(id, req);
  }
}
