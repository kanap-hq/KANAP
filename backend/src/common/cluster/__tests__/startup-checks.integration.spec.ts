import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import dataSource from '../../../data-source';
import { checkPoolBudget, evaluatePoolBudget, poolMaxFloorWarning, readPoolMax } from '../../db-pool-budget';
import { STARTUP_PROVISIONING_LOCK, withStartupLock } from '../startup-lock';

// Start of several API processes (plan planning/perf-scale lots 4A and 4B):
// - the connection budget: processes × DB_POOL_MAX must fit in max_connections minus the
//   reserved connections and a margin; the lead process warns at start, it never stops;
// - the start-up writes (admin seed, single-tenant provisioning) check then insert: the
//   processes take turns under one advisory lock, so the later ones find the rows in place.

function testBudgetRule() {
  const fits = evaluatePoolBudget({ processes: 4, poolMax: 20, maxConnections: 100, reserved: 3 });
  assert.deepEqual([fits.needed, fits.usable, fits.ok], [80, 87, true]);
  assert.match(fits.message, /4 processes × 20 connections = 80 of 87 usable/);

  const over = evaluatePoolBudget({ processes: 5, poolMax: 20, maxConnections: 100, reserved: 3 });
  assert.equal(over.ok, false, '100 connections asked, 87 usable');
  assert.match(over.message, /pool budget exceeded/);
  assert.match(over.message, /Lower DB_POOL_MAX \(to 17 or less\)/, 'the warning names a pool size that fits');

  const single = evaluatePoolBudget({ processes: 1, poolMax: 20, maxConnections: 100, reserved: 3 });
  assert.equal(single.ok, true, 'today\'s default (one process, 20 connections) fits a default server');
  assert.match(single.message, /1 process × 20/);

  assert.equal(readPoolMax({} as NodeJS.ProcessEnv), 20);
  assert.equal(readPoolMax({ DB_POOL_MAX: '12' } as NodeJS.ProcessEnv), 12);
  assert.equal(readPoolMax({ DB_POOL_MAX: 'x' } as NodeJS.ProcessEnv), 20);

  // The floor: never under 2 connections per process, never advised under 2.
  assert.equal(readPoolMax({ DB_POOL_MAX: '1' } as NodeJS.ProcessEnv), 2, 'DB_POOL_MAX=1 is raised to 2');
  assert.match(poolMaxFloorWarning({ DB_POOL_MAX: '1' } as NodeJS.ProcessEnv) ?? '', /DB_POOL_MAX=1 raised to 2/);
  assert.equal(poolMaxFloorWarning({ DB_POOL_MAX: '2' } as NodeJS.ProcessEnv), null);
  assert.equal(poolMaxFloorWarning({} as NodeJS.ProcessEnv), null);
  const crowded = evaluatePoolBudget({ processes: 16, poolMax: 10, maxConnections: 40, reserved: 3 });
  assert.equal(crowded.ok, false);
  assert.doesNotMatch(crowded.message, /Lower DB_POOL_MAX \(to [01] /, 'never advises a pool under 2');
  assert.match(crowded.message, /Lower API_WORKERS \(each process needs at least 2 connections\)/);
}

async function testBudgetReadsTheServer() {
  const [{ max }] = await dataSource.query(`SELECT current_setting('max_connections')::int AS max`);
  const budget = await checkPoolBudget((sql, params) => dataSource.query(sql, params), { processes: 2, poolMax: 10 });
  assert.equal(budget.maxConnections, max, 'reads max_connections from the server');
  assert.ok(budget.reserved >= 1, 'counts the superuser reserved connections');
  assert.equal(budget.ok, 20 <= budget.usable);
  const tooMany = await checkPoolBudget((sql, params) => dataSource.query(sql, params), { processes: 16, poolMax: max });
  assert.equal(tooMany.ok, false, 'a budget above the server is reported');
}

async function testStartupWritesTakeTurns(other: DataSource) {
  const order: string[] = [];
  const step = (name: string, ms: number) => async () => {
    order.push(`${name} start`);
    await new Promise((resolve) => setTimeout(resolve, ms));
    order.push(`${name} end`);
  };
  await Promise.all([
    withStartupLock(dataSource, STARTUP_PROVISIONING_LOCK, step('a', 200)),
    new Promise((resolve) => setTimeout(resolve, 30)).then(() => withStartupLock(other, STARTUP_PROVISIONING_LOCK, step('b', 10))),
  ]);
  assert.deepEqual(order, ['a start', 'a end', 'b start', 'b end'], 'the second process waits for the first one');

  await assert.rejects(() => withStartupLock(dataSource, STARTUP_PROVISIONING_LOCK, async () => { throw new Error('boom'); }), /boom/);
  const [{ free }] = await other.query(
    `SELECT pg_try_advisory_lock(hashtext($1)) AS free`, [STARTUP_PROVISIONING_LOCK],
  );
  assert.equal(free, true, 'a failure releases the lock');
  await other.query(`SELECT pg_advisory_unlock(hashtext($1))`, [STARTUP_PROVISIONING_LOCK]);
}

async function main() {
  process.exitCode = 1;
  await dataSource.initialize();
  const other = new DataSource({ ...(dataSource.options as any), poolSize: 1 });
  await other.initialize();
  const failures: string[] = [];
  try {
    for (const [label, test] of [
      ['testBudgetRule', async () => testBudgetRule()],
      ['testBudgetReadsTheServer', testBudgetReadsTheServer],
      ['testStartupWritesTakeTurns', () => testStartupWritesTakeTurns(other)],
    ] as const) {
      try {
        await test();
        console.log(`ok - ${label}`);
      } catch (err) {
        failures.push(`${label}: ${(err as Error).message}`);
      }
    }
  } finally {
    await other.destroy();
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`startup-checks.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('startup-checks.integration.spec: ok');
  process.exitCode = 0;
}

void main();
