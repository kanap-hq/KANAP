import { createHash } from 'node:crypto';
import { Provider } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { clientAddress } from '../common/client-address';
import { apiProcessCount } from '../common/cluster/process-role';
import { isRateLimitEnabled, RATE_LIMITS } from '../common/rate-limit';
import { DatabaseHitCounter, HitCounter, HitRule, MemoryHitCounter } from '../common/rate-limit-store';

/**
 * Password sign-in attempts per account and client address (`RATE_LIMITS.authLoginFailures`):
 * five refused attempts within 15 minutes, and the pair (identifier typed, client address) is
 * refused for the next 15 minutes with the 429 of the address limit. A successful sign-in clears
 * the count of its pair, and an attempt that ends in an error other than a refusal (server error,
 * database unavailable) is taken back, so only refused attempts add up. Another client address
 * keeps its own count for the same account, and another account its own count from the same
 * client address. The window is fixed: it opens at the first attempt.
 *
 * The attempt is counted when it starts, before the password check, in one statement: attempts
 * sent at the same moment cannot pass the limit together (the sixth is refused while the fifth
 * is still being checked). The fifth refusal starts the 15 minutes. Nothing here reads the
 * account, so a known and an unknown account get the same answers.
 *
 * The key is a SHA-256 of the tenant, the client address and the identifier typed (the e-mail,
 * lower case, without spaces): neither the client address nor the identifier is kept in clear.
 * One API process counts in its memory; several (API_WORKERS > 1) count in `rate_limit_hits`, as
 * the address limits do. `RATE_LIMIT_ENABLED=false` turns it off with the other limits.
 */

const RULE: HitRule = {
  limit: RATE_LIMITS.authLoginFailures.limit,
  ttl: RATE_LIMITS.authLoginFailures.ttl,
  blockDuration: RATE_LIMITS.authLoginFailures.ttl,
};

/** The identifier typed (the e-mail), as the count reads it: lower case, without spaces. */
export function normalizeLoginIdentifier(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, '').toLowerCase() : '';
}

export function loginAttemptKey(tenantId: string | null | undefined, address: string | null, identifier: unknown): string {
  return createHash('sha256')
    .update(['login-attempts', tenantId ?? '-', address ?? 'unknown', normalizeLoginIdentifier(identifier)].join('\n'))
    .digest('hex');
}

export type LoginAttempt = {
  key: string;
  /** Attempts counted in the window, this one included. */
  hits: number;
  /** The pair is over its limit: the attempt is refused before the password check. */
  blocked: boolean;
  /** Seconds until the pair may try again, when blocked. */
  retryAfterSeconds: number;
  /** The window the attempt was counted in, to take it back (`withdraw`). */
  window: string;
};

export class LoginAttemptLimit {
  constructor(private readonly counter: HitCounter) {}

  /** The counter of this process: in memory with one API process, in the database with several. */
  static forProcess(dataSource: DataSource): LoginAttemptLimit {
    return new LoginAttemptLimit(apiProcessCount() > 1 ? new DatabaseHitCounter(dataSource) : new MemoryHitCounter());
  }

  /** Counts a sign-in attempt for the request's tenant, client address and the identifier typed. */
  async begin(req: any, identifier: unknown): Promise<LoginAttempt> {
    const key = loginAttemptKey(req?.tenant?.id, clientAddress(req), identifier);
    if (!isRateLimitEnabled()) return { key, hits: 0, blocked: false, retryAfterSeconds: 0, window: '' };
    const outcome = await this.counter.hit(key, RULE);
    return {
      key,
      hits: outcome.hits,
      blocked: outcome.blocked,
      retryAfterSeconds: outcome.blocked ? Math.max(1, Math.ceil(outcome.retryAfterMs / 1000)) : 0,
      window: outcome.window,
    };
  }

  /**
   * The sign-in was refused: the last attempt of the window starts the block. True when this
   * refusal started it (once per block: the attempts refused during the block never get here).
   */
  async refused(attempt: LoginAttempt): Promise<boolean> {
    if (!isRateLimitEnabled() || attempt.hits < RULE.limit) return false;
    await this.counter.block(attempt.key, RULE.blockDuration);
    return true;
  }

  /**
   * The sign-in ended in an error other than a refusal (server error, database unavailable): the
   * attempt is taken back, the earlier refusals of the pair stay counted. Until then it counted,
   * so attempts at the same moment still cannot pass the limit together.
   */
  async withdraw(attempt: LoginAttempt): Promise<void> {
    if (!isRateLimitEnabled() || attempt.blocked) return;
    await this.counter.release(attempt.key, attempt.window);
  }

  /** The sign-in succeeded: the pair starts again from zero. */
  async succeeded(attempt: LoginAttempt): Promise<void> {
    if (!isRateLimitEnabled()) return;
    await this.counter.clear(attempt.key);
  }
}

/** The provider of `LoginAttemptLimit`, for a module that provides the `DataSource`. */
export const loginAttemptLimitProvider: Provider = {
  provide: LoginAttemptLimit,
  inject: [DataSource],
  useFactory: (dataSource: DataSource) => LoginAttemptLimit.forProcess(dataSource),
};
