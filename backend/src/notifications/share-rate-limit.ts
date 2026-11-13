import { applyDecorators, ExecutionContext, HttpException, HttpStatus, Injectable, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerException } from '@nestjs/throttler';
import { createHash } from 'crypto';
import { Features } from '../config/features';
import { RATE_LIMITS } from '../common/rate-limit';
import { RateLimitBudget, RateLimitTake, takeRateLimit, UserRateLimitGuard } from '../common/rate-limit.guard';
import { shareRecipientCount } from './share-recipients';

/**
 * Key of the "Send link" budget: the same for every share route, so a user's budget covers all
 * objects together (the default key is per route).
 */
export function shareLinkRateLimitKey(_context: ExecutionContext, tracker: string, throttlerName: string): string {
  return createHash('sha256').update(`share-link-${throttlerName}-${tracker}`).digest('hex');
}

const RECIPIENTS_PER_USER: RateLimitBudget = { name: 'share-link-recipients-user', ...RATE_LIMITS.shareLinkRecipientsPerUser };
const RECIPIENTS_PER_TENANT: RateLimitBudget = { name: 'share-link-recipients-tenant', ...RATE_LIMITS.shareLinkRecipientsPerTenant };

/**
 * The limits of the share routes, for every share route together: the user's requests
 * (`RATE_LIMITS.shareLink`), then the recipients of the request, counted against the user's budget
 * (`shareLinkRecipientsPerUser`, both modes) and, in multi-tenant mode, the tenant's
 * (`shareLinkRecipientsPerTenant`). A request that would pass a recipient budget is refused whole
 * and takes nothing from either: 429 `SHARE_RECIPIENTS_RATE_LIMITED`. The 30-send limit stays the
 * parent's `ThrottlerException`, which carries no code. The recipients are counted from the body
 * as the route's validation reads it; a body that validation refuses counts no recipient (the
 * route answers 400).
 */
@Injectable()
export class ShareRateLimitGuard extends UserRateLimitGuard {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(await super.canActivate(context))) return false;
    const req = context.switchToHttp().getRequest();
    const amount = shareRecipientCount(req?.body);
    if (amount === 0) return true;
    const tenantId = String(req?.tenant?.id ?? '-');
    const takes: RateLimitTake[] = [{ budget: RECIPIENTS_PER_USER, tracker: `${tenantId}:${req?.user?.sub ?? '-'}`, amount }];
    if (!Features.SINGLE_TENANT) takes.push({ budget: RECIPIENTS_PER_TENANT, tracker: tenantId, amount });
    const outcome = await takeRateLimit(this.storageService, takes);
    if (!outcome.ok) {
      // The person's budget and the workspace's refuse with one code. The 30-send limit is the
      // parent's ThrottlerException, which carries no code, and so does any other budget.
      if (outcome.refused === RECIPIENTS_PER_USER || outcome.refused === RECIPIENTS_PER_TENANT) {
        throw new HttpException(
          {
            code: 'SHARE_RECIPIENTS_RATE_LIMITED',
            message:
              'You have reached the number of recipients allowed in the last hour. Try again later, or send to fewer people.',
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      throw new ThrottlerException();
    }
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
