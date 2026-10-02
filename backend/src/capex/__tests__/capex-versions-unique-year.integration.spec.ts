import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { CapexVersionsService } from '../capex-versions.service';

// One CAPEX version per line and year (migration 1853640000000), against a
// real database: the unique index refuses a second version, and createForItem
// is a get-or-create of the year (lot 3A, `spend/budget-version-ensure.ts`):
// a second create of a year (given or default) returns the version that year
// already has, also when it was created concurrently, without a failed
// statement; a name used by another year is a 400.

const YEAR = 2033;
const NAME_TAKEN = 'Version name already exists for this item';

const noAudit = { log: async () => undefined };
const currencySettings = { getSettings: async () => ({ reportingCurrency: 'EUR' }) };

function versionsService() {
  return new CapexVersionsService(undefined as any, undefined as any, noAudit as any, currencySettings as any);
}

function isNameTaken(err: unknown) {
  return err instanceof BadRequestException && err.message === NAME_TAKEN;
}

async function seedTenantAndItem(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  const itemId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `cvu-${tag}-${tenantId.slice(0, 8)}`, `CAPEX versions unique ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  await runner.query(
    `INSERT INTO capex_items (id, tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number)
     VALUES ($1, $2, 'Unique year line', 'hardware', 'replacement', 'medium', 'EUR', '${YEAR}-01-01', 1)`,
    [itemId, tenantId],
  );
  return { tenantId, itemId };
}

async function insertVersion(runner: QueryRunner, tenantId: string, itemId: string, name: string, year: number) {
  await runner.query(
    `INSERT INTO capex_versions (tenant_id, capex_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
     VALUES ($1, $2, $3, 'annual', '${year}-01-01', ${year}, 'default')`,
    [tenantId, itemId, name],
  );
}

async function inRolledBackTransaction(tag: string, fn: (runner: QueryRunner, seed: { tenantId: string; itemId: string }) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner, await seedTenantAndItem(runner, tag));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

/** A raw second version for the same line and year is refused by the index; another year is not. */
async function testIndexRefusesSecondVersion() {
  await inRolledBackTransaction('raw', async (runner, { tenantId, itemId }) => {
    const [index] = await runner.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'capex_versions' AND indexname = 'uniq_capex_item_budget_year'`,
    );
    assert.match(String(index?.indexdef), /CREATE UNIQUE INDEX .* \(capex_item_id, budget_year\)/, 'the unique index exists');
    await insertVersion(runner, tenantId, itemId, `Budget ${YEAR}`, YEAR);
    await insertVersion(runner, tenantId, itemId, `Budget ${YEAR + 1}`, YEAR + 1);
    await assert.rejects(
      insertVersion(runner, tenantId, itemId, `Second ${YEAR}`, YEAR),
      (err: any) => err?.code === '23505' && err?.constraint === 'uniq_capex_item_budget_year',
    );
  });
}

/** A second create of a year returns the version it has; a name of another year is a 400. */
async function testCreateForItemReturnsTheYearsVersion() {
  await inRolledBackTransaction('check', async (runner, { itemId }) => {
    const service = versionsService();
    const first = await service.createForItem(itemId, { version_name: `Budget ${YEAR}`, budget_year: YEAR }, null, { manager: runner.manager });
    const again = await service.createForItem(itemId, { version_name: 'Another name', budget_year: YEAR }, null, { manager: runner.manager });
    assert.equal(again.id, first.id, 'the version of the year is returned');
    assert.equal(again.version_name, `Budget ${YEAR}`, 'unchanged');
    await assert.rejects(
      service.createForItem(itemId, { version_name: `Budget ${YEAR}`, budget_year: YEAR + 1 }, null, { manager: runner.manager }),
      isNameTaken,
    );
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM capex_versions WHERE capex_item_id = $1`, [itemId]);
    assert.equal(n, 1, 'one version');
    await runner.query(`SELECT 1`); // the transaction is still usable
  });
}

/**
 * A create without a year takes the current one and returns the version that
 * year has, without a failed statement (the transaction stays usable).
 */
async function testCreateForItemDefaultYear() {
  await inRolledBackTransaction('default', async (runner, { tenantId, itemId }) => {
    const currentYear = new Date().getFullYear();
    await insertVersion(runner, tenantId, itemId, `Budget ${currentYear}`, currentYear);
    const version = await versionsService().createForItem(itemId, { version_name: 'No year given' }, null, { manager: runner.manager });
    assert.equal(version.budget_year, currentYear);
    assert.equal(version.version_name, `Budget ${currentYear}`);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM capex_versions WHERE capex_item_id = $1`, [itemId]);
    assert.equal(n, 1, 'no second version, and the transaction is not aborted');
  });
}

async function waitUntilBlocked(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await dataSource.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (row?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the second create never waited for the first one');
}

async function openTenantTransaction(tenantId: string) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return runner;
}

/**
 * Two creates of the same year at once: T2 finds no version (T1's is not
 * committed yet), waits on the index, and returns T1's version once T1
 * commits. Only T1's version is kept.
 */
async function testConcurrentCreateReturnsTheWinner() {
  const seed = dataSource.createQueryRunner();
  await seed.connect();
  await seed.startTransaction();
  let tenantId: string;
  let itemId: string;
  try {
    ({ tenantId, itemId } = await seedTenantAndItem(seed, 'race'));
    await seed.commitTransaction();
  } catch (err) {
    await seed.rollbackTransaction();
    throw err;
  } finally {
    await seed.release();
  }

  const t1 = await openTenantTransaction(tenantId);
  const t2 = await openTenantTransaction(tenantId);
  try {
    const service = versionsService();
    await service.createForItem(itemId, { version_name: 'First', budget_year: YEAR }, null, { manager: t1.manager });

    const [{ pid }] = await t2.query(`SELECT pg_backend_pid() AS pid`);
    let t2Done = false;
    const t2Create = service
      .createForItem(itemId, { version_name: 'Second', budget_year: YEAR }, null, { manager: t2.manager })
      .finally(() => { t2Done = true; });
    t2Create.catch(() => undefined);
    await waitUntilBlocked(pid);
    assert.equal(t2Done, false, 'the second create waits on the index');

    await t1.commitTransaction();
    const second = await t2Create;
    await t2.commitTransaction();
    assert.equal(second.version_name, 'First', 'T2 gets the version T1 committed');

    const names = await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      return manager.query(`SELECT version_name FROM capex_versions WHERE capex_item_id = $1`, [itemId]);
    });
    assert.deepEqual(names.map((row: any) => row.version_name), ['First']);
  } finally {
    for (const runner of [t1, t2]) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
      await runner.release();
    }
    await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      await manager.query(`DELETE FROM capex_versions WHERE tenant_id = $1`, [tenantId]);
      await manager.query(`DELETE FROM capex_items WHERE tenant_id = $1`, [tenantId]);
    });
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
  }
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [
      testIndexRefusesSecondVersion,
      testCreateForItemReturnsTheYearsVersion,
      testCreateForItemDefaultYear,
      testConcurrentCreateReturnsTheWinner,
    ]) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`capex-versions-unique-year.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('capex-versions-unique-year.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
