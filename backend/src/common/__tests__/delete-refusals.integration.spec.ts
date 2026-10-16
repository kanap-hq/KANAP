import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { Account } from '../../accounts/account.entity';
import { AccountsDeleteService } from '../../accounts/accounts-delete.service';
import { ChartOfAccounts } from '../../accounts/chart-of-accounts.entity';
import { ChartOfAccountsDeleteService } from '../../accounts/chart-of-accounts-delete.service';
import { Asset } from '../../assets/asset.entity';
import { AssetsDeleteService } from '../../assets/assets-delete.service';
import { Company } from '../../companies/company.entity';
import { Department } from '../../departments/department.entity';
import { DepartmentsDeleteService } from '../../departments/departments-delete.service';
import { User } from '../../users/user.entity';
import { UsersDeleteService } from '../../users/users-delete.service';
import { ReferenceCheckService } from '../reference-check.service';
import * as cc from '../../cost-centers/__tests__/cost-center-test-helpers';
import * as wdp from '../../working-day-profiles/__tests__/working-day-profile-test-helpers';

// Every refusable delete answers the same way (lot 5 bis): a 409 whose `code` the interface
// translates, with what holds the record counted per kind (`usages`), the same code and counts on
// the bulk delete's failed item, and a check before the delete (`deleteCheck`) that lists the
// records the delete would refuse, in the order asked, without writing anything. Each test runs
// under a throwaway tenant in a rolled-back transaction.

const noAudit = { log: async () => undefined } as any;

async function withRollback(fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Delete refusals', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `del-refusals-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id as string;
}

let savepoint = 0;

/** The refusal of a single delete, under a savepoint: a 409 with the code and the counts per kind. */
async function expectRefusal(
  runner: QueryRunner,
  run: () => Promise<unknown>,
  code: string,
  usages: Array<{ type: string; total: number }>,
  message: RegExp,
) {
  const name = `refusal_${(savepoint += 1)}`;
  await runner.query(`SAVEPOINT ${name}`);
  try {
    await assert.rejects(run, (err: unknown) => {
      assert.ok(err instanceof ConflictException, `a 409, got ${(err as Error)?.constructor?.name}: ${(err as Error)?.message}`);
      const body = err.getResponse() as Record<string, unknown>;
      assert.equal(body.code, code);
      assert.deepEqual(body.usages, usages);
      assert.match(String(body.message), message);
      return true;
    });
  } finally {
    await runner.query(`ROLLBACK TO SAVEPOINT ${name}`);
  }
}

async function count(runner: QueryRunner, table: string, ids: string[]): Promise<number> {
  const [row] = await runner.query(`SELECT count(*)::int AS n FROM ${table} WHERE id = ANY($1::uuid[])`, [ids]);
  return row.n;
}

const asset = (r: QueryRunner, t: string, name: string) =>
  one(
    r,
    `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, created_at, updated_at)
     VALUES ($1, $2, 'physical_server', 'on_premise', 'prod', 'active', now(), now()) RETURNING id`,
    [t, name],
  );

async function connectionFrom(r: QueryRunner, t: string, assetId: string, name: string) {
  await r.query(
    `INSERT INTO connections (tenant_id, connection_reference, name, topology, source_asset_id)
     VALUES ($1, $2, $3, 'server_to_server', $4)`,
    [t, `CON-${randomUUID().slice(0, 6)}`, name, assetId],
  );
}

async function testAssets() {
  await withRollback(async (runner, t) => {
    const svc = new AssetsDeleteService(runner.manager.getRepository(Asset), noAudit);
    const free = await asset(runner, t, 'par-spare-01');
    const used = await asset(runner, t, 'par-fw-01');
    await connectionFrom(runner, t, used, 'Paris to Gouda');
    await connectionFrom(runner, t, used, 'Paris to Lyon');

    assert.deepEqual(await svc.deleteCheck([free, used, 'nope', randomUUID()], t, { manager: runner.manager }), {
      refused: [{ id: used, name: 'par-fw-01', code: 'ASSET_IN_USE', usages: [{ type: 'connections', total: 2 }] }],
    });
    assert.equal(await count(runner, 'assets', [free, used]), 2, 'the check deletes nothing');

    await expectRefusal(runner, () => svc.deleteAsset(used, t, null, { manager: runner.manager }), 'ASSET_IN_USE',
      [{ type: 'connections', total: 2 }], /Cannot delete asset "par-fw-01": is linked to 2 connection\(s\)/);

    const bulk = await svc.bulkDelete([free, used], null, t, { manager: runner.manager });
    assert.deepEqual(bulk.deleted, [free]);
    assert.equal(bulk.failed[0].code, 'ASSET_IN_USE');
    assert.deepEqual(bulk.failed[0].usages, [{ type: 'connections', total: 2 }]);
  });
}

async function testCostCenters() {
  await withRollback(async (runner, t) => {
    const { svc, del } = cc.services(runner.manager);
    const ctx = cc.context(runner.manager, t);
    const paris = await cc.seedCompany(runner, t, 'Refusals Paris');
    const group = await svc.create({ code: 'IT', kind: 'group', name: 'IT department' }, ctx);
    const freeChild = await svc.create({ code: 'IT-1', kind: 'cost_center', name: 'Free', company_id: paris, parent_id: group.id }, ctx);
    const usedChild = await svc.create({ code: 'IT-2', kind: 'cost_center', name: 'Used', company_id: paris, parent_id: group.id }, ctx);
    await cc.seedLine(runner, 'opex', t, usedChild.id);
    await cc.seedLine(runner, 'opex', t, usedChild.id);
    await cc.seedLine(runner, 'capex', t, usedChild.id);

    await expectRefusal(runner, () => del.delete(usedChild.id, ctx), 'COST_CENTER_IN_USE',
      [{ type: 'opex_lines', total: 2 }, { type: 'capex_lines', total: 1 }], /^IT-2 is used by 2 OPEX lines and 1 CAPEX line\. Disable it instead\.$/);
    await expectRefusal(runner, () => del.delete(group.id, ctx), 'COST_CENTER_HAS_NODES',
      [{ type: 'nodes', total: 2 }], /^IT department still contains 2 nodes\. Move or delete them first\.$/);

    // Played in the bulk delete's order: the free child goes first, the used one keeps the group.
    assert.deepEqual(await del.deleteCheck([group.id, freeChild.id, usedChild.id], ctx), {
      refused: [
        { id: group.id, name: 'IT · IT department', code: 'COST_CENTER_HAS_NODES', usages: [{ type: 'nodes', total: 1 }] },
        { id: usedChild.id, name: 'IT-2 · Used', code: 'COST_CENTER_IN_USE', usages: [{ type: 'opex_lines', total: 2 }, { type: 'capex_lines', total: 1 }] },
      ],
    });
    assert.equal(await count(runner, 'cost_centers', [group.id, freeChild.id, usedChild.id]), 3, 'the check deletes nothing');

    const bulk = await del.bulkDelete([usedChild.id, freeChild.id], ctx);
    assert.deepEqual(bulk.deleted, [freeChild.id]);
    assert.deepEqual(bulk.failed.map((f) => [f.code, f.usages]), [['COST_CENTER_IN_USE', [{ type: 'opex_lines', total: 2 }, { type: 'capex_lines', total: 1 }]]]);
  });
}

async function testCalendars() {
  await withRollback(async (runner, t) => {
    const { svc, del } = wdp.services(runner.manager);
    const ctx = wdp.context(runner.manager, t);
    const used = await svc.create({ code: 'FR218', name: 'France 218', days_by_year: { 2026: wdp.FR218 } }, ctx);
    const spare = await svc.create({ code: 'SPARE', name: 'Spare calendar' }, ctx);
    const line = await wdp.seedLine(runner, 'capex', t);
    await wdp.seedCalendarRound(runner, 'capex', t, line.versionId, used.id, 'planned');

    assert.deepEqual(await del.deleteCheck([spare.id, used.id], ctx), {
      refused: [{ id: used.id, name: 'France 218', code: 'CALENDAR_IN_USE', usages: [{ type: 'capex_lines', total: 1 }] }],
    });
    await expectRefusal(runner, () => del.delete(used.id, ctx), 'CALENDAR_IN_USE',
      [{ type: 'capex_lines', total: 1 }], /^France 218 is used by 1 CAPEX line\. Disable it instead\.$/);
    const bulk = await del.bulkDelete([used.id, spare.id], ctx);
    assert.deepEqual(bulk.deleted, [spare.id]);
    assert.deepEqual(bulk.failed.map((f) => f.code), ['CALENDAR_IN_USE']);
  });
}

async function testUsers() {
  await withRollback(async (runner, t) => {
    const svc = new UsersDeleteService(runner.manager.getRepository(User), noAudit);
    const me = await cc.seedUser(runner, t, 'me@refusals.test');
    const other = await cc.seedUser(runner, t, 'other@refusals.test');
    // Refusals name a user by name; the e-mail stands in only when the user has no name.
    await runner.query(`UPDATE users SET first_name = 'Marie', last_name = 'Curie' WHERE id = $1`, [me]);
    await runner.query(`UPDATE users SET first_name = NULL, last_name = NULL WHERE id = $1`, [other]);

    assert.deepEqual(await svc.deleteCheck([other, me], me, { manager: runner.manager }), {
      refused: [{ id: me, name: 'Marie Curie', code: 'USER_OWN_ACCOUNT', usages: [] }],
    });
    assert.deepEqual(await svc.deleteCheck([other], other, { manager: runner.manager }), {
      refused: [{ id: other, name: 'other@refusals.test', code: 'USER_OWN_ACCOUNT', usages: [] }],
    });
    await expectRefusal(runner, () => svc.deleteUser(me, me, { manager: runner.manager }), 'USER_OWN_ACCOUNT', [], /You cannot delete your own account/);
    const bulk = await svc.bulkDelete([me, other], me, { manager: runner.manager });
    assert.deepEqual(bulk.deleted, [other]);
    assert.deepEqual(bulk.failed.map((f) => [f.code, f.name, f.usages]), [['USER_OWN_ACCOUNT', 'Marie Curie', []]]);
  });
}

// The users delete-check reports one's own account only: no foreign key can refuse a user delete.
// Every key to `users`, directly or through a cascade, cascades or sets a nullable column to null.
// A new RESTRICT or NO ACTION key (or SET NULL on a NOT NULL column) fails here: the delete-check
// and the users list's confirmation text must then learn that refusal.
async function testNoForeignKeyRefusesAUserDelete() {
  const blocking: Array<{ parent: string; child: string; column: string }> = await dataSource.query(
    `WITH RECURSIVE casc(rel) AS (
       SELECT 'users'::regclass
       UNION
       SELECT c.conrelid::regclass FROM pg_constraint c JOIN casc ON c.confrelid = casc.rel
        WHERE c.contype = 'f' AND c.confdeltype = 'c'
     )
     SELECT casc.rel::text AS parent, c.conrelid::regclass::text AS child, a.attname AS column
       FROM casc
       JOIN pg_constraint c ON c.confrelid = casc.rel AND c.contype = 'f'
       JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
      WHERE c.confdeltype IN ('a', 'r')
         OR (c.confdeltype IN ('n', 'd') AND a.attnotnull)
      ORDER BY 1, 2, 3`,
  );
  assert.deepEqual(blocking, [], 'a foreign key can refuse a user delete: report it in the users delete-check');
}

async function testAccountsAndCharts() {
  await withRollback(async (runner, t) => {
    const accounts = new AccountsDeleteService(runner.manager.getRepository(Account), noAudit, new ReferenceCheckService());
    const charts = new ChartOfAccountsDeleteService(
      runner.manager.getRepository(ChartOfAccounts),
      runner.manager.getRepository(Company),
      runner.manager.getRepository(Account),
      noAudit,
    );
    const chart = (code: string) =>
      one(runner, `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, $2, $3, 'FR') RETURNING id`, [t, code, `Chart ${code}`]);
    const account = (coaId: string, n: number) =>
      one(runner, `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, $3, $4) RETURNING id`, [t, coaId, n, `Account ${n}`]);
    const line = async (nature: 'opex' | 'capex', accountId: string) => {
      const id = await cc.seedLine(runner, nature, t, null);
      await runner.query(`UPDATE spend_items SET account_id = $3 WHERE tenant_id = $1 AND id = $2`, [t, id, accountId]);
    };

    const lines = await chart('LINES');
    const usedAccount = await account(lines, 6000);
    const freeAccount = await account(lines, 6100);
    await line('opex', usedAccount);
    await line('capex', usedAccount);
    const withCompany = await chart('COMP');
    await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Refusals company', 'FR', 'Lyon', $2)`,
      [t, withCompany],
    );
    const spare = await chart('SPARE');

    const accountUsages = [{ type: 'opex_lines', total: 1 }, { type: 'capex_lines', total: 1 }];
    assert.deepEqual(await accounts.deleteCheck([freeAccount, usedAccount], { manager: runner.manager }), {
      refused: [{ id: usedAccount, name: '6000 - Account 6000', code: 'ACCOUNT_IN_USE', usages: accountUsages }],
    });
    await expectRefusal(runner, () => accounts.delete(usedAccount, { manager: runner.manager }), 'ACCOUNT_IN_USE', accountUsages,
      /Cannot delete account "6000 - Account 6000": 1 OPEX item\(s\) reference this account; 1 CAPEX item\(s\) reference this account/);
    const accountBulk = await accounts.bulkDelete([usedAccount, freeAccount], null, { manager: runner.manager });
    assert.deepEqual(accountBulk.deleted, [freeAccount]);
    assert.deepEqual(accountBulk.failed.map((f) => [f.code, f.usages]), [['ACCOUNT_IN_USE', accountUsages]]);

    assert.deepEqual(await charts.deleteCheck([spare, withCompany, lines], { manager: runner.manager }), {
      refused: [
        { id: withCompany, name: 'COMP - Chart COMP', code: 'CHART_OF_ACCOUNTS_IN_USE', usages: [{ type: 'companies', total: 1 }] },
        { id: lines, name: 'LINES - Chart LINES', code: 'CHART_OF_ACCOUNTS_IN_USE', usages: accountUsages },
      ],
    });
    await expectRefusal(runner, () => charts.delete(withCompany, { manager: runner.manager }), 'CHART_OF_ACCOUNTS_IN_USE',
      [{ type: 'companies', total: 1 }], /1 companies reference this Chart of Accounts/);
    const chartBulk = await charts.bulkDelete([lines, spare], null, { manager: runner.manager });
    assert.deepEqual(chartBulk.deleted, [spare]);
    assert.deepEqual(chartBulk.failed.map((f) => [f.code, f.usages]), [['CHART_OF_ACCOUNTS_IN_USE', accountUsages]]);
  });
}

/** A version of `lineId` for 2026 allocated to `departmentId`. */
async function allocate(r: QueryRunner, t: string, lineId: string, companyId: string, departmentId: string) {
  const versionId = await one(
    r,
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, as_of_date, budget_year)
     VALUES ($1, $2, 'Budget 2026', '2026-01-01', 2026) RETURNING id`,
    [t, lineId],
  );
  await r.query(
    `INSERT INTO spend_allocations (tenant_id, version_id, company_id, department_id, allocation_pct) VALUES ($1, $2, $3, $4, 100)`,
    [t, versionId, companyId, departmentId],
  );
}

async function testDepartments() {
  await withRollback(async (runner, t) => {
    const svc = new DepartmentsDeleteService(runner.manager.getRepository(Department), noAudit);
    const paris = await cc.seedCompany(runner, t, 'Departments Paris');
    const department = (name: string) =>
      one(runner, `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, $3) RETURNING id`, [t, paris, name]);
    const free = await department('Spare');
    const used = await department('Finance');
    await allocate(runner, t, await cc.seedLine(runner, 'opex', t, null), paris, used);
    await allocate(runner, t, await cc.seedLine(runner, 'opex', t, null), paris, used);
    await allocate(runner, t, await cc.seedLine(runner, 'capex', t, null), paris, used);
    const usages = [{ type: 'opex_lines', total: 2 }, { type: 'capex_lines', total: 1 }];

    assert.deepEqual(await svc.deleteCheck([free, used, 'nope'], { manager: runner.manager }), {
      refused: [{ id: used, name: 'Finance', code: 'DEPARTMENT_IN_USE', usages }],
    });
    assert.equal(await count(runner, 'departments', [free, used]), 2, 'the check deletes nothing');
    await expectRefusal(runner, () => svc.delete(used, { manager: runner.manager }), 'DEPARTMENT_IN_USE', usages,
      /^Cannot delete department "Finance": it is being used in allocations/);
    const bulk = await svc.bulkDelete([free, used], null, { manager: runner.manager });
    assert.deepEqual(bulk.deleted, [free]);
    assert.deepEqual(bulk.failed.map((f) => [f.code, f.usages]), [['DEPARTMENT_IN_USE', usages]]);
  });
}

async function run() {
  await dataSource.initialize();
  try {
    for (const test of [testAssets, testCostCenters, testCalendars, testUsers, testNoForeignKeyRefusesAUserDelete, testAccountsAndCharts, testDepartments]) {
      await test();
      console.log(`  ok ${test.name}`);
    }
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('delete-refusals.integration.spec.ts OK'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
