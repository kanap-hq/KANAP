import { performance } from 'node:perf_hooks';
import { addInto, bucketIndex, emptyCounts, percentileOf, totalOf } from './latency-histogram';

/**
 * Database pool of this API process, as the ops metrics show it (plan planning/perf-scale lot
 * 4D): how many connections are in use, how many requests wait for one, and how long they wait.
 *
 * The wait is timed around `pool.connect()` of the pg pool TypeORM uses (`driver.master`): every
 * query runner, so every request transaction, gets its connection there. The timing goes into
 * one latency histogram per second, kept 5 minutes. In use and waiting are sampled every second.
 */
type PgPoolLike = {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  connect: (...args: any[]) => any;
  __kanapPoolMetrics?: boolean;
};

type Slot = { second: number; counts: number[]; max: number; failed: number; inUseMax: number; inUseSum: number; waitingMax: number; samples: number };

const KEEP_SECONDS = 300;

export type PoolMetricsSnapshot = {
  maxPool: number;
  totalCount: number;
  idleCount: number;
  inUse: number;
  waitingCount: number;
  utilizationPct: number;
  /** Highest in use over the last minute (sampled every second). */
  inUseMax1m: number;
  inUseAvg1m: number;
  waitingMax1m: number;
  /** Time to get a connection from the pool. */
  wait: {
    count1m: number;
    p50Ms1m: number;
    p95Ms1m: number;
    maxMs1m: number;
    p95Ms5m: number;
    /** Connections not obtained (pool timeout, database unreachable) over 5 minutes. */
    failures5m: number;
  };
};

/**
 * Every connection the pool may open is open and requests wait for one: a read added now would
 * only queue behind them. (Waiting alone is not enough: a request also waits while the pool
 * opens a new connection below its size.)
 */
export function poolSaturated(pool: Pick<PoolMetricsSnapshot, 'totalCount' | 'maxPool' | 'waitingCount'>): boolean {
  return pool.waitingCount > 0 && pool.totalCount >= pool.maxPool;
}

export class PoolMetrics {
  private readonly slots: Slot[] = [];
  private pool: PgPoolLike | null = null;
  private sampler: NodeJS.Timeout | null = null;

  constructor(private readonly maxPool: number, private readonly now: () => number = () => Date.now()) {}

  /** Starts timing the pool's connections and sampling its use. Safe to call once per pool. */
  attach(pool: PgPoolLike | null | undefined): boolean {
    if (!pool || typeof pool.connect !== 'function' || typeof pool.totalCount !== 'number') return false;
    this.pool = pool;
    if (!pool.__kanapPoolMetrics) {
      pool.__kanapPoolMetrics = true;
      const original = pool.connect.bind(pool);
      pool.connect = (callback?: (err: Error | undefined, client: unknown, done: unknown) => void) => {
        const started = performance.now();
        if (typeof callback === 'function') {
          return original((err: Error | undefined, client: unknown, done: unknown) => {
            this.recordWait(performance.now() - started, Boolean(err));
            callback(err, client, done);
          });
        }
        return original().then(
          (client: unknown) => { this.recordWait(performance.now() - started, false); return client; },
          (err: unknown) => { this.recordWait(performance.now() - started, true); throw err; },
        );
      };
    }
    if (this.sampler) clearInterval(this.sampler);
    this.sampler = setInterval(() => this.sample(), 1000);
    this.sampler.unref?.();
    return true;
  }

  detach() {
    if (this.sampler) clearInterval(this.sampler);
    this.sampler = null;
  }

  recordWait(ms: number, failed: boolean) {
    const slot = this.slotNow();
    slot.counts[bucketIndex(ms)] += 1;
    if (ms > slot.max) slot.max = ms;
    if (failed) slot.failed += 1;
  }

  sample() {
    if (!this.pool) return;
    const slot = this.slotNow();
    const inUse = Math.max(0, this.pool.totalCount - this.pool.idleCount);
    slot.inUseMax = Math.max(slot.inUseMax, inUse);
    slot.inUseSum += inUse;
    slot.waitingMax = Math.max(slot.waitingMax, this.pool.waitingCount);
    slot.samples += 1;
  }

  snapshot(): PoolMetricsSnapshot {
    const nowSecond = Math.floor(this.now() / 1000);
    const last = (seconds: number) => this.slots.filter((slot) => nowSecond - slot.second < seconds);
    const minute = last(60);
    const five = last(KEEP_SECONDS);
    const counts1m = minute.reduce((acc, slot) => addInto(acc, slot.counts), emptyCounts());
    const counts5m = five.reduce((acc, slot) => addInto(acc, slot.counts), emptyCounts());
    const samples1m = minute.reduce((sum, slot) => sum + slot.samples, 0);
    const totalCount = this.pool?.totalCount ?? 0;
    const idleCount = this.pool?.idleCount ?? 0;
    const inUse = Math.max(0, totalCount - idleCount);
    return {
      maxPool: this.maxPool,
      totalCount,
      idleCount,
      inUse,
      waitingCount: this.pool?.waitingCount ?? 0,
      utilizationPct: this.maxPool > 0 ? Math.round((inUse / this.maxPool) * 1000) / 10 : 0,
      inUseMax1m: minute.reduce((max, slot) => Math.max(max, slot.inUseMax), inUse),
      inUseAvg1m: samples1m > 0 ? Math.round((minute.reduce((sum, slot) => sum + slot.inUseSum, 0) / samples1m) * 10) / 10 : inUse,
      waitingMax1m: minute.reduce((max, slot) => Math.max(max, slot.waitingMax), this.pool?.waitingCount ?? 0),
      wait: {
        count1m: totalOf(counts1m),
        p50Ms1m: percentileOf(counts1m, 50),
        p95Ms1m: percentileOf(counts1m, 95),
        maxMs1m: Math.round(minute.reduce((max, slot) => Math.max(max, slot.max), 0) * 10) / 10,
        p95Ms5m: percentileOf(counts5m, 95),
        failures5m: five.reduce((sum, slot) => sum + slot.failed, 0),
      },
    };
  }

  /** Latency bucket counts of the connection waits over the last `seconds` (merged across processes). */
  waitCounts(seconds: number): number[] {
    const nowSecond = Math.floor(this.now() / 1000);
    return this.slots
      .filter((slot) => nowSecond - slot.second < seconds)
      .reduce((acc, slot) => addInto(acc, slot.counts), emptyCounts());
  }

  private slotNow(): Slot {
    const second = Math.floor(this.now() / 1000);
    const lastSlot = this.slots[this.slots.length - 1];
    if (lastSlot && lastSlot.second === second) return lastSlot;
    const slot: Slot = { second, counts: emptyCounts(), max: 0, failed: 0, inUseMax: 0, inUseSum: 0, waitingMax: 0, samples: 0 };
    this.slots.push(slot);
    while (this.slots.length > 0 && second - this.slots[0].second >= KEEP_SECONDS) this.slots.shift();
    return slot;
  }
}
