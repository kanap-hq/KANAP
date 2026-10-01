import { QueryRunner } from 'typeorm';
import { inRolledBackTransaction } from '../../spend/__tests__/round-inputs.fixtures';

// Shared by the specs that prove an explicit tenant predicate (not a spec itself).
//
// `app` owns the tables, so without FORCE ROW LEVEL SECURITY its own queries
// see every tenant: the predicate under test is then the only thing keeping
// another tenant's rows out. The transaction is rolled back, the setting with it.
//
// ALTER TABLE takes an ACCESS EXCLUSIVE lock held until the rollback. The locks
// are taken first, with a lock timeout shorter than the deadlock timeout, so
// that against a database other sessions use this spec gives way (and retries)
// instead of making Postgres pick a deadlock victim. Never run it against a
// database a live API uses: it blocks those tables for the length of a test.

const ATTEMPTS = 20;
const LOCK_TIMEOUT = '300ms';

function isLockConflict(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? (err as { driverError?: { code?: string } })?.driverError?.code;
  return code === '55P03' || code === '40P01';
}

/** Run `fn` in a rolled-back transaction where RLS no longer binds `app` on `tables`. */
export async function withRlsLifted(tables: string[], fn: (runner: QueryRunner) => Promise<void>): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await inRolledBackTransaction(async (runner) => {
        await runner.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
        // Table names come from the calling spec's constant list only.
        for (const table of tables) await runner.query(`ALTER TABLE ${table} NO FORCE ROW LEVEL SECURITY`);
        await runner.query(`SET LOCAL lock_timeout = 0`);
        await fn(runner);
      });
      return;
    } catch (err) {
      if (!isLockConflict(err) || attempt >= ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}
