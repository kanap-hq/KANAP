import { DataSource } from 'typeorm';

/**
 * The start-up writes of `main.ts` (admin seed, single-tenant provisioning: tenant, administrator,
 * subscription) check then insert. With several API processes starting together, two could both
 * find nothing and both insert. They run under this session advisory lock, taken and released on
 * one dedicated connection: the processes take turns, and the later ones find everything in
 * place. A single process takes it uncontended.
 */
export const STARTUP_PROVISIONING_LOCK = 'kanap:startup-provisioning';

export async function withStartupLock<T>(dataSource: DataSource, key: string, fn: () => Promise<T>): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await runner.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
    try {
      return await fn();
    } finally {
      await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => undefined);
    }
  } finally {
    await runner.release();
  }
}
