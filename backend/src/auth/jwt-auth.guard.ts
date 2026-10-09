import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { IS_PUBLIC_KEY } from './public.decorator';
import {
  AccessTokenPolicy,
  checkAccessTokenPurpose,
  createAccessTokenPolicyResolver,
} from './access-token.util';
import { accessTokenVerifyKey } from './jwt-key';
import { ISSUED_TOKEN_ALGORITHMS } from './jwt-algorithms';

/** Time seam for specs: the configured deadline for marker-less tokens is time-dependent. */
export type JwtAuthGuardClock = {
  now?: () => number;
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);
  private readonly accessTokenPolicy: () => AccessTokenPolicy = createAccessTokenPolicyResolver(process.env);
  private legacyWindowWarned = false;
  private now: () => number = () => Date.now();

  constructor(private reflector: Reflector) {}

  /** Specs only. Not a Nest provider dependency: the guard is always constructed by the DI container. */
  setClock(clock: JwtAuthGuardClock): this {
    if (clock.now) this.now = clock.now;
    return this;
  }

  canActivate(context: ExecutionContext): boolean {
    // Check if route is marked as public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const header = req.headers['authorization'] as string | undefined;
    if (!header || !header.startsWith('Bearer ')) throw new UnauthorizedException({ code: 'MISSING_TOKEN', message: 'Missing token' });
    const token = header.slice('Bearer '.length);
    try {
      const verified = jwt.verify(token, accessTokenVerifyKey(), { algorithms: [...ISSUED_TOKEN_ALGORITHMS] });
      if (!verified || typeof verified === 'string') {
        throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid token' });
      }

      const payload = verified as Record<string, unknown>;

      // Explicit typing (RFC 8725 §3.12): only access tokens pass. A password-reset link,
      // a provisioning token or an SSO artifact is signed by the same application and carries
      // a valid `sub`/`tenant_id`, so signature and tenant checks alone would accept it.
      const purpose = checkAccessTokenPurpose(payload, this.accessTokenPolicy(), this.now());
      if (!purpose.ok) {
        if (purpose.reason === 'legacy-window-closed' && !this.legacyWindowWarned) {
          // A marker-less token got this far: only builds older than the marker issue such tokens.
          this.legacyWindowWarned = true;
          this.logger.warn(
            'Rejected an access token without a purpose marker. Builds released before the purpose marker issued such '
            + 'tokens; a browser session recovers through its refresh cookie. If an instance running an '
            + 'older build still issues tokens, upgrade it, or set JWT_LEGACY_ACCESS_TOKEN_DEADLINE to '
            + 'accept them until a given instant.',
          );
        }
        throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid token' });
      }

      const requestTenantId = typeof req?.tenant?.id === 'string' ? req.tenant.id : undefined;
      const payloadTenantId = typeof payload.tenant_id === 'string' ? payload.tenant_id : undefined;

      if (requestTenantId && payloadTenantId !== requestTenantId) {
        throw new UnauthorizedException({ code: 'INVALID_TOKEN', message: 'Invalid token' });
      }

      req.user = payload;
      return true;
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new UnauthorizedException('Invalid token');
    }
  }
}
