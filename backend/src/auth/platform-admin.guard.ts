import { CanActivate, ExecutionContext, ForbiddenException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { isPlatformAdmin } from './platform-admin.util';

/** 403 `platform_admin_required`: the screen translates it (`errors:platform_admin_required`). */
function platformAdminRequired(message: string): ForbiddenException {
  return new ForbiddenException({
    statusCode: HttpStatus.FORBIDDEN,
    error: 'Forbidden',
    code: 'platform_admin_required',
    message,
  });
}

@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req: any = context.switchToHttp().getRequest();
    const user = req?.user as { email?: string; role?: { role_name?: string } } | undefined;
    if (!user) throw new UnauthorizedException('Authentication required');
    if (!req?.isPlatformHost) {
      throw platformAdminRequired('Platform admin host required');
    }
    if (!isPlatformAdmin(user)) {
      throw platformAdminRequired('Platform admin access required');
    }
    return true;
  }
}
