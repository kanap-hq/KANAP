import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ApplicationsInstancesService } from '../services/applications-instances.service';
import { replaceItemApplications } from '../../spend/item-applications';

// Links between applications and OPEX / CAPEX lines, contracts and projects,
// written from either side, against a real database:
// - from the application: every id is resolved under the tenant (FK checks
//   bypass RLS), another tenant's row or an unknown id is a 400 and nothing is
//   written; the links carry the tenant; one audit row per change;
// - two concurrent replacements of the same owner, from the line
//   (replaceItemApplications) or from the application: the second waits on
//   the owner's row lock, then reads what the first committed. The same set
//   is stored once; two different sets end as the second one exactly, and its
//   audit row says so.

type AuditEntry = { table: string; recordId?: string | null; action: string; before?: unknown; after?: unknown };

function captureAudit() {
  const entries: AuditEntry[] = [];
  return { entries, log: async (entry: AuditEntry) => void entries.push(entry) };
}

function instancesService(audit = captureAudit()) {
  return new ApplicationsInstancesService(undefined as any, undefined as any, audit as any);
}

async function setTenant(runner: QueryRunner | EntityManager, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

type TenantSeed = {
  tenantId: string;
  appId: string;
  app2Id: string;
  capexId: string;
  capex2Id: string;
  spendId: string;
  spend2Id: string;
};

/** A tenant with two applications, two CAPEX lines and two OPEX lines; leaves the session on that tenant. */
async function seedTenant(runner: QueryRunner, tag: string): Promise<TenantSeed> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ail-${tag}-${tenantId.slice(0, 8)}`, `App item links ${tag}`],
  );
  await setTenant(runner, tenantId);
  const app = async (name: string) =>
    (await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]))[0].id;
  const capex = async (description: string, itemNumber: number) =>
    (
      await runner.query(
        `INSERT INTO capex_items (tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number)
         VALUES ($1, $2, 'hardware', 'replacement', 'medium', 'EUR', '2026-01-01', $3) RETURNING id`,
        [tenantId, description, itemNumber],
      )
    )[0].id;
  const spend = async (productName: string, itemNumber: number) =>
    (
      await runner.query(
        `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number)
         VALUES ($1, $2, 'EUR', '2026-01-01', $3) RETURNING id`,
        [tenantId, productName, itemNumber],
      )
    )[0].id;
  return {
    tenantId,
    appId: await app(`Links app ${tag}`),
    app2Id: await app(`Links app ${tag} 2`),
    capexId: await capex(`Links CAPEX ${tag}`, 1),
    capex2Id: await capex(`Links CAPEX ${tag} 2`, 2),
    spendId: await spend(`Links OPEX ${tag}`, 1),
    spend2Id: await spend(`Links OPEX ${tag} 2`, 2),
  };
}

/** A contract (with its company and supplier) and a project of the session's tenant. */
async function seedContractAndProject(runner: QueryRunner, tenantId: string, tag: string) {
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const companyId = await one(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`,
    [tenantId, `Links company ${tag}`],
  );
  const supplierId = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `Links supplier ${tag}`]);
  const contractId = await one(
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, DATE '2026-01-01') RETURNING id`,
    [tenantId, `Links contract ${tag}`, companyId, supplierId],
  );
  const projectId = await one(
    `INSERT INTO portfolio_projects (tenant_id, name, item_number) VALUES ($1, $2, 1) RETURNING id`,
    [tenantId, `Links project ${tag}`],
  );
  return { contractId, projectId };
}

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

type LinkTable = 'application_capex_items' | 'application_spend_items' | 'application_contracts' | 'application_projects';
const ITEM_FK: Record<LinkTable, string> = {
  application_capex_items: 'capex_item_id',
  application_spend_items: 'spend_item_id',
  application_contracts: 'contract_id',
  application_projects: 'project_id',
};

async function links(manager: QueryRunner | EntityManager, table: LinkTable, appId: string) {
  const itemFk = ITEM_FK[table];
  return manager.query(`SELECT tenant_id, ${itemFk} AS item_id FROM ${table} WHERE application_id = $1 ORDER BY ${itemFk}`, [appId]);
}

function isBadRequest(message: string) {
  return (err: unknown) => {
    assert.ok(err instanceof BadRequestException, `a 400, got ${(err as Error)?.message}`);
    assert.equal((err as BadRequestException).message, message);
    return true;
  };
}

/** From the application, another tenant's line, contract or project, or an id that names nothing, is a 400 and writes nothing. */
async function testAppSideRefusesForeignRows() {
  await inRolledBackTransaction(async (runner) => {
    const b = await seedTenant(runner, 'b');
    const bOther = await seedContractAndProject(runner, b.tenantId, 'b');
    const a = await seedTenant(runner, 'a');
    const aOther = await seedContractAndProject(runner, a.tenantId, 'a');
    const audit = captureAudit();
    const svc = instancesService(audit);
    const opts = { manager: runner.manager };

    for (const ids of [[b.capexId], [a.capexId, b.capexId], [randomUUID()], ['not-a-uuid']]) {
      await assert.rejects(svc.bulkReplaceLinkedCapexItems(a.appId, ids, null, opts), isBadRequest('One or more CAPEX items were not found.'));
    }
    for (const ids of [[b.spendId], [randomUUID()]]) {
      await assert.rejects(svc.bulkReplaceLinkedSpendItems(a.appId, ids, null, opts), isBadRequest('One or more OPEX items were not found.'));
    }
    for (const ids of [[bOther.contractId], [aOther.contractId, bOther.contractId], ['not-a-uuid']]) {
      await assert.rejects(svc.bulkReplaceLinkedContracts(a.appId, ids, null, opts), isBadRequest('One or more contracts were not found.'));
    }
    for (const ids of [[bOther.projectId], [randomUUID()]]) {
      await assert.rejects(svc.bulkReplaceProjects(a.appId, ids, null, opts), isBadRequest('One or more projects were not found.'));
    }
    for (const table of ['application_capex_items', 'application_spend_items', 'application_contracts', 'application_projects'] as const) {
      assert.deepEqual(await links(runner, table, a.appId), [], `${table}: nothing written`);
    }
    assert.equal(audit.entries.length, 0);
  });
}

/** From the application, links carry the tenant, an id in upper case matches its stored twin, and a change is audited once. */
async function testAppSideReplacesUnderTenant() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'a');
    const aOther = await seedContractAndProject(runner, a.tenantId, 'a');
    const audit = captureAudit();
    const svc = instancesService(audit);
    const opts = { manager: runner.manager };

    assert.deepEqual(
      await svc.bulkReplaceLinkedCapexItems(a.appId, [a.capexId.toUpperCase(), ` ${a.capexId} `], 'user', opts),
      { ok: true, added: 1, removed: 0 },
    );
    assert.deepEqual(await links(runner, 'application_capex_items', a.appId), [{ tenant_id: a.tenantId, item_id: a.capexId }]);
    assert.deepEqual(await svc.listLinkedCapexItems(a.appId, opts), { items: [{ id: a.capexId, description: 'Links CAPEX a' }] });
    assert.deepEqual(await svc.bulkReplaceLinkedCapexItems(a.appId, [a.capexId], 'user', opts), { ok: true, added: 0, removed: 0 });

    await svc.bulkReplaceLinkedSpendItems(a.appId, [a.spendId], 'user', opts);
    assert.deepEqual(await links(runner, 'application_spend_items', a.appId), [{ tenant_id: a.tenantId, item_id: a.spendId }]);
    assert.deepEqual(await svc.listLinkedSpendItems(a.appId, opts), { items: [{ id: a.spendId, product_name: 'Links OPEX a' }] });

    assert.deepEqual(await svc.bulkReplaceLinkedContracts(a.appId, [aOther.contractId], 'user', opts), { ok: true, added: 1, removed: 0 });
    assert.deepEqual(await links(runner, 'application_contracts', a.appId), [{ tenant_id: a.tenantId, item_id: aOther.contractId }]);
    assert.deepEqual(await svc.listLinkedContracts(a.appId, opts), { items: [{ id: aOther.contractId, name: 'Links contract a' }] });

    assert.deepEqual(
      await svc.bulkReplaceProjects(a.appId, [aOther.projectId], 'user', opts),
      { items: [{ id: aOther.projectId, name: 'Links project a' }] },
    );
    assert.deepEqual(await links(runner, 'application_projects', a.appId), [{ tenant_id: a.tenantId, item_id: aOther.projectId }]);

    assert.deepEqual(await svc.bulkReplaceLinkedCapexItems(a.appId, [], 'user', opts), { ok: true, added: 0, removed: 1 });
    assert.deepEqual(await links(runner, 'application_capex_items', a.appId), []);

    assert.deepEqual(
      audit.entries.map((e) => [e.table, e.recordId, e.before, e.after]),
      [
        ['application_capex_items', a.appId, [], [a.capexId]],
        ['application_spend_items', a.appId, [], [a.spendId]],
        ['application_contracts', a.appId, [], [aOther.contractId]],
        ['application_projects', a.appId, [], [aOther.projectId]],
        ['application_capex_items', a.appId, [a.capexId], []],
      ],
    );
  });
}

async function waitUntilBlocked(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await dataSource.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (row?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the second replacement never waited for the first one');
}

async function openTenantTransaction(tenantId: string) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  await setTenant(runner, tenantId);
  return runner;
}

type StoredLink = { application_id: string; item_id: string };

/**
 * `first` in T1, then `second` in T2 while T1 is open: T2 waits on the
 * owner's row lock until T1 commits. Afterwards the table holds `expected`.
 */
async function concurrentReplace(
  seed: TenantSeed,
  table: 'application_capex_items' | 'application_spend_items',
  first: (manager: EntityManager) => Promise<unknown>,
  second: (manager: EntityManager) => Promise<unknown>,
  expected: StoredLink[],
) {
  const t1 = await openTenantTransaction(seed.tenantId);
  const t2 = await openTenantTransaction(seed.tenantId);
  try {
    await first(t1.manager);
    const [{ pid }] = await t2.query(`SELECT pg_backend_pid() AS pid`);
    let t2Done = false;
    const pending = second(t2.manager).finally(() => {
      t2Done = true;
    });
    pending.catch(() => undefined);
    await waitUntilBlocked(pid);
    assert.equal(t2Done, false, 'the second replacement waits for the first');
    await t1.commitTransaction();
    await pending;
    await t2.commitTransaction();

    const stored = await dataSource.transaction(async (manager) => {
      await setTenant(manager, seed.tenantId);
      return manager.query(
        `SELECT application_id, ${ITEM_FK[table]} AS item_id FROM ${table} WHERE tenant_id = $1 ORDER BY 1, 2`,
        [seed.tenantId],
      );
    });
    assert.deepEqual(stored, expected, `${table}: stored links`);
  } finally {
    for (const runner of [t1, t2]) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
      await runner.release();
    }
    await dataSource.transaction(async (manager) => {
      await setTenant(manager, seed.tenantId);
      await manager.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [seed.tenantId]);
    });
  }
}

/**
 * Concurrent replacements of the same owner, from the line's side and from
 * the application's side: the same set is stored once, and two different
 * sets end as the second one, which its audit row reports.
 */
async function testConcurrentReplacements() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  let seed: TenantSeed;
  try {
    seed = await seedTenant(runner, 'race');
    await runner.commitTransaction();
  } catch (err) {
    await runner.rollbackTransaction();
    throw err;
  } finally {
    await runner.release();
  }

  const fromLine = (kind: 'capex' | 'opex', itemId: string, appIds: string[], audit = captureAudit()) =>
    (manager: EntityManager) => replaceItemApplications({ manager, audit }, kind, { id: itemId, tenant_id: seed.tenantId }, appIds, null);

  try {
    // The same set twice: one link.
    await concurrentReplace(
      seed, 'application_capex_items',
      fromLine('capex', seed.capexId, [seed.appId]), fromLine('capex', seed.capexId, [seed.appId]),
      [{ application_id: seed.appId, item_id: seed.capexId }],
    );
    await concurrentReplace(
      seed, 'application_spend_items',
      fromLine('opex', seed.spendId, [seed.appId]), fromLine('opex', seed.spendId, [seed.appId]),
      [{ application_id: seed.appId, item_id: seed.spendId }],
    );
    await concurrentReplace(
      seed, 'application_capex_items',
      (manager) => instancesService().bulkReplaceLinkedCapexItems(seed.appId, [seed.capexId], null, { manager }),
      (manager) => instancesService().bulkReplaceLinkedCapexItems(seed.appId, [seed.capexId], null, { manager }),
      [{ application_id: seed.appId, item_id: seed.capexId }],
    );
    await concurrentReplace(
      seed, 'application_spend_items',
      (manager) => instancesService().bulkReplaceLinkedSpendItems(seed.appId, [seed.spendId], null, { manager }),
      (manager) => instancesService().bulkReplaceLinkedSpendItems(seed.appId, [seed.spendId], null, { manager }),
      [{ application_id: seed.appId, item_id: seed.spendId }],
    );

    // Two different sets: the second one, exactly, and its audit row matches.
    const lineAudit = captureAudit();
    await concurrentReplace(
      seed, 'application_capex_items',
      fromLine('capex', seed.capexId, [seed.appId]), fromLine('capex', seed.capexId, [seed.app2Id], lineAudit),
      [{ application_id: seed.app2Id, item_id: seed.capexId }],
    );
    assert.deepEqual(lineAudit.entries.map((e) => [e.before, e.after]), [[[seed.appId], [seed.app2Id]]], 'line side: audit of the second');

    const appAudit = captureAudit();
    await concurrentReplace(
      seed, 'application_spend_items',
      (manager) => instancesService().bulkReplaceLinkedSpendItems(seed.appId, [seed.spendId], null, { manager }),
      (manager) => instancesService(appAudit).bulkReplaceLinkedSpendItems(seed.appId, [seed.spend2Id], null, { manager }),
      [{ application_id: seed.appId, item_id: seed.spend2Id }],
    );
    assert.deepEqual(appAudit.entries.map((e) => [e.before, e.after]), [[[seed.spendId], [seed.spend2Id]]], 'application side: audit of the second');
  } finally {
    await dataSource.transaction(async (manager) => {
      await setTenant(manager, seed.tenantId);
      await manager.query(`DELETE FROM capex_items WHERE tenant_id = $1`, [seed.tenantId]);
      await manager.query(`DELETE FROM spend_items WHERE tenant_id = $1`, [seed.tenantId]);
      await manager.query(`DELETE FROM applications WHERE tenant_id = $1`, [seed.tenantId]);
      await manager.query(`DELETE FROM item_sequences WHERE tenant_id = $1`, [seed.tenantId]);
    });
    await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [seed.tenantId]);
  }
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testAppSideRefusesForeignRows, testAppSideReplacesUnderTenant, testConcurrentReplacements]) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n').slice(0, 20).join('\n    ')}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`application-item-links.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('application-item-links.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
