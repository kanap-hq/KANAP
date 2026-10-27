import { HttpException, HttpStatus, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

const WINDOW_MS = 60_000;
const CLEANUP_INTERVAL_MS = 300_000;

/**
 * 429 of an MCP key over its limit. `retryAfterSeconds` becomes the `Retry-After` header
 * (release-tenant-runner.filter.ts) and is repeated in the body for clients that read only JSON.
 */
export class McpRateLimitedException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super({
      code: 'MCP_RATE_LIMITED',
      message: `MCP API key rate limit exceeded. Retry in ${retryAfterSeconds} s.`,
      retry_after_seconds: retryAfterSeconds,
    }, HttpStatus.TOO_MANY_REQUESTS);
  }
}

@Injectable()
export class AiMcpRateLimiter implements OnModuleInit, OnModuleDestroy {
  private readonly windows = new Map<string, number[]>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  onModuleInit() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // `cost` is the number of requests charged at once (the messages of a JSON-RPC batch).
  assertAllowed(
    tenantId: string,
    apiKeyId: string | null | undefined,
    limitPerMinute: number,
    cost = 1,
  ): void {
    const key = `${tenantId}:${apiKeyId || 'anonymous'}`;
    const now = Date.now();
    const events = this.prune(this.windows.get(key) ?? [], now - WINDOW_MS);
    if (events.length + cost > limitPerMinute) {
      this.windows.set(key, events);
      throw new McpRateLimitedException(this.retryAfterSeconds(events, cost, limitPerMinute, now));
    }
    for (let i = 0; i < cost; i += 1) {
      events.push(now);
    }
    this.windows.set(key, events);
  }

  // The window slides: the request fits once enough of the oldest requests have left it. A request
  // larger than the whole limit never fits; it waits a full window.
  private retryAfterSeconds(events: number[], cost: number, limitPerMinute: number, now: number): number {
    const mustLeave = events.length + cost - limitPerMinute;
    if (cost > limitPerMinute || mustLeave > events.length) {
      return Math.ceil(WINDOW_MS / 1000);
    }
    const freedAt = events[mustLeave - 1] + WINDOW_MS;
    return Math.max(1, Math.ceil((freedAt - now) / 1000));
  }

  private prune(values: number[], minTs: number): number[] {
    return values.filter((value) => value >= minTs);
  }

  private cleanup() {
    const minTs = Date.now() - WINDOW_MS;
    for (const [key, values] of this.windows.entries()) {
      const next = this.prune(values, minTs);
      if (next.length === 0) {
        this.windows.delete(key);
      } else {
        this.windows.set(key, next);
      }
    }
  }
}
