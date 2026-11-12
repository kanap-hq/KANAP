import { createHash } from 'crypto';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerException, ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import { clientAddress } from './client-address';
import { isRateLimitEnabled } from './rate-limit';

/**
 * Counts one request against a budget that is not the route's own count (per tenant, per billing
 * address, for the whole platform), in the storage of the guards: this process's memory with one
 * API process, `rate_limit_hits` with several (app.module.ts). Past the limit the request gets the
 * guards' 429 for the rest of the window. Off with the other limits (`RATE_LIMIT_ENABLED=false`).
 * `name` keeps budgets apart; the key is a SHA-256, nothing of the tracker is kept in clear.
 */
export async function consumeRateLimit(
  storage: ThrottlerStorage,
  name: string,
  budget: { limit: number; ttl: number },
  tracker: string,
): Promise<void> {
  if (!isRateLimitEnabled()) return;
  const key = createHash('sha256').update(`${name}-${tracker}`).digest('hex');
  const { isBlocked } = await storage.increment(key, budget.ttl, budget.limit, budget.ttl, name);
  if (isBlocked) throw new ThrottlerException();
}

/** The limits, counted per client address (common/client-address.ts). */
@Injectable()
export class RateLimitGuard extends ThrottlerGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!isRateLimitEnabled()) return true;
    return super.canActivate(context);
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    return clientAddress(req) ?? 'unknown';
  }
}

/**
 * Same limits, counted per client address and tenant: callers that many tenants share, such as
 * the servers of a hosted MCP client calling the OAuth token route, or the people of two
 * organisations behind one NAT or VPN renewing their sessions, get one budget per tenant.
 */
@Injectable()
export class TenantRateLimitGuard extends RateLimitGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    return `${await super.getTracker(req)}:${req?.tenant?.id ?? '-'}`;
  }
}

/**
 * Same limits, counted per signed-in user (tenant and user id) rather than per
 * address: several users behind one company proxy do not share a budget. Runs
 * after the authentication guard; without a user it counts per address.
 */
@Injectable()
export class UserRateLimitGuard extends RateLimitGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req?.user?.sub;
    if (!userId) return super.getTracker(req);
    return `user:${req?.tenant?.id ?? '-'}:${userId}`;
  }
}
