/**
 * The ops metrics must answer when the database pool is saturated, which is when they matter: a
 * read they make from the database is given a short time, then left (it may still complete later,
 * its result unused).
 */
export const OPS_DB_READ_TIMEOUT_MS = 1_000;

export async function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  promise.catch(() => undefined);
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what}: no answer within ${ms} ms`)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
