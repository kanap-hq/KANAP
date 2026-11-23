// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/audit.entity';
import { dateHistoryRecords } from '../../audit/record-dating';
import { SupplierContactsService } from '../../suppliers/supplier-contacts.service';
import { SupplierContactLink, SupplierContactRole } from '../../contacts/supplier-contact.entity';
import { SpendItemContactsService } from '../../spend/spend-item-contacts.service';
import { SpendItemContactLink } from '../../spend/spend-item-contact.entity';
import { ExternalContact } from '../../contacts/external-contact.entity';
import { SpendItem } from '../../spend/spend-item.entity';
import { syncSupplierContactsWithinUpdate } from '../../contacts/contact-link-attach.util';
import { APP_URL, connect } from '../../data-access/__tests__/data-access-test-helpers';
import { applyPerson } from '../../data-access/__tests__/data-access-line-seed';
import { seedContracts } from '../../data-access/__tests__/data-access-contract-seed';
import { touchUpdatedAtMany } from '../updated-at-trigger';
import { assert, runSpecs } from '../../spend/__tests__/round-inputs.fixtures';

// The dating of the records a history entry names never waits for a lock (`touchUpdatedAtMany`,
// `FOR NO KEY UPDATE SKIP LOCKED`): two connections, committed data, removed at the end.
// - A cycle: a line page adds contact K to line L (holds L, then dates K) while the supplier page
//   adds K to the supplier S of L (dates K and S, then the lines of S): both pass, under a second.
// - A long operation holds L: adding a contact to S passes at once and dates what is free.
// - A line PATCH that moves L to another supplier against a contact save propagated to L.
// - The gesture's own records are dated: a row it locked or changed, in a savepoint or not.
// - Under kanap_data_limited: a record the person may only read is left, without an error.

const OLD = '2020-01-02T03:04:05.000Z';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const code = (e: any) => e?.driverError?.code ?? e?.code ?? e?.status ?? String(e?.message ?? e).slice(0, 80);
type Outcome = { ok: boolean; ms: number; code?: string };

type Seed = { tenantId: string; userId: string; S: string; K: string; K2: string; L: string };

async function open(tenantId: string): Promise<QueryRunner> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  // Longer than any wait the assertions allow: a wait shows as a time, not as a refusal.
  await runner.query(`SET LOCAL lock_timeout = '3s'`);
  return runner;
}

function services(runner: QueryRunner) {
  const audit = new AuditService(runner.manager.getRepository(AuditLog));
  const supplier = new SupplierContactsService(runner.manager.getRepository(SupplierContactLink), audit);
  const line = new SpendItemContactsService(
    runner.manager.getRepository(SpendItemContactLink),
    runner.manager.getRepository(ExternalContact),
    runner.manager.getRepository(SpendItem),
    audit,
  );
  return { supplier, line };
}

function timed(t0: number, promise: Promise<unknown>): Promise<Outcome> {
  return promise.then(() => ({ ok: true, ms: Date.now() - t0 }), (e) => ({ ok: false, code: code(e), ms: Date.now() - t0 }));
}

async function finish(pairs: Array<[QueryRunner, Outcome]>) {
  for (const [runner, outcome] of pairs) {
    if (outcome.ok) await runner.commitTransaction(); else await runner.rollbackTransaction();
    await runner.release();
  }
}

async function withSeed(fn: (seed: Seed, admin: QueryRunner) => Promise<void>) {
  const admin = dataSource.createQueryRunner();
  await admin.connect();
  const tenantId = randomUUID();
  await admin.startTransaction();
  await admin.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Updated at locks', 'active', '{}'::jsonb, '{}'::jsonb, now(), now())`,
    [tenantId, `updated-at-locks-${tenantId.slice(0, 8)}`],
  );
  await admin.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const one = async (sql: string, params: unknown[] = []) => (await admin.query(sql, [tenantId, ...params]))[0].id as string;
  const roleId = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Administrator') RETURNING id`);
  const userId = await one(`INSERT INTO users (tenant_id, email, role_id, status, first_name, last_name) VALUES ($1, 'w@example.test', $2, 'enabled', 'W', 'W') RETURNING id`, [roleId]);
  const S = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Supplier') RETURNING id`);
  const K = await one(`INSERT INTO contacts (tenant_id, email, item_number, first_name, last_name, supplier_id) VALUES ($1, 'k@example.test', 1, 'K', 'K', $2) RETURNING id`, [S]);
  const K2 = await one(`INSERT INTO contacts (tenant_id, email, item_number, first_name, last_name, supplier_id) VALUES ($1, 'k2@example.test', 2, 'K2', 'K2', $2) RETURNING id`, [S]);
  const L = await one(`INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, nature, supplier_id) VALUES ($1, 'Line', 'EUR', '2026-01-01', 1, 'opex', $2) RETURNING id`, [S]);
  for (const table of ['suppliers', 'contacts', 'spend_items']) {
    await admin.query(`UPDATE ${table} SET updated_at = $2 WHERE tenant_id = $1`, [tenantId, OLD]);
  }
  await admin.commitTransaction();
  try {
    await fn({ tenantId, userId, S, K, K2, L }, admin);
  } finally {
    await admin.startTransaction();
    await admin.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    for (const table of ['audit_log', 'spend_item_contacts', 'contract_contacts', 'supplier_contacts', 'spend_items', 'contacts', 'suppliers', 'users', 'roles', 'search_index']) {
      await admin.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [tenantId]);
    }
    await admin.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await admin.commitTransaction();
    await admin.release();
  }
}

/** The date of each record, read in this transaction: 'now' when it is the transaction's now(). */
async function dates(runner: QueryRunner, rows: Array<[string, string]>): Promise<string[]> {
  const out: string[] = [];
  for (const [table, id] of rows) {
    const [row] = await runner.query(`SELECT updated_at = now() AS now, updated_at FROM ${table} WHERE id = $1`, [id]);
    out.push(row.now ? 'now' : new Date(row.updated_at).toISOString());
  }
  return out;
}

async function testCycle() {
  await withSeed(async (s, admin) => {
    const r1 = await open(s.tenantId);
    const r2 = await open(s.tenantId);
    // The line page holds L (lockBudgetLine) before its contact write.
    await r1.query(`SELECT 1 FROM spend_items WHERE tenant_id = $1 AND id = $2 AND nature = 'opex' FOR NO KEY UPDATE`, [s.tenantId, s.L]);
    const t0 = Date.now();
    const p2 = timed(t0, services(r2).supplier.attach(s.S, { contactId: s.K, role: SupplierContactRole.TECHNICAL }, { manager: r2.manager, tenantId: s.tenantId, userId: s.userId } as any));
    await sleep(300);
    const t1 = Date.now();
    const p1 = timed(t1, services(r1).line.attachManual(s.L, { contactId: s.K, role: SupplierContactRole.COMMERCIAL }, s.userId, { manager: r1.manager, tenantId: s.tenantId } as any));
    const [a1, a2] = await Promise.all([p1, p2]);
    await finish([[r1, a1], [r2, a2]]);
    assert.ok(a1.ok && a2.ok, `both gestures pass: line ${JSON.stringify(a1)}, supplier ${JSON.stringify(a2)}`);
    assert.ok(a1.ms < 1000 && a2.ms < 1000, `both under a second: line ${a1.ms} ms, supplier ${a2.ms} ms`);
    await admin.startTransaction();
    await admin.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    const [state] = await admin.query(
      `SELECT (SELECT count(*)::int FROM spend_item_contacts WHERE spend_item_id = $1) AS line_links,
              (SELECT count(*)::int FROM supplier_contacts WHERE supplier_id = $2) AS supplier_links`,
      [s.L, s.S],
    );
    await admin.commitTransaction();
    assert.deepEqual(state, { line_links: 2, supplier_links: 1 }, 'both links are kept');
  });
}

async function testHeldLineDoesNotWait() {
  await withSeed(async (s) => {
    // A long budget operation holds L without changing it (an import, a column copy, a freeze).
    const r3 = await open(s.tenantId);
    const r4 = await open(s.tenantId);
    await r3.query(`SELECT 1 FROM spend_items WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`, [s.tenantId, s.L]);
    const t0 = Date.now();
    const outcome = await timed(t0, services(r4).supplier.attach(s.S, { contactId: s.K2, role: SupplierContactRole.TECHNICAL }, { manager: r4.manager, tenantId: s.tenantId, userId: s.userId } as any));
    const seen = outcome.ok ? await dates(r4, [['suppliers', s.S], ['spend_items', s.L]]) : [];
    await r4.rollbackTransaction(); await r4.release();
    await r3.rollbackTransaction(); await r3.release();
    assert.ok(outcome.ok, `the supplier page passes: ${JSON.stringify(outcome)}`);
    assert.ok(outcome.ms < 200, `without waiting for the held line: ${outcome.ms} ms`);
    assert.deepEqual(seen, ['now', OLD], 'the supplier is dated, the held line keeps its date');
  });
}

async function testLinePatchAgainstContactSave() {
  await withSeed(async (s, admin) => {
    await admin.startTransaction();
    await admin.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    const one = async (sql: string, params: unknown[] = []) => (await admin.query(sql, [s.tenantId, ...params]))[0].id as string;
    const S3 = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'S3') RETURNING id`);
    const S4 = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'S4') RETURNING id`);
    const K3 = await one(`INSERT INTO contacts (tenant_id, email, item_number, first_name, last_name, supplier_id) VALUES ($1, 'k3@example.test', 3, 'K3', 'K3', $2) RETURNING id`, [S3]);
    const K4 = await one(`INSERT INTO contacts (tenant_id, email, item_number, first_name, last_name, supplier_id) VALUES ($1, 'k4@example.test', 4, 'K4', 'K4', $2) RETURNING id`, [S4]);
    await admin.query(`INSERT INTO supplier_contacts (tenant_id, supplier_id, contact_id, role) VALUES ($1, $2, $3, 'commercial'), ($1, $4, $5, 'commercial')`, [s.tenantId, S3, K3, S4, K4]);
    const L3 = await one(`INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, nature, supplier_id) VALUES ($1, 'Line 3', 'EUR', '2026-01-01', 3, 'opex', $2) RETURNING id`, [S3]);
    await admin.query(`INSERT INTO spend_item_contacts (tenant_id, spend_item_id, contact_id, role, origin) VALUES ($1, $2, $3, 'commercial', 'supplier')`, [s.tenantId, L3, K3]);
    await admin.commitTransaction();
    const r5 = await open(s.tenantId);
    const r6 = await open(s.tenantId);
    await r5.query(`UPDATE spend_items SET supplier_id = $2 WHERE id = $1`, [L3, S4]);
    await r6.query(`UPDATE contacts SET last_name = last_name || 'x' WHERE id = $1`, [K3]);
    const t0 = Date.now();
    const c1 = timed(t0, syncSupplierContactsWithinUpdate(r5.manager, 'line L3', () =>
      services(r5).line.syncFromSupplier(L3, S4, s.userId, { manager: r5.manager, tenantId: s.tenantId } as any)));
    await sleep(100);
    const t1 = Date.now();
    const c2 = timed(t1, services(r6).supplier.propagateContactToItems(S3, K3, SupplierContactRole.TECHNICAL, { manager: r6.manager, tenantId: s.tenantId, userId: s.userId } as any));
    const [x1, x2] = await Promise.all([c1, c2]);
    await finish([[r5, x1], [r6, x2]]);
    assert.ok(x1.ok && x2.ok, `both gestures pass: line ${JSON.stringify(x1)}, contact ${JSON.stringify(x2)}`);
    assert.ok(x1.ms < 1000 && x2.ms < 1000, `both under a second: line ${x1.ms} ms, contact ${x2.ms} ms`);
  });
}

async function testOwnRecordsAreDated() {
  await withSeed(async (s) => {
    const runner = await open(s.tenantId);
    try {
      const entryFor = (line: string) => ({
        table: 'spend_item_contacts', recordId: randomUUID(), action: 'create',
        before: null, after: { spend_item_id: line, contact_id: s.K, role: 'commercial' }, parent: { table: 'spend_items', id: line },
      });
      // Locked by the gesture itself, then dated.
      await runner.query(`SELECT 1 FROM spend_items WHERE id = $1 FOR NO KEY UPDATE`, [s.L]);
      await dateHistoryRecords(runner.manager, [entryFor(s.L)]);
      assert.deepEqual(await dates(runner, [['spend_items', s.L]]), ['now'], 'a row the gesture locked is dated');
      // Changed by the gesture in a technical column (no date), inside a released savepoint, then dated.
      await runner.query(`UPDATE spend_items SET updated_at = $2 WHERE id = $1`, [s.L, OLD]);
      await runner.query('SAVEPOINT own');
      await runner.query(`UPDATE spend_items SET status = status WHERE id = $1`, [s.L]);
      await runner.query('RELEASE SAVEPOINT own');
      await dateHistoryRecords(runner.manager, [entryFor(s.L)]);
      assert.deepEqual(await dates(runner, [['spend_items', s.L]]), ['now'], 'a row the gesture changed in a savepoint is dated');
      // Held FOR SHARE by the gesture itself (a task of the line): the dating upgrades its own lock.
      await runner.query(`UPDATE spend_items SET updated_at = $2 WHERE id = $1`, [s.L, OLD]);
      await runner.query('SAVEPOINT shared');
      await runner.query(`SELECT 1 FROM spend_items WHERE id = $1 FOR SHARE`, [s.L]);
      await dateHistoryRecords(runner.manager, [entryFor(s.L)]);
      await runner.query('RELEASE SAVEPOINT shared');
      assert.deepEqual(await dates(runner, [['spend_items', s.L]]), ['now'], 'a row the gesture holds FOR SHARE is dated');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
}

async function testLimitedRole() {
  const client = await connect(APP_URL);
  // The pg client as the manager a service would pass (only `query` is used).
  const m = { query: async (sql: string, params?: unknown[]) => (await client.query(sql, params)).rows } as unknown as Pick<EntityManager, 'query'>;
  try {
    await client.query('BEGIN');
    const s = await seedContracts(client);
    await m.query(`UPDATE spend_items SET updated_at = $2 WHERE tenant_id = $1`, [s.tenantId, OLD]);
    await m.query(`UPDATE contracts SET updated_at = $2 WHERE tenant_id = $1`, [s.tenantId, OLD]);
    const lines = Object.values(s.lines);
    const contracts = Object.values(s.contracts);
    const asPerson = async (who: keyof typeof s.persons, fn: () => Promise<void>) => {
      await client.query('SAVEPOINT p');
      try {
        assert.equal(await applyPerson(client, s.persons[who]), 'limited');
        assert.equal((await m.query(`SELECT current_user AS u`))[0].u, 'kanap_data_limited');
        await fn();
      } finally {
        await client.query('ROLLBACK TO SAVEPOINT p');
      }
    };
    // rob reads every line and contract and may change none: nothing dated, nothing fails.
    await asPerson('rob', async () => {
      assert.equal(await touchUpdatedAtMany(m, 'spend_items', lines), 0, 'rob: no line');
      assert.equal(await touchUpdatedAtMany(m, 'contracts', contracts), 0, 'rob: no contract');
      await dateHistoryRecords(m, [
        { table: 'contract_spend_items', recordId: s.contracts.CF, action: 'update', before: [], after: [s.lines.L1], parent: { table: 'spend_items', id: s.lines.L1 } },
      ]);
    });
    // rita may change L1, only read L2, and L5 is hidden from her.
    await asPerson('rita', async () => {
      assert.equal(await touchUpdatedAtMany(m, 'spend_items', [s.lines.L1]), 1, 'rita: L1 dated');
      assert.equal(await touchUpdatedAtMany(m, 'spend_items', [s.lines.L2]), 0, 'rita: L2 read only');
      assert.equal(await touchUpdatedAtMany(m, 'spend_items', [s.lines.L5]), 0, 'rita: L5 hidden');
    });
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

void runSpecs('updated-at.locks.integration.spec', [
  ['a cycle between a line page and a supplier page', testCycle],
  ['a held line does not make the supplier page wait', testHeldLineDoesNotWait],
  ['a line PATCH against a contact save', testLinePatchAgainstContactSave],
  ['the gesture\'s own records are dated', testOwnRecordsAreDated],
  ['under the limited role', testLimitedRole],
]);
