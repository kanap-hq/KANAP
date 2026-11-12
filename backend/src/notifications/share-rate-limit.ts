import { applyDecorators, ExecutionContext, Injectable, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { Features } from '../config/features';
import { RATE_LIMITS } from '../common/rate-limit';
import { consumeRateLimit, UserRateLimitGuard } from '../common/rate-limit.guard';

/**
 * Key of the "Send link" budget: the same for every share route, so a user's budget covers all
 * objects together (the default key is per route).
 */
export function shareLinkRateLimitKey(_context: ExecutionContext, tracker: string, throttlerName: string): string {
  return createHash('sha256').update(`share-link-${throttlerName}-${tracker}`).digest('hex');
}

/**
 * The per-user limit of the share routes (`RATE_LIMITS.shareLink`), then, in multi-tenant mode,
 * the budget of the user's tenant (`RATE_LIMITS.shareLinkTenant`), both for every share route
 * together. A request over the user's own limit is refused before the tenant count, so it takes
 * nothing from the other users of the tenant.
 */
@Injectable()
export class ShareRateLimitGuard extends UserRateLimitGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(await super.canActivate(context))) return false;
    if (Features.SINGLE_TENANT) return true;
    const tenantId = context.switchToHttp().getRequest()?.tenant?.id;
    await consumeRateLimit(this.storageService, 'share-link-tenant', RATE_LIMITS.shareLinkTenant, String(tenantId ?? '-'));
    return true;
  }
}

/**
 * Rate limit of the share routes (`POST <object>/:id/share`), per signed-in user and per tenant
 * (`ShareRateLimitGuard`). Place it above the route's `@UseGuards(PermissionGuard)`: the
 * permission check runs first and a refused request is not counted.
 */
export function ShareRateLimit() {
  return applyDecorators(
    UseGuards(ShareRateLimitGuard),
    Throttle({ default: { ...RATE_LIMITS.shareLink, generateKey: shareLinkRateLimitKey } }),
  );
}
