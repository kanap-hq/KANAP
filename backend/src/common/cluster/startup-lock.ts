import { DataSource, QueryRunner } from 'typeorm';

/**
 * The start-up writes of `main.ts` (admin seed, single-tenant provisioning: tenant, administrator,
 * subscription) check then insert. With several API processes starting together, two could both
 * find nothing and both insert. They run under this session advisory lock, taken and released on
 * one dedicated connection: the processes take turns, and the later ones find everything in
 * place. A single process takes it uncontended.
 *
 * `fn` receives the connection that holds the lock: work that must stop when the lock is lost (the
 * migrations, startup-migrations.ts) runs on it. `onWait` is called once when another session
 * holds the lock, before waiting for it.
 */
export const STARTUP_PROVISIONING_LOCK = 'kanap:startup-provisioning';

export async function withStartupLock<T>(
  dataSource: DataSource,
  key: string,
  fn: (lockConnection: QueryRunner) => Promise<T>,
  onWait?: () => void,
): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [key]);
    if (!locked) {
      onWait?.();
      await runner.query('SELECT pg_advisory_lock(hashtext($1))', [key]);
    }
    try {
      return await fn(runner);
    } finally {
      await runner.query('SELECT pg_advisory_unlock(hashtext($1))', [key]).catch(() => undefined);
    }
  } finally {
    await runner.release();
  }
}
