import { EntityManager } from 'typeorm';

let savepointSequence = 0;

/**
 * Runs `fn` under its own savepoint, so a failure inside undoes only `fn`'s work
 * and the surrounding transaction stays usable (Postgres aborts the whole
 * transaction on any error otherwise). Each call gets a unique savepoint name, so
 * nested calls are safe. The error is rethrown after the rollback to the
 * savepoint, so a caller's catch block can query again.
 * Without an open transaction every statement commits on its own anyway.
 */
export async function withSavepoint<T>(manager: EntityManager, fn: () => Promise<T>): Promise<T> {
  if (!manager.queryRunner?.isTransactionActive) return fn();
  savepointSequence = (savepointSequence + 1) % Number.MAX_SAFE_INTEGER;
  const name = `kanap_sp_${savepointSequence}`;
  await manager.query(`SAVEPOINT ${name}`);
  try {
    const result = await fn();
    await manager.query(`RELEASE SAVEPOINT ${name}`);
    return result;
  } catch (err) {
    await manager.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await manager.query(`RELEASE SAVEPOINT ${name}`);
    throw err;
  }
}
