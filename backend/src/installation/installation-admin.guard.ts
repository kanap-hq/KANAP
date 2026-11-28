import { CanActivate, ExecutionContext, ForbiddenException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Features } from '../config/features';
import { isPlatformAdmin } from '../auth/platform-admin.util';
import { UserRole } from '../users/user-role.entity';

/**
 * The operator of the installation: the settings of the installation and the scheduled tasks.
 * - Cloud (multi-tenant): the platform host and a platform administrator, as `PlatformAdminGuard`
 *   (403 `platform_admin_required`).
 * - On-premise (single-tenant): the Administrator role, primary or extra (403
 *   `administrator_required`). The extra roles are read in the request's tenant transaction
 *   (`user_roles` is under forced row level security: read outside it, they were never found).
 * A route behind it also carries `@ReservedToUnscopedDataAccess()`.
 */
@Injectable()
export class InstallationAdminGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: any = context.switchToHttp().getRequest();
    const user = req?.user as { sub?: string; email?: string; role?: { role_name?: string } } | undefined;
    if (!user) throw new UnauthorizedException('Authentication required');

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

    const manager: EntityManager = req.queryRunner?.manager ?? this.dataSource.manager;
    const userRoles = await manager.getRepository(UserRole).find({
      where: { user_id: user.sub },
      relations: ['role'],
    });

    const roleNames = userRoles.map(ur => ur.role?.role_name?.toLowerCase() ?? '');
    if (user.role?.role_name) roleNames.push(user.role.role_name.toLowerCase());

    if (!roleNames.includes('administrator')) {
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
