import { CanActivate, ExecutionContext, ForbiddenException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Features } from '../../config/features';
import { isPlatformAdmin } from '../../auth/platform-admin.util';
import { UserRole } from '../../users/user-role.entity';

@Injectable()
export class SystemAdminGuard implements CanActivate {
  constructor(private readonly dataSource: DataSource) {}

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

    // Single-tenant mode: check if any of the user's roles is Administrator
    const userRolesRepo = this.dataSource.getRepository(UserRole);
    const userRoles = await userRolesRepo.find({
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
