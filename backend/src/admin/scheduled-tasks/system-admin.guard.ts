import { CanActivate, ExecutionContext, ForbiddenException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Features } from '../../config/features';
import { isPlatformAdmin } from '../../auth/platform-admin.util';
import { isAdministratorRole } from '../../roles/system-roles';
import { UserRole } from '../../users/user-role.entity';

@Injectable()
export class SystemAdminGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: any = context.switchToHttp().getRequest();
    const user = req?.user as { sub?: string; email?: string; role?: { role_name?: string } } | undefined;
    if (!user) throw new UnauthorizedException('Authentication required');

    // Multi-tenant mode: same checks as PlatformAdminGuard
    if (!Features.SINGLE_TENANT) {
      if (!req.isPlatformHost) {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          code: 'platform_admin_required',
          message: 'Platform admin host required',
        });
      }
      if (!isPlatformAdmin(user)) {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          code: 'platform_admin_required',
          message: 'Platform admin access required',
        });
      }
      return true;
    }

    // Single-tenant mode: the Administrator role, as the principal role or an extra role, as
    // `/auth/me` counts it (`isGlobalAdmin`). `user_roles` and `roles` are under FORCE RLS, so the
    // extra roles are read in the request's tenant transaction (opened by `TenantInitGuard`): a read
    // outside it sees no row. Without that transaction or a user id, only the principal role counts.
    const manager: EntityManager | undefined = req?.queryRunner?.manager;
    const tenantId: string | undefined = req?.tenant?.id;
    const extraRoles = manager && tenantId && user.sub
      ? await manager.getRepository(UserRole).find({ where: { tenant_id: tenantId, user_id: user.sub }, relations: ['role'] })
      : [];

    if (!isAdministratorRole(user.role) && !extraRoles.some((row) => isAdministratorRole(row.role))) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        error: 'Forbidden',
        code: 'administrator_required',
        message: 'Administrator access required',
      });
    }

    return true;
  }
}
