/**
 * Fixed latency buckets, in milliseconds. Counts per bucket add up across seconds and across
 * API processes, which exact samples do not: a p95 of several processes is the p95 of their
 * merged counts. A percentile read from the buckets is the upper bound of the bucket it falls
 * in (at most one bucket step above the exact value).
 */
export const LATENCY_BUCKETS_MS = [1, 2, 5, 10, 25, 50, 100, 150, 250, 400, 600, 1000, 1500, 2500, 4000, 6000, 10000, 15000, 30000, 60000];

/** One count per bucket, plus a last one for anything above 60 s. */
export function emptyCounts(): number[] {
  return new Array(LATENCY_BUCKETS_MS.length + 1).fill(0);
}

export function bucketIndex(ms: number): number {
  for (let i = 0; i < LATENCY_BUCKETS_MS.length; i += 1) {
    if (ms <= LATENCY_BUCKETS_MS[i]) return i;
  }
  return LATENCY_BUCKETS_MS.length;
}

export function addInto(target: number[], source: number[]): number[] {
  for (let i = 0; i < target.length; i += 1) target[i] += Number(source[i] ?? 0);
  return target;
}

export function totalOf(counts: number[]): number {
  return counts.reduce((sum, value) => sum + value, 0);
}

/** The p-th percentile (0 to 100) of the counts, as a bucket's upper bound; 0 when empty. */
export function percentileOf(counts: number[], p: number): number {
  const total = totalOf(counts);
  if (total === 0) return 0;
  const rank = Math.max(1, Math.ceil((p / 100) * total));
  let seen = 0;
  for (let i = 0; i < counts.length; i += 1) {
    seen += counts[i];
    if (seen >= rank) return i < LATENCY_BUCKETS_MS.length ? LATENCY_BUCKETS_MS[i] : LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1];
  }
  return LATENCY_BUCKETS_MS[LATENCY_BUCKETS_MS.length - 1];
}
