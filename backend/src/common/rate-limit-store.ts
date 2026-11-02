import { Logger } from '@nestjs/common';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import { DataSource } from 'typeorm';

/**
 * Hit counts of the HTTP rate limits (`RateLimitGuard`: login, token refresh, password reset,
 * provisioning exchange, public forms, exports and imports, saved list filters, share links) kept in the
 * database, so that several API processes (API_WORKERS > 1) share one budget per key. With one
 * process the in-memory counter of @nestjs/throttler stays in use (app.module.ts): nothing
 * changes there. The password sign-in attempts per account and address use the same table and
 * the same upsert (`DatabaseHitCounter` below, auth/login-attempt-limit.ts).
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
    GREATEST(0, COALESCE(EXTRACT(EPOCH FROM (blocked_until - now())) * 1000, 0))::float8 AS block_expires_in_ms,
    window_ends_at::text AS window_end`;

type ThrottlerStorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;
type HitRow = { hits: number; expires_in_ms: number; blocked: boolean; block_expires_in_ms: number; window_end: string };

/** Refuses a key for a duration from now, or keeps a longer block it already has. */
const BLOCK_SQL = `
  INSERT INTO rate_limit_hits AS r (key, hits, window_ends_at, blocked_until)
  VALUES ($1, 0, now(), now() + make_interval(secs => $2::double precision / 1000))
  ON CONFLICT (key) DO UPDATE SET blocked_until = GREATEST(r.blocked_until, EXCLUDED.blocked_until)`;

/**
 * Takes back one hit of the window it was counted in, while that window is still open and the key
 * is not blocked; the other hits of the window stay. One statement: concurrent hits keep adding up.
 */
const RELEASE_SQL = `
  UPDATE rate_limit_hits SET hits = hits - 1
  WHERE key = $1 AND hits > 0 AND window_ends_at = $2::timestamptz AND window_ends_at > now() AND blocked_until IS NULL`;

const PURGE_SQL = `DELETE FROM rate_limit_hits WHERE window_ends_at < now() - interval '1 hour' AND (blocked_until IS NULL OR blocked_until < now())`;

const PURGE_EVERY_MS = 10 * 60_000;
const WARN_EVERY_MS = 60_000;
/** Longest wait for the database count before counting in memory. */
export const RATE_LIMIT_DB_WAIT_MS = 1_500;

/**
 * The answer of `query`, or a rejection once `waitMs` has passed. A query that loses the race
 * still runs: a hit may then count twice, never zero times.
 */
async function answerWithin<T>(query: Promise<T>, waitMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  query.catch(() => undefined);
  try {
    return await Promise.race([
      query,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`no answer within ${waitMs} ms`)), waitMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class DatabaseThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger('RateLimit');
  private readonly fallback = new ThrottlerStorageService();
  private lastPurgeAt = Date.now();
  private lastWarnAt = 0;

  constructor(private readonly dataSource: DataSource, private readonly waitMs = RATE_LIMIT_DB_WAIT_MS) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    try {
      const [row] = await answerWithin(this.dataSource.query(HIT_SQL, [key, ttl, limit, blockDuration]) as Promise<HitRow[]>, this.waitMs);
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
    }
  }

  /** Expired keys go every 10 minutes, from whichever process passes by. */
  private purgeNowAndThen() {
    const now = Date.now();
    if (now - this.lastPurgeAt < PURGE_EVERY_MS) return;
    this.lastPurgeAt = now;
    this.dataSource.query(PURGE_SQL).catch(() => undefined);
  }
}

/** A limit of a `HitCounter`: `limit` hits in a window of `ttl` ms, then `blockDuration` ms refused. */
export type HitRule = { limit: number; ttl: number; blockDuration: number };

/**
 * The hits counted in the window, whether the key is refused after this hit, for how many more
 * milliseconds, and the window the hit was counted in (an opaque value for `release`).
 */
export type HitOutcome = { hits: number; blocked: boolean; retryAfterMs: number; window: string };

/**
 * A count per key that can also be blocked or cleared, for limits that the outcome of a request
 * changes (the password sign-in attempts of one account from one address,
 * auth/login-attempt-limit.ts). The window is
 * fixed, as in `rate_limit_hits`: it opens at the first hit; past the limit the key is refused
 * for the block duration, hits are not counted while it is, and the next hit after the block
 * opens a new window.
 */
export interface HitCounter {
  hit(key: string, rule: HitRule): Promise<HitOutcome>;
  /** Refuses the key from now on for `durationMs` (or longer, when it already is); its next hit after that opens a new window. */
  block(key: string, durationMs: number): Promise<void>;
  /** Forgets the key: its next hit opens a new window. */
  clear(key: string): Promise<void>;
  /** Forgets every key that starts with `prefix`. */
  clearPrefix(prefix: string): Promise<void>;
  /**
   * Takes back one hit counted in `window` (from its `HitOutcome`), while that window is still the
   * key's and the key is not blocked. The other hits of the window stay counted.
   */
  release(key: string, window: string): Promise<void>;
}

type MemoryEntry = { hits: number; windowEndsAt: number; blockedUntil: number | null };

/** The window of a memory entry, as `HitOutcome.window` gives it. */
const memoryWindow = (entry: MemoryEntry) => `memory:${entry.windowEndsAt}`;

/** The counts of one process, in its memory (one API process). */
export class MemoryHitCounter implements HitCounter {
  private readonly entries = new Map<string, MemoryEntry>();
  private lastPurgeAt: number;

  constructor(private readonly now: () => number = Date.now) {
    this.lastPurgeAt = now();
  }

  async hit(key: string, rule: HitRule): Promise<HitOutcome> {
    const now = this.now();
    this.purgeNowAndThen(now);
    let entry = this.entries.get(key);
    if (entry && entry.blockedUntil !== null && entry.blockedUntil > now) {
      return { hits: entry.hits, blocked: true, retryAfterMs: entry.blockedUntil - now, window: memoryWindow(entry) };
    }
    if (!entry || entry.blockedUntil !== null || entry.windowEndsAt <= now) {
      entry = { hits: 0, windowEndsAt: now + rule.ttl, blockedUntil: null };
      this.entries.set(key, entry);
    }
    entry.hits += 1;
    if (entry.hits > rule.limit) entry.blockedUntil = now + rule.blockDuration;
    const blocked = entry.blockedUntil !== null;
    return { hits: entry.hits, blocked, retryAfterMs: blocked ? entry.blockedUntil! - now : 0, window: memoryWindow(entry) };
  }

  async block(key: string, durationMs: number): Promise<void> {
    const now = this.now();
    const entry = this.entries.get(key) ?? { hits: 0, windowEndsAt: now, blockedUntil: null };
    entry.blockedUntil = Math.max(entry.blockedUntil ?? 0, now + durationMs);
    this.entries.set(key, entry);
  }

  async clear(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async clearPrefix(prefix: string): Promise<void> {
    for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.entries.delete(key);
  }

  async release(key: string, window: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry || entry.blockedUntil !== null || entry.hits < 1) return;
    if (memoryWindow(entry) !== window || entry.windowEndsAt <= this.now()) return;
    entry.hits -= 1;
  }

  /** Keys whose window and block have both passed go every 10 minutes. */
  private purgeNowAndThen(now: number) {
    if (now - this.lastPurgeAt < PURGE_EVERY_MS) return;
    this.lastPurgeAt = now;
    for (const [key, entry] of this.entries) {
      if (entry.windowEndsAt <= now && (entry.blockedUntil === null || entry.blockedUntil <= now)) this.entries.delete(key);
    }
  }
}

/**
 * The counts in `rate_limit_hits`, shared by every API process (API_WORKERS > 1), with the same
 * upsert as `DatabaseThrottlerStorage` and the same fallback: when the database does not answer
 * within 1.5 s, the hit is counted in this process's memory, with one warning a minute. A block
 * goes to memory only when the database does not take it, so the memory holds only what the
 * database could not (its expired keys go with the purge of `MemoryHitCounter`).
 */
export class DatabaseHitCounter implements HitCounter {
  private readonly logger = new Logger('RateLimit');
  private readonly fallback = new MemoryHitCounter();
  private lastPurgeAt = Date.now();
  private lastWarnAt = 0;

  constructor(private readonly dataSource: DataSource, private readonly waitMs = RATE_LIMIT_DB_WAIT_MS) {}

  async hit(key: string, rule: HitRule): Promise<HitOutcome> {
    try {
      const [row] = await answerWithin(this.dataSource.query(HIT_SQL, [key, rule.ttl, rule.limit, rule.blockDuration]) as Promise<HitRow[]>, this.waitMs);
      this.purgeNowAndThen();
      const blocked = row.blocked === true;
      return { hits: Number(row.hits), blocked, retryAfterMs: blocked ? Number(row.block_expires_in_ms) : 0, window: String(row.window_end) };
    } catch (error) {
      this.warn(error);
      return this.fallback.hit(key, rule);
    }
  }

  async block(key: string, durationMs: number): Promise<void> {
    try {
      await answerWithin(this.dataSource.query(BLOCK_SQL, [key, durationMs]), this.waitMs);
    } catch (error) {
      this.warn(error);
      await this.fallback.block(key, durationMs);
    }
  }

  async clear(key: string): Promise<void> {
    await this.fallback.clear(key);
    try {
      await answerWithin(this.dataSource.query(`DELETE FROM rate_limit_hits WHERE key = $1`, [key]), this.waitMs);
    } catch (error) {
      this.warn(error);
    }
  }

  async clearPrefix(prefix: string): Promise<void> {
    await this.fallback.clearPrefix(prefix);
    try {
      await answerWithin(this.dataSource.query(`DELETE FROM rate_limit_hits WHERE starts_with(key, $1)`, [prefix]), this.waitMs);
    } catch (error) {
      this.warn(error);
    }
  }

  async release(key: string, window: string): Promise<void> {
    // A hit counted in memory (the database did not answer) is taken back there.
    if (window.startsWith('memory:')) return this.fallback.release(key, window);
    try {
      await answerWithin(this.dataSource.query(RELEASE_SQL, [key, window]), this.waitMs);
    } catch (error) {
      this.warn(error);
    }
  }

  private warn(error: unknown) {
    const now = Date.now();
    if (now - this.lastWarnAt <= WARN_EVERY_MS) return;
    this.lastWarnAt = now;
    this.logger.warn(`Rate limit counts unavailable in the database, counting in this process only: ${(error as Error)?.message ?? error}`);
  }

  private purgeNowAndThen() {
    const now = Date.now();
    if (now - this.lastPurgeAt < PURGE_EVERY_MS) return;
    this.lastPurgeAt = now;
    this.dataSource.query(PURGE_SQL).catch(() => undefined);
  }
}
