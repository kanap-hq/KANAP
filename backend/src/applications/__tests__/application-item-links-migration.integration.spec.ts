import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ApplicationItemLinksTenantKeys1853690000000 as Migration } from '../../migrations/1853690000000-application-item-links-tenant-keys';

// Migration 1853690000000 (tenant keys on the application <-> OPEX / CAPEX
// line links), against a real database, each test in a transaction that is
// rolled back: down() brings the old schema back, a dirty state is seeded,
// up() repairs it (and logs what it did, naming the links deleted as orphans
// or across tenants), a second up() changes nothing, the new keys refuse a
// cross-tenant or duplicate link, down() restores the old keys and keeps a
// unique key it did not create, and a line without tenant stops the
// migration with a sentence naming its links.

const migration = new Migration();
const LOG_PREFIX = '[Migration] ApplicationItemLinksTenantKeys:';
const LINK_TABLES = ['application_capex_items', 'application_spend_items'] as const;
const RLS_TABLES = [...LINK_TABLES, 'applications', 'spend_items', 'capex_items'];

type World = {
  tenantA: string;
  tenantB: string;
  appA1: string;
  appA2: string;
  appB1: string;
  capexA1: string;
  capexB1: string;
  spendA1: string;
  spendB1: string;
};

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ail-${tag}-${tenantId.slice(0, 8)}`, `App item links ${tag}`],
  );
  return tenantId;
}

async function seedApp(runner: QueryRunner, tenantId: string, name: string): Promise<string> {
  const [row] = await runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, name]);
  return row.id;
}

async function seedCapex(runner: QueryRunner, tenantId: string, itemNumber: number): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO capex_items (tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number)
     VALUES ($1, 'Link test CAPEX', 'hardware', 'replacement', 'medium', 'EUR', '2026-01-01', $2) RETURNING id`,
    [tenantId, itemNumber],
  );
  return row.id;
}

async function seedSpend(runner: QueryRunner, tenantId: string, itemNumber: number): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number)
     VALUES ($1, 'Link test OPEX', 'EUR', '2026-01-01', $2) RETURNING id`,
    [tenantId, itemNumber],
  );
  return row.id;
}

/** Two tenants, each with applications and lines, seeded through RLS under their own tenant. */
async function seedWorld(runner: QueryRunner): Promise<World> {
  const tenantA = await seedTenant(runner, 'a');
  const tenantB = await seedTenant(runner, 'b');
  await setTenant(runner, tenantA);
  const appA1 = await seedApp(runner, tenantA, 'Link app A1');
  const appA2 = await seedApp(runner, tenantA, 'Link app A2');
  const capexA1 = await seedCapex(runner, tenantA, 1);
  const spendA1 = await seedSpend(runner, tenantA, 1);
  await setTenant(runner, tenantB);
  const appB1 = await seedApp(runner, tenantB, 'Link app B1');
  const capexB1 = await seedCapex(runner, tenantB, 1);
  const spendB1 = await seedSpend(runner, tenantB, 1);
  return { tenantA, tenantB, appA1, appA2, appB1, capexA1, capexB1, spendA1, spendB1 };
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

/** Runs `fn` and returns every line logged meanwhile (the migration's summary and detail lines). */
async function captureLogs(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return lines;
}

/** The keys this migration creates, replaces or restores, by name. */
const KEY_NAMES = [
  'application_capex_items_application_fk',
  'application_capex_items_capex_item_fk',
  'application_spend_items_application_fk',
  'application_spend_items_spend_item_fk',
  'uq_app_capex',
  'uq_app_spend',
  'applications_tenant_id_id_key',
  'spend_items_tenant_id_id_key',
  'capex_items_tenant_id_id_key',
  'fk_app_capex_app',
  'fk_app_capex_item',
  'fk_app_spend_app',
  'fk_app_spend_item',
];

/** Those keys on the five tables, with the mark of the ones this migration created. */
async function keys(runner: QueryRunner): Promise<string[]> {
  const rows: Array<{ line: string }> = await runner.query(
    `SELECT conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
            || CASE WHEN obj_description(oid, 'pg_constraint') IS NULL THEN '' ELSE ' [marked]' END AS line
     FROM pg_constraint
     WHERE conrelid::regclass::text = ANY($1::text[]) AND conname = ANY($2::text[])`,
    [RLS_TABLES, KEY_NAMES],
  );
  // Code-unit order (C collation), whatever the database's collation.
  return rows.map((r) => r.line).sort();
}

const NEW_KEYS = [
  'application_capex_items application_capex_items_application_fk FOREIGN KEY (tenant_id, application_id) REFERENCES applications(tenant_id, id) ON DELETE CASCADE',
  'application_capex_items application_capex_items_capex_item_fk FOREIGN KEY (tenant_id, capex_item_id) REFERENCES capex_items(tenant_id, id) ON DELETE CASCADE',
  'application_capex_items uq_app_capex UNIQUE (tenant_id, application_id, capex_item_id) [marked]',
  'application_spend_items application_spend_items_application_fk FOREIGN KEY (tenant_id, application_id) REFERENCES applications(tenant_id, id) ON DELETE CASCADE',
  'application_spend_items application_spend_items_spend_item_fk FOREIGN KEY (tenant_id, spend_item_id) REFERENCES spend_items(tenant_id, id) ON DELETE CASCADE',
  'application_spend_items uq_app_spend UNIQUE (tenant_id, application_id, spend_item_id)',
  'applications applications_tenant_id_id_key UNIQUE (tenant_id, id) [marked]',
  'capex_items capex_items_tenant_id_id_key UNIQUE (tenant_id, id) [marked]',
  'spend_items spend_items_tenant_id_id_key UNIQUE (tenant_id, id) [marked]',
];

const OLD_KEYS = [
  'application_capex_items fk_app_capex_app FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE',
  'application_capex_items fk_app_capex_item FOREIGN KEY (capex_item_id) REFERENCES capex_items(id) ON DELETE CASCADE',
  'application_spend_items fk_app_spend_app FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE',
  'application_spend_items fk_app_spend_item FOREIGN KEY (spend_item_id) REFERENCES spend_items(id) ON DELETE CASCADE',
  'application_spend_items uq_app_spend UNIQUE (tenant_id, application_id, spend_item_id)',
];

async function assertRlsForced(runner: QueryRunner) {
  const rows: Array<{ relname: string; on: boolean; forced: boolean }> = await runner.query(
    `SELECT relname, relrowsecurity AS on, relforcerowsecurity AS forced FROM pg_class WHERE relname = ANY($1::text[]) ORDER BY relname`,
    [RLS_TABLES],
  );
  assert.equal(rows.length, RLS_TABLES.length);
  for (const row of rows) assert.ok(row.on && row.forced, `RLS enabled and forced on ${row.relname}`);
}

async function tenantIdNotNull(runner: QueryRunner, table: string): Promise<boolean> {
  const [row] = await runner.query(
    `SELECT attnotnull AS notnull FROM pg_attribute WHERE attrelid = $1::regclass AND attname = 'tenant_id'`,
    [table],
  );
  return row.notnull;
}

type Link = { id: string; tenant_id: string | null; created_at: string };

/** Inserts links as given, RLS off on the link tables (as a damaged database would hold them). */
async function insertLink(
  runner: QueryRunner,
  table: (typeof LINK_TABLES)[number],
  tenantId: string | null,
  applicationId: string,
  itemId: string,
  createdAt: string,
  id: string = randomUUID(),
): Promise<string> {
  const itemFk = table === 'application_capex_items' ? 'capex_item_id' : 'spend_item_id';
  await runner.query(
    `INSERT INTO ${table} (id, tenant_id, application_id, ${itemFk}, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [id, tenantId, applicationId, itemId, createdAt],
  );
  return id;
}

/** The given links still stored, read through RLS under each of the two tenants. */
async function readLinks(runner: QueryRunner, w: World, table: string, ids: string[]): Promise<Map<string, Link>> {
  const rows: Link[] = [];
  for (const tenantId of [w.tenantA, w.tenantB]) {
    await setTenant(runner, tenantId);
    rows.push(...(await runner.query(`SELECT id, tenant_id, created_at::text FROM ${table} WHERE id = ANY($1::uuid[])`, [ids])));
  }
  rows.sort((a, b) => (a.id < b.id ? -1 : 1));
  return new Map(rows.map((r) => [r.id, r]));
}

/** The old schema (down()), nullable tenant_id and RLS off on the link tables, then a damaged set of links. */
async function seedDirtyState(runner: QueryRunner, w: World) {
  await migration.down(runner);
  for (const table of LINK_TABLES) {
    await runner.query(`ALTER TABLE ${table} ALTER COLUMN tenant_id DROP NOT NULL`);
    await runner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
  }
  const t0 = '2026-01-01T00:00:00Z';
  const t1 = '2026-02-01T00:00:00Z';
  const [tieKept, tieLost] = [randomUUID(), randomUUID()].sort();
  const C = 'application_capex_items' as const;
  const S = 'application_spend_items' as const;
  const capex = {
    kept: await insertLink(runner, C, w.tenantA, w.appA1, w.capexA1, t0),
    dup1: await insertLink(runner, C, w.tenantA, w.appA1, w.capexA1, t1),
    dup2: await insertLink(runner, C, w.tenantA, w.appA1, w.capexA1, t1),
    // Same created_at: the smaller id is kept.
    tieKept: await insertLink(runner, C, w.tenantA, w.appA2, w.capexA1, t0, tieKept),
    tieLost: await insertLink(runner, C, w.tenantA, w.appA2, w.capexA1, t0, tieLost),
    crossItem: await insertLink(runner, C, w.tenantA, w.appA1, w.capexB1, t0),
    crossApp: await insertLink(runner, C, w.tenantB, w.appA1, w.capexB1, t0),
    nullFilled: await insertLink(runner, C, null, w.appB1, w.capexB1, t0),
    nullDeleted: await insertLink(runner, C, null, w.appA1, w.capexB1, t0),
  };
  const spend = {
    // Without tenant and the earliest: kept, given tenant A, its later twin goes first.
    nullKept: await insertLink(runner, S, null, w.appA1, w.spendA1, t0),
    dup: await insertLink(runner, S, w.tenantA, w.appA1, w.spendA1, t1),
    crossApp: await insertLink(runner, S, w.tenantA, w.appB1, w.spendB1, t0),
    kept: await insertLink(runner, S, w.tenantB, w.appB1, w.spendB1, t0),
  };
  return { capex, spend };
}

function repairCounts(lines: string[], table: string) {
  const line = lines.find((l) => l.startsWith(`${LOG_PREFIX} ${table}:`));
  assert.ok(line, `a repair line for ${table}`);
  const match = line!.match(
    /: (\d+) link\(s\) to a missing application or line deleted, (\d+) duplicate link\(s\) deleted, (\d+) link\(s\) to another tenant's application or line deleted, (\d+) link\(s\) without tenant given their application's tenant, (\d+) link\(s\) without tenant deleted/,
  );
  assert.ok(match, `readable repair line: ${line}`);
  const [, orphans, duplicates, crossTenant, filled, nullDeleted] = match!.map(Number);
  return { orphans, duplicates, crossTenant, filled, nullDeleted };
}

/** The detail line naming a deleted link, if any. */
function detailLine(lines: string[], kind: string, linkId: string) {
  return lines.find((l) => l.startsWith(`  ${kind}: deleted link ${linkId}`));
}

/** up() on a damaged state keeps the right links, logs the counts and adds the keys. */
async function testRepairsDirtyState() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const seeded = await seedDirtyState(runner, w);

    const lines = await captureLogs(() => migration.up(runner));
    assert.equal(lines.filter((l) => l.startsWith(LOG_PREFIX)).length, 2, `one summary line per table: ${lines.join(' | ')}`);
    assert.deepEqual(repairCounts(lines, 'application_capex_items'), { orphans: 0, duplicates: 3, crossTenant: 2, filled: 1, nullDeleted: 1 });
    assert.deepEqual(repairCounts(lines, 'application_spend_items'), { orphans: 0, duplicates: 1, crossTenant: 1, filled: 1, nullDeleted: 0 });
    // Links between tenants are named with their tenants; duplicates and filled links are counted only.
    assert.equal(lines.length, 2 + 3 + 1, `two summary lines and four detail lines: ${lines.join(' | ')}`);
    assert.equal(
      detailLine(lines, 'another tenant', seeded.capex.crossItem),
      `  another tenant: deleted link ${seeded.capex.crossItem} (tenant ${w.tenantA}): application ${w.appA1} (tenant ${w.tenantA}), line ${w.capexB1} (tenant ${w.tenantB})`,
    );
    assert.ok(detailLine(lines, 'another tenant', seeded.capex.crossApp), 'the second cross-tenant CAPEX link is named');
    assert.ok(detailLine(lines, 'another tenant', seeded.spend.crossApp), 'the cross-tenant OPEX link is named');
    assert.equal(
      detailLine(lines, 'without tenant', seeded.capex.nullDeleted),
      `  without tenant: deleted link ${seeded.capex.nullDeleted}: application ${w.appA1} (tenant ${w.tenantA}), line ${w.capexB1} (tenant ${w.tenantB})`,
    );

    const capex = await readLinks(runner, w, 'application_capex_items', Object.values(seeded.capex));
    assert.deepEqual([...capex.keys()].sort(), [seeded.capex.kept, seeded.capex.tieKept, seeded.capex.nullFilled].sort());
    assert.equal(capex.get(seeded.capex.kept)!.tenant_id, w.tenantA);
    assert.equal(capex.get(seeded.capex.nullFilled)!.tenant_id, w.tenantB, 'a link without tenant takes its application\'s');

    const spend = await readLinks(runner, w, 'application_spend_items', Object.values(seeded.spend));
    assert.deepEqual([...spend.keys()].sort(), [seeded.spend.nullKept, seeded.spend.kept].sort());
    assert.equal(spend.get(seeded.spend.nullKept)!.tenant_id, w.tenantA, 'the earliest link is kept and given its tenant');

    assert.deepEqual(await keys(runner), NEW_KEYS);
    for (const table of LINK_TABLES) assert.equal(await tenantIdNotNull(runner, table), true, `${table}.tenant_id NOT NULL`);
    await assertRlsForced(runner);
  });
}

/** A second up() repairs, creates and logs nothing. */
async function testSecondRunChangesNothing() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    const seeded = await seedDirtyState(runner, w);
    await captureLogs(() => migration.up(runner));
    const ids = { capex: Object.values(seeded.capex), spend: Object.values(seeded.spend) };
    const before = {
      keys: await keys(runner),
      capex: [...(await readLinks(runner, w, 'application_capex_items', ids.capex)).values()],
      spend: [...(await readLinks(runner, w, 'application_spend_items', ids.spend)).values()],
    };

    const lines = await captureLogs(() => migration.up(runner));
    assert.deepEqual(lines, [], 'nothing logged');
    assert.deepEqual(await keys(runner), before.keys);
    assert.deepEqual([...(await readLinks(runner, w, 'application_capex_items', ids.capex)).values()], before.capex);
    assert.deepEqual([...(await readLinks(runner, w, 'application_spend_items', ids.spend)).values()], before.spend);
    await assertRlsForced(runner);
  });
}

async function expectCode(runner: QueryRunner, sql: string, params: unknown[], code: string, constraint: string) {
  await runner.query('SAVEPOINT bad_link');
  try {
    await assert.rejects(runner.query(sql, params), (err: any) => {
      assert.equal(err?.code, code, `${constraint}: ${err?.message}`);
      assert.equal(err?.constraint, constraint);
      return true;
    });
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT bad_link');
  }
}

/** Under the tenant's own RLS context, a link to another tenant's row or a second copy of a link fails; deletes still cascade. */
async function testNewKeysRefuseBadLinks() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    await setTenant(runner, w.tenantA);
    const capexSql = `INSERT INTO application_capex_items (tenant_id, application_id, capex_item_id) VALUES ($1, $2, $3)`;
    const spendSql = `INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $3)`;

    await expectCode(runner, capexSql, [w.tenantA, w.appA1, w.capexB1], '23503', 'application_capex_items_capex_item_fk');
    await expectCode(runner, capexSql, [w.tenantA, w.appB1, w.capexA1], '23503', 'application_capex_items_application_fk');
    await expectCode(runner, spendSql, [w.tenantA, w.appA1, w.spendB1], '23503', 'application_spend_items_spend_item_fk');
    await expectCode(runner, spendSql, [w.tenantA, w.appB1, w.spendA1], '23503', 'application_spend_items_application_fk');

    await runner.query(capexSql, [w.tenantA, w.appA1, w.capexA1]);
    await expectCode(runner, capexSql, [w.tenantA, w.appA1, w.capexA1], '23505', 'uq_app_capex');
    await runner.query(spendSql, [w.tenantA, w.appA1, w.spendA1]);
    await expectCode(runner, spendSql, [w.tenantA, w.appA1, w.spendA1], '23505', 'uq_app_spend');

    // ON DELETE CASCADE is kept: a deleted line or application takes its links along.
    await runner.query(`DELETE FROM capex_items WHERE id = $1`, [w.capexA1]);
    const [{ n: capexLeft }] = await runner.query(`SELECT count(*)::int AS n FROM application_capex_items WHERE application_id = $1`, [w.appA1]);
    assert.equal(capexLeft, 0);
    await runner.query(`DELETE FROM applications WHERE id = $1`, [w.appA1]);
    const [{ n: spendLeft }] = await runner.query(`SELECT count(*)::int AS n FROM application_spend_items WHERE spend_item_id = $1`, [w.spendA1]);
    assert.equal(spendLeft, 0);
  });
}

/** down() restores the single-column keys and drops only the unique keys up() created. */
async function testDownRestoresOldKeys() {
  await inRolledBackTransaction(async (runner) => {
    await migration.down(runner);
    assert.deepEqual(await keys(runner), OLD_KEYS);

    // A (tenant_id, id) key that existed before the migration is reused by up() and survives down().
    await runner.query(`ALTER TABLE spend_items ADD CONSTRAINT spend_items_tenant_id_id_key UNIQUE (tenant_id, id)`);
    await captureLogs(() => migration.up(runner));
    assert.ok((await keys(runner)).includes('spend_items spend_items_tenant_id_id_key UNIQUE (tenant_id, id)'), 'not marked');
    await migration.down(runner);
    assert.deepEqual(await keys(runner), [...OLD_KEYS, 'spend_items spend_items_tenant_id_id_key UNIQUE (tenant_id, id)']);
    await assertRlsForced(runner);
  });
}

/**
 * A link whose line or application does not exist (a tenant import runs with
 * the key triggers off) is deleted, counted and named; the keys are created.
 */
async function testOrphanLinksAreDeleted() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    await migration.down(runner);
    await runner.query(`ALTER TABLE application_capex_items DROP CONSTRAINT fk_app_capex_item`);
    await runner.query(`ALTER TABLE application_spend_items DROP CONSTRAINT fk_app_spend_app`);
    for (const table of LINK_TABLES) await runner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    const t0 = '2026-01-01T00:00:00Z';
    const missingLine = randomUUID();
    const missingApp = randomUUID();
    const capexOrphan = await insertLink(runner, 'application_capex_items', w.tenantA, w.appA1, missingLine, t0);
    const spendOrphan = await insertLink(runner, 'application_spend_items', w.tenantA, missingApp, w.spendA1, t0);
    const capexKept = await insertLink(runner, 'application_capex_items', w.tenantA, w.appA1, w.capexA1, t0);

    const lines = await captureLogs(() => migration.up(runner));
    assert.deepEqual(repairCounts(lines, 'application_capex_items'), { orphans: 1, duplicates: 0, crossTenant: 0, filled: 0, nullDeleted: 0 });
    assert.deepEqual(repairCounts(lines, 'application_spend_items'), { orphans: 1, duplicates: 0, crossTenant: 0, filled: 0, nullDeleted: 0 });
    assert.equal(
      detailLine(lines, 'missing application or line', capexOrphan),
      `  missing application or line: deleted link ${capexOrphan} (tenant ${w.tenantA}): application ${w.appA1}, line ${missingLine} (missing)`,
    );
    assert.equal(
      detailLine(lines, 'missing application or line', spendOrphan),
      `  missing application or line: deleted link ${spendOrphan} (tenant ${w.tenantA}): application ${missingApp} (missing), line ${w.spendA1}`,
    );
    assert.equal(lines.length, 4, `two summary lines and two detail lines: ${lines.join(' | ')}`);

    assert.deepEqual([...(await readLinks(runner, w, 'application_capex_items', [capexOrphan, capexKept])).keys()], [capexKept]);
    assert.deepEqual([...(await readLinks(runner, w, 'application_spend_items', [spendOrphan])).keys()], []);
    assert.deepEqual(await keys(runner), NEW_KEYS);
    await assertRlsForced(runner);
  });
}

/**
 * A line without tenant (tenant_id is NOT NULL on every KANAP database, so the
 * column is relaxed here) leaves its links nothing to be checked against: up()
 * stops with a sentence naming them.
 */
async function testParentWithoutTenantStops() {
  await inRolledBackTransaction(async (runner) => {
    const w = await seedWorld(runner);
    await migration.down(runner);
    for (const table of LINK_TABLES) await runner.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`);
    const link = await insertLink(runner, 'application_capex_items', w.tenantA, w.appA1, w.capexA1, '2026-01-01T00:00:00Z');
    // The line's search-index trigger and RLS would refuse a row without tenant.
    await runner.query(`ALTER TABLE capex_items ALTER COLUMN tenant_id DROP NOT NULL`);
    await runner.query(`ALTER TABLE capex_items DISABLE TRIGGER USER`);
    await runner.query(`ALTER TABLE capex_items DISABLE ROW LEVEL SECURITY`);
    await runner.query(`UPDATE capex_items SET tenant_id = NULL WHERE id = $1`, [w.capexA1]);

    await assert.rejects(migration.up(runner), (err: Error) => {
      assert.match(err.message, /1 row\(s\) of application_capex_items link an application or a line that has no tenant/);
      assert.ok(err.message.includes(link), 'names the link');
      assert.match(err.message, /Give these applications and lines their tenant, then run the migrations again\./);
      return true;
    });
  });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [
      testRepairsDirtyState,
      testSecondRunChangesNothing,
      testNewKeysRefuseBadLinks,
      testDownRestoresOldKeys,
      testOrphanLinksAreDeleted,
      testParentWithoutTenantStops,
    ]) {
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
    throw new Error(`application-item-links-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('application-item-links-migration.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
