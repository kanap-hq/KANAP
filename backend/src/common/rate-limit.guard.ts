import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { clientAddress } from './client-address';
import { isRateLimitEnabled } from './rate-limit';

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
