import { CanActivate, ExecutionContext, ForbiddenException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Features } from '../config/features';
import { isPlatformAdmin } from '../auth/platform-admin.util';
import { isAdministratorRole } from '../roles/system-roles';
import { User } from '../users/user.entity';
import { UserRole } from '../users/user-role.entity';

/**
 * The operator of the installation: the settings of the installation and the scheduled tasks.
 * - Cloud (multi-tenant): the platform host and a platform administrator, as `PlatformAdminGuard`
 *   (403 `platform_admin_required`).
 * - On-premise (single-tenant): the Administrator role, primary or extra (403
 *   `administrator_required`). The extra roles are read in the request's tenant transaction
 *   (`user_roles` is under forced row level security: read outside it, they were never found).
 * In both modes the person is read again in that transaction, as `PermissionGuard` does: the
 * access token may name a role or a state that changed since it was signed. A disabled person gets
 * 401 `USER_DISABLED`, as from `PermissionGuard`; roles come from the database, never the token.
 * A route behind it also carries `@ReservedToUnscopedDataAccess()`.
 */
@Injectable()
export class InstallationAdminGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: any = context.switchToHttp().getRequest();
    const user = req?.user as { sub?: string } | undefined;
    if (!user) throw new UnauthorizedException('Authentication required');
    const manager: EntityManager = req.queryRunner?.manager ?? this.dataSource.manager;

    if (!Features.SINGLE_TENANT) {
      if (!req.isPlatformHost) {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          code: 'platform_admin_required',
          message: 'Platform admin host required',
        });
      }
      const person = await this.person(manager, user.sub);
      if (!person || !isPlatformAdmin(person)) {
        throw new ForbiddenException({
          statusCode: HttpStatus.FORBIDDEN,
          error: 'Forbidden',
          code: 'platform_admin_required',
          message: 'Platform admin access required',
        });
      }
      return true;
    }

    const person = await this.person(manager, user.sub);
    const extraRoles = person
      ? await manager.getRepository(UserRole).find({ where: { user_id: person.id }, relations: ['role'] })
      : [];
    if (!person || ![person.role, ...extraRoles.map((userRole) => userRole.role)].some(isAdministratorRole)) {
      throw new ForbiddenException({
        statusCode: HttpStatus.FORBIDDEN,
        error: 'Forbidden',
        code: 'administrator_required',
        message: 'Administrator access required',
      });
    }

    return true;
  }

  /** The person as stored, with the primary role; a disabled one is refused here (401). */
  private async person(manager: EntityManager, id: string | undefined): Promise<User | null> {
    if (!id) return null;
    const person = await manager.getRepository(User).findOne({ where: { id }, relations: ['role'] });
    if (person && person.status !== 'enabled') {
      // As PermissionGuard: 401 (not 403) so the client goes through refresh, then logout.
      throw new UnauthorizedException({ code: 'USER_DISABLED', message: 'User disabled' });
    }
    return person;
  }
}
