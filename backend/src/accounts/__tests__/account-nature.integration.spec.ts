import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { AccountsService } from '../accounts.service';

// The OPEX/CAPEX nature of accounts (lot N) on the accounts API, against a real
// database, each test in a transaction that is rolled back:
// - `GET /accounts/:id` (`getWithConsolidationStatus`) returns `line_counts`:
//   the OPEX and CAPEX lines of every status that use the account, never
//   another tenant's lines;
// - the `nature` set filter of the accounts list: null and '' are the accounts
//   for OPEX and CAPEX (nature NULL), a value its accounts, a mix their union.

let itemNumber = 0;

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function asTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<{ tenantId: string; chartId: string }> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `nature-api-${tag}-${tenantId.slice(0, 8)}`, `Account nature API ${tag}`],
  );
  await asTenant(runner, tenantId);
  const [chart] = await runner.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'NAT', 'Nature chart', 'FR') RETURNING id`,
    [tenantId],
  );
  return { tenantId, chartId: chart.id };
}

async function seedAccount(runner: QueryRunner, tenantId: string, chartId: string, number: number, nature: string | null): Promise<string> {
  await asTenant(runner, tenantId);
  const [row] = await runner.query(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name, nature) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, chartId, number, `Account ${number}`, nature],
  );
  return row.id;
}

async function seedLine(runner: QueryRunner, tenantId: string, kind: 'opex' | 'capex', accountId: string, disabled = false) {
  await asTenant(runner, tenantId);
  itemNumber += 1;
  const disabledAt = disabled ? '2020-01-01T00:00:00Z' : null;
  if (kind === 'opex') {
    await runner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, account_id, status, disabled_at)
       VALUES ($1, 'Nature line', 'EUR', '2026-01-01', $2, $3, $4, $5)`,
      [tenantId, 800000 + itemNumber, accountId, disabled ? 'disabled' : 'enabled', disabledAt],
    );
  } else {
    await runner.query(
      `INSERT INTO capex_items (tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number, account_id, status, disabled_at)
       VALUES ($1, 'Nature line', 'hardware', 'replacement', 'medium', 'EUR', '2026-01-01', $2, $3, $4, $5)`,
      [tenantId, 800000 + itemNumber, accountId, disabled ? 'disabled' : 'enabled', disabledAt],
    );
  }
}

function service() {
  return new AccountsService(undefined as any, new AuditService(undefined as any));
}

async function testLineCounts() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'a');
    const b = await seedTenant(runner, 'b');
    const used = await seedAccount(runner, a.tenantId, a.chartId, 6100, null);
    const unused = await seedAccount(runner, a.tenantId, a.chartId, 6200, 'opex');
    await seedLine(runner, a.tenantId, 'opex', used);
    await seedLine(runner, a.tenantId, 'opex', used, true);
    await seedLine(runner, a.tenantId, 'capex', used);
    await seedLine(runner, a.tenantId, 'capex', used, true);
    await seedLine(runner, a.tenantId, 'capex', used, true);
    // Lines of tenant B naming tenant A's account (foreign keys ignore tenants): not counted.
    await seedLine(runner, b.tenantId, 'opex', used);
    await seedLine(runner, b.tenantId, 'capex', used);

    await asTenant(runner, a.tenantId);
    const accounts = service();
    const opts = { manager: runner.manager };
    const got = await accounts.getWithConsolidationStatus(used, opts);
    assert.deepEqual(got.line_counts, { opex: 2, capex: 3 }, 'every status counts, another tenant\'s lines do not');
    assert.equal(got.nature, null, 'the nature is returned');
    const none = await accounts.getWithConsolidationStatus(unused, opts);
    assert.deepEqual(none.line_counts, { opex: 0, capex: 0 }, 'an unused account');
    assert.equal(none.nature, 'opex');
  });
}

async function testNatureFilter() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'filter');
    await seedAccount(runner, a.tenantId, a.chartId, 6100, 'opex');
    await seedAccount(runner, a.tenantId, a.chartId, 2100, 'capex');
    await seedAccount(runner, a.tenantId, a.chartId, 6900, null);
    await asTenant(runner, a.tenantId);
    const accounts = service();
    const opts = { manager: runner.manager };
    const numbers = async (values: Array<string | null>) => {
      const filters = JSON.stringify({ nature: { filterType: 'set', values } });
      const page = await accounts.list({ coaId: a.chartId, sort: 'account_number:ASC', limit: 50, filters }, opts);
      const ids = await accounts.listIds({ coaId: a.chartId, sort: 'account_number:ASC', filters }, opts);
      assert.equal(ids.total, page.total, `listIds agrees with list for ${JSON.stringify(values)}`);
      return page.items.map((item: any) => Number(item.account_number));
    };
    assert.deepEqual(await numbers([null]), [6900], 'null: the accounts for OPEX and CAPEX');
    assert.deepEqual(await numbers(['']), [6900], "'': the accounts for OPEX and CAPEX");
    assert.deepEqual(await numbers(['capex']), [2100], 'capex only');
    assert.deepEqual(await numbers([null, 'opex']), [6100, 6900], 'OPEX accounts and those for both');
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testLineCounts, testNatureFilter]) {
      try {
        await test();
        console.log(`ok - ${test.name}`);
      } catch (err) {
        console.error(err);
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`account-nature.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('account-nature.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
