import { applyDecorators, ExecutionContext, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { RATE_LIMITS } from '../common/rate-limit';
import { UserRateLimitGuard } from '../common/rate-limit.guard';

/**
 * Key of the "Send link" budget: the same for every share route, so a user's budget covers all
 * objects together (the default key is per route).
 */
export function shareLinkRateLimitKey(_context: ExecutionContext, tracker: string, throttlerName: string): string {
  return createHash('sha256').update(`share-link-${throttlerName}-${tracker}`).digest('hex');
}

/**
 * Rate limit of the share routes (`POST <object>/:id/share`), per signed-in user
 * (`RATE_LIMITS.shareLink`). Place it above the route's `@UseGuards(PermissionGuard)`: the
 * permission check runs first and a refused request is not counted.
 */
export function ShareRateLimit() {
  return applyDecorators(
    UseGuards(UserRateLimitGuard),
    Throttle({ default: { ...RATE_LIMITS.shareLink, generateKey: shareLinkRateLimitKey } }),
  );
}
