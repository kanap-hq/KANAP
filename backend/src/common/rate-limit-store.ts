import { Logger } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { DataSource } from 'typeorm';

/**
 * Hit counts of the HTTP rate limits (`RateLimitGuard`: login, token refresh, password reset,
 * provisioning exchange, public forms, exports and imports, saved list filters) kept in the
 * database, so that several API processes (API_WORKERS > 1) share one budget per key. With one
 * process the in-memory counter of @nestjs/throttler stays in use (app.module.ts): nothing
 * changes there.
 *
 * One row per throttle key (already a SHA-256 of route and client, no address or user id in
 * clear) in the UNLOGGED table `rate_limit_hits`: counts need no crash safety. Each hit is one
 * upsert, so concurrent hits from several processes add up exactly. The window is fixed: it
 * opens at the first hit and the count restarts once it has passed (the in-memory counter
 * expires each hit on its own; at a window boundary this one can let up to twice the limit
 * through within a few seconds). Past the limit the key is blocked for the block duration
 * (the window length by default), hits are not counted while it is blocked, and the next hit
 * after the block opens a new window, as in memory.
 *
 * The upsert runs on a second pool connection, outside the request's transaction (a refused
 * login rolls the request back: a count written inside it would be lost): a rate-limited request
 * holds two connections for a moment, hence the floor of 2 per process (db-pool-budget.ts). When
 * the database does not answer within 1.5 s (pool exhausted, database down), the hit is counted in
 * this process's memory instead, with one warning a minute: the limit then holds per process.
 */
const HIT_SQL = `
  INSERT INTO rate_limit_hits AS r (key, hits, window_ends_at, blocked_until)
  VALUES (
    $1, 1,
    now() + make_interval(secs => $2::double precision / 1000),
    CASE WHEN 1 > $3::int THEN now() + make_interval(secs => $4::double precision / 1000) END
  )
  ON CONFLICT (key) DO UPDATE SET
    hits = CASE
      WHEN r.blocked_until > now() THEN r.hits
      WHEN r.blocked_until IS NOT NULL OR r.window_ends_at <= now() THEN 1
      ELSE r.hits + 1
    END,
    window_ends_at = CASE
      WHEN r.blocked_until > now() THEN r.window_ends_at
      WHEN r.blocked_until IS NOT NULL OR r.window_ends_at <= now() THEN EXCLUDED.window_ends_at
      ELSE r.window_ends_at
    END,
    blocked_until = CASE
      WHEN r.blocked_until > now() THEN r.blocked_until
      WHEN (CASE WHEN r.blocked_until IS NOT NULL OR r.window_ends_at <= now() THEN 1 ELSE r.hits + 1 END) > $3::int
        THEN now() + make_interval(secs => $4::double precision / 1000)
      ELSE NULL
    END
  RETURNING hits,
    GREATEST(0, EXTRACT(EPOCH FROM (window_ends_at - now())) * 1000)::float8 AS expires_in_ms,
    COALESCE(blocked_until > now(), false) AS blocked,
    GREATEST(0, COALESCE(EXTRACT(EPOCH FROM (blocked_until - now())) * 1000, 0))::float8 AS block_expires_in_ms`;

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

const PURGE_EVERY_MS = 10 * 60_000;
const WARN_EVERY_MS = 60_000;
/** Longest wait for the database count before counting in memory. */
export const RATE_LIMIT_DB_WAIT_MS = 1_500;

export class DatabaseThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('RateLimit');
  private readonly fallback = new ThrottlerStorageService();
  private lastPurgeAt = Date.now();
  private lastWarnAt = 0;

  constructor(private readonly dataSource: DataSource, private readonly waitMs = RATE_LIMIT_DB_WAIT_MS) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    let timer: NodeJS.Timeout | undefined;
    try {
      const query = this.dataSource.query(HIT_SQL, [key, ttl, limit, blockDuration]) as Promise<Array<{ hits: number; expires_in_ms: number; blocked: boolean; block_expires_in_ms: number }>>;
      // A query that loses the race still runs: the hit may then count twice, never zero times.
      query.catch(() => undefined);
      const [row] = await Promise.race([
        query,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${this.waitMs} ms`)), this.waitMs); }),
      ]);
      this.purgeNowAndThen();
      return {
        totalHits: Number(row.hits),
        timeToExpire: Math.ceil(Number(row.expires_in_ms) / 1000),
        isBlocked: row.blocked === true,
        timeToBlockExpire: Math.ceil(Number(row.block_expires_in_ms) / 1000),
      };
    } catch (error) {
      const now = Date.now();
      if (now - this.lastWarnAt > WARN_EVERY_MS) {
        this.lastWarnAt = now;
        this.logger.warn(`Rate limit counts unavailable in the database, counting in this process only: ${(error as Error)?.message ?? error}`);
      }
      return this.fallback.increment(key, ttl, limit, blockDuration, throttlerName);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Expired keys go every 10 minutes, from whichever process passes by. */
  private purgeNowAndThen() {
    const now = Date.now();
    if (now - this.lastPurgeAt < PURGE_EVERY_MS) return;
    this.lastPurgeAt = now;
    this.dataSource
      .query(`DELETE FROM rate_limit_hits WHERE window_ends_at < now() - interval '1 hour' AND (blocked_until IS NULL OR blocked_until < now())`)
      .catch(() => undefined);
  }
}
