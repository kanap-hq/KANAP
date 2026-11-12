import { createHash } from 'crypto';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import { clientAddress } from './client-address';
import { isRateLimitEnabled } from './rate-limit';
import { DatabaseHitCounter, DatabaseThrottlerStorage, HitCounter, MemoryHitCounter } from './rate-limit-store';

/** A budget counted apart from a route's own request limit: `limit` units in a window of `ttl` ms. */
export type RateLimitBudget = { name: string; limit: number; ttl: number };

/** What one request takes from a budget: `amount` units counted for `tracker`. */
export type RateLimitTake = { budget: RateLimitBudget; tracker: string; amount: number };

/** An amount taken, to give back (`giveBackRateLimit`). */
export type TakenRateLimit = { budget: RateLimitBudget; key: string; amount: number; window: string };

/**
 * `ok`: every amount was taken. Otherwise `refused` is the first budget that would have passed its
 * limit, and `window` the window it counts in (the same value until that window ends).
 */
export type RateLimitOutcome =
  | { ok: true; taken: TakenRateLimit[] }
  | { ok: false; refused: RateLimitBudget; window: string };

const budgetCounters = new WeakMap<ThrottlerStorage, HitCounter>();

/**
 * The counter of the budgets, kept where the guards count: in `rate_limit_hits` when the guards
 * do (several API processes, app.module.ts), in this process's memory otherwise.
 */
function budgetCounterOf(storage: ThrottlerStorage): HitCounter {
  let counter = budgetCounters.get(storage);
  if (!counter) {
    counter = storage instanceof DatabaseThrottlerStorage ? new DatabaseHitCounter(storage.dataSource) : new MemoryHitCounter();
    budgetCounters.set(storage, counter);
  }
  return counter;
}

/**
 * Takes the amounts of one request from budgets that are not the route's own count (recipients
 * per user and per tenant, support invoices per billing address and for the platform), all or
 * nothing: when one budget would pass its limit, the request takes nothing from any of them and
 * the caller refuses it with a 429. The key is a SHA-256 of the
 * budget name and the tracker: nothing of the tracker is kept in clear. Off with the other limits
 * (`RATE_LIMIT_ENABLED=false`).
 */
export async function takeRateLimit(storage: ThrottlerStorage, takes: RateLimitTake[]): Promise<RateLimitOutcome> {
  if (!isRateLimitEnabled()) return { ok: true, taken: [] };
  const counter = budgetCounterOf(storage);
  const taken: TakenRateLimit[] = [];
  for (const { budget, tracker, amount } of takes) {
    const key = createHash('sha256').update(`${budget.name}-${tracker}`).digest('hex');
    const outcome = await counter.take(key, amount, budget);
    if (!outcome.taken) {
      await giveBackRateLimit(storage, taken);
      return { ok: false, refused: budget, window: outcome.window };
    }
    taken.push({ budget, key, amount, window: outcome.window });
  }
  return { ok: true, taken };
}

/** Gives back amounts taken by `takeRateLimit`, while their windows are still open. */
export async function giveBackRateLimit(storage: ThrottlerStorage, taken: TakenRateLimit[]): Promise<void> {
  const counter = budgetCounterOf(storage);
  for (const { key, amount, window } of taken) await counter.giveBack(key, amount, window);
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
