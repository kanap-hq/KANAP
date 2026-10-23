import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import { dataAccessAvailability, runDataAccessStartup } from '../data-access-availability';

/**
 * The availability kept in memory (planning/data-scoped-access/spec.md §6.2), no database: a fake
 * pool counts the dedicated connections the checks open.
 * - a check that fails for a technical reason (no connection) is not kept: the next read checks
 *   again, and the startup routine keeps nothing either;
 * - concurrent reads share one check;
 * - a check that ran is kept.
 */

type Fake = { dataSource: DataSource; opened: () => number; setFailing: (failing: boolean) => void };

function fakeDataSource(): Fake {
  let opened = 0;
  let failing = true;
  const dataSource = {
    createQueryRunner: () => {
      opened += 1;
      return {
        connect: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          if (failing) throw new Error('timeout exceeded when trying to connect');
        },
        // The first query of the check: no limited role, a check that ran.
        query: async () => [{ role_exists: false, schema_create_missing: false }],
        release: async () => undefined,
      };
    },
  } as unknown as DataSource;
  return { dataSource, opened: () => opened, setFailing: (value) => { failing = value; } };
}

const UNCHECKED = { available: false, missing: [] };
const NO_ROLE = { available: false, missing: ['role'] };

async function testFailedCheckNotKept(): Promise<void> {
  const fake = fakeDataSource();
  assert.deepEqual(await dataAccessAvailability(fake.dataSource), UNCHECKED);
  assert.equal(fake.opened(), 1);
  assert.deepEqual(await dataAccessAvailability(fake.dataSource), UNCHECKED);
  assert.equal(fake.opened(), 2, 'a failed check is not kept: the next read checks again');

  const both = await Promise.all([dataAccessAvailability(fake.dataSource), dataAccessAvailability(fake.dataSource)]);
  assert.deepEqual(both, [UNCHECKED, UNCHECKED]);
  assert.equal(fake.opened(), 3, 'concurrent reads share one check');

  fake.setFailing(false);
  assert.deepEqual(await dataAccessAvailability(fake.dataSource), NO_ROLE);
  assert.equal(fake.opened(), 4);
  assert.deepEqual(await dataAccessAvailability(fake.dataSource), NO_ROLE);
  assert.equal(fake.opened(), 4, 'a check that ran is kept');
  console.log('  failed check not kept, one check at a time, a check that ran kept: OK');
}

async function testFailedStartupNotKept(): Promise<void> {
  const fake = fakeDataSource();
  const quiet = { log: () => undefined, warn: () => undefined };
  assert.deepEqual(await runDataAccessStartup(fake.dataSource, quiet), UNCHECKED);
  assert.equal(fake.opened(), 1);
  fake.setFailing(false);
  assert.deepEqual(await dataAccessAvailability(fake.dataSource), NO_ROLE, 'the first read checks again');
  assert.equal(fake.opened(), 2);
  console.log('  failed startup check not kept: OK');
}

async function main(): Promise<void> {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    await testFailedCheckNotKept();
    await testFailedStartupNotKept();
  } finally {
    console.warn = warn;
  }
  console.log('data-access-availability-cache.spec: all passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
