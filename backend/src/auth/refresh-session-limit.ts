import { createHash } from 'node:crypto';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { DataSource } from 'typeorm';
import { apiProcessCount } from '../common/cluster/process-role';
import { assertRequestOriginAllowed } from '../common/cors-policy';
import { isRateLimitEnabled, RATE_LIMITS } from '../common/rate-limit';
import { DatabaseHitCounter, HitCounter, HitRule, MemoryHitCounter } from '../common/rate-limit-store';
import { refreshTokenOf } from './auth-cookie.util';

/**
 * Session renewals per refresh token (`RATE_LIMITS.authRefreshSession`), checked before the limit
 * per client address and tenant of `POST /auth/refresh`: 30 renewals of one token within a
 * minute, then that token gets a 429 with `Retry-After` for the next 60 seconds. A renewal refused
 * here does not count against the address limit, so a client that loops does not take the budget
 * of its neighbours behind the same outbound address. The window is fixed: it opens at the first
 * renewal.
 *
 * The token is the one the route renews (the cookie, else `refresh_token` in the body). The key is
 * a SHA-256 of the tenant and the token: the token is never kept in clear, in memory or in
 * `rate_limit_hits`, and never logged. One hash per renewal, of a short string: no notable cost.
 * A request without a token is not counted here: the address limit counts it, and the route
 * answers 400. The origin rule of the route applies first, so a refused origin counts nothing,
 * here or against the address.
 *
 * One API process counts in its memory; several (API_WORKERS > 1) count in `rate_limit_hits`, as
 * the address limits and the sign-in attempts do (auth/login-attempt-limit.ts).
 * `RATE_LIMIT_ENABLED=false` turns it off with the other limits.
 */

const RULE: HitRule = {
  limit: RATE_LIMITS.authRefreshSession.limit,
  ttl: RATE_LIMITS.authRefreshSession.ttl,
  blockDuration: RATE_LIMITS.authRefreshSession.ttl,
};

export function refreshSessionKey(tenantId: string | null | undefined, refreshToken: string): string {
  return createHash('sha256').update(['refresh-session', tenantId ?? '-', refreshToken].join('\n')).digest('hex');
}

@Injectable()
export class RefreshSessionRateLimitGuard implements CanActivate {
  private readonly counter: HitCounter;

  constructor(dataSource: DataSource) {
    this.counter = apiProcessCount() > 1 ? new DatabaseHitCounter(dataSource) : new MemoryHitCounter();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!isRateLimitEnabled()) return true;
    const http = context.switchToHttp();
    const req = http.getRequest();
    assertRequestOriginAllowed(req);
    const refreshToken = refreshTokenOf(req, req?.body);
    if (!refreshToken) return true;
    const outcome = await this.counter.hit(refreshSessionKey(req?.tenant?.id, refreshToken), RULE);
    if (!outcome.blocked) return true;
    http.getResponse().setHeader('Retry-After', String(Math.max(1, Math.ceil(outcome.retryAfterMs / 1000))));
    throw new ThrottlerException();
  }
}
