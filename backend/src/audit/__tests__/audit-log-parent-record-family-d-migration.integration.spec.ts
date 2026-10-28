// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLogParentRecordFamilyD1855730000000 as Migration } from '../../migrations/1855730000000-audit-log-parent-record-family-d';

// Migration 1855730000000 (the asset and technology children of family D), against a real
// database, in a transaction rolled back at the end. It seeds two tenants with one audit row per
// payload key (asset_id and technology_id, after and before), rows without a parent (an invalid
// uuid, a missing key, another label, a record-mode child) and an already-parented row, then:
// - each row whose payload names an asset or a technology gets the matching parent, tenant by
//   tenant, in batches smaller than the seed (several statements per tenant);
// - a row without a key, a record-mode child and an already-parented row stay as they were;
// - the counts are logged per label, both partial indexes exist with the history's expression and
//   labels, RLS stays ENABLE + FORCE and no statement of the migration disables or relaxes it; the
//   tenant setting is restored;
// - a second run rewrites no row and says so;
// - down() drops the indexes and clears the family's parents; up() after it restores them.
// @database-spec: the data source of the migrated test database.

const migration = new Migration();
const PREFIX = '[Migration] AuditLogParentRecordFamilyD:';
const ASSET_INDEX = 'idx_audit_log_asset_id_assets';
const TECHNOLOGY_INDEX = 'idx_audit_log_technology_id_technologies';

const ASSET_LABELS = ['asset_hardware_info', 'asset_support_info', 'asset_links', 'asset_attachments', 'asset_technologies'];
const TECHNOLOGY_LABELS = ['technology_links', 'technology_attachments', 'technology_vulnerabilities'];
const ALL_LABELS = [...ASSET_LABELS, ...TECHNOLOGY_LABELS];

async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
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

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function clearTenant(runner: QueryRunner) {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Audit parent family D', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `audit-parent-d-${tag}-${tenantId.slice(0, 8)}`],
  );
  await setTenant(runner, tenantId);
  return tenantId;
}

async function insertAudit(
  runner: QueryRunner,
  tenantId: string,
  table: string,
  recordId: string | null,
  action: string,
  before: unknown,
  after: unknown,
): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, source)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, 'user') RETURNING id`,
    [tenantId, table, recordId, action, before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after)],
  );
  return row.id;
}

async function indexDefinition(runner: QueryRunner, name: string) {
  const [row] = await runner.query(`SELECT indexdef FROM pg_indexes WHERE indexname = $1`, [name]);
  return row?.indexdef ?? null;
}

async function rowSecurity(runner: QueryRunner, table: string) {
  const [row] = await runner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = $1::regclass`,
    [table],
  );
  return row;
}

async function rowsOf(runner: QueryRunner, tenantId: string) {
  await setTenant(runner, tenantId);
  return runner.query(
    `SELECT id, table_name, parent_table, parent_id, ctid::text AS ctid
       FROM audit_log WHERE tenant_id = $1 AND table_name = ANY($2::text[]) ORDER BY id`,
    [tenantId, [...ALL_LABELS, 'assets', 'technology_versions']],
  );
}

type Seed = {
  assetId: string;
  technologyId: string;
  filled: Record<string, string>;
  kept: Record<string, string>;
};

async function seedRows(runner: QueryRunner, tenantId: string): Promise<Seed> {
  // The parent rows exist: the backfill only sets a parent that is in the same tenant.
  const [asset] = await runner.query(
    `INSERT INTO assets (tenant_id, name, asset_reference, kind, environment) VALUES ($1, 'Server One', 'AST-1', 'server', 'prod') RETURNING id`,
    [tenantId],
  );
  const [technology] = await runner.query(
    `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 9, 'Postgres', 'database') RETURNING id`,
    [tenantId],
  );
  const assetId = asset.id as string;
  const technologyId = technology.id as string;
  const filled: Record<string, string> = {};
  const kept: Record<string, string> = {};

  filled.hardware = await insertAudit(runner, tenantId, 'asset_hardware_info', randomUUID(), 'create', null, { asset_id: assetId, serial_number: 'SN-1' });
  filled.support = await insertAudit(runner, tenantId, 'asset_support_info', randomUUID(), 'update', { asset_id: assetId, support_tier: 'gold' }, { asset_id: assetId, support_tier: 'platinum' });
  filled.assetLink = await insertAudit(runner, tenantId, 'asset_links', randomUUID(), 'delete', { asset_id: assetId, url: 'https://example.invalid' }, null);
  filled.attachment = await insertAudit(runner, tenantId, 'asset_attachments', randomUUID(), 'create', null, { asset_id: assetId, original_filename: 'note.txt' });
  filled.installed = await insertAudit(runner, tenantId, 'asset_technologies', technologyId, 'create', null, { asset_id: assetId, technology_id: technologyId, is_operating_system: true });
  filled.technologyLink = await insertAudit(runner, tenantId, 'technology_links', randomUUID(), 'create', null, { technology_id: technologyId, url: 'https://example.invalid' });
  filled.technologyAttachment = await insertAudit(runner, tenantId, 'technology_attachments', randomUUID(), 'delete', { technology_id: technologyId, original_filename: 'old.txt' }, null);
  filled.vulnerability = await insertAudit(runner, tenantId, 'technology_vulnerabilities', randomUUID(), 'update', { technology_id: technologyId, cve_id: 'CVE-2026-1234', state: 'to_review' }, { technology_id: technologyId, cve_id: 'CVE-2026-1234', state: 'handled' });

  kept.invalid = await insertAudit(runner, tenantId, 'asset_links', randomUUID(), 'create', null, { asset_id: 'not-a-uuid' });
  // A well-formed id absent from the assets table: no parent.
  kept.missingParent = await insertAudit(runner, tenantId, 'asset_links', randomUUID(), 'create', null, { asset_id: randomUUID() });
  kept.noKey = await insertAudit(runner, tenantId, 'asset_support_info', randomUUID(), 'update', {}, {});
  kept.otherLabel = await insertAudit(runner, tenantId, 'assets', randomUUID(), 'update', { name: 'before' }, { name: 'after' });
  kept.recordMode = await insertAudit(runner, tenantId, 'technology_versions', technologyId, 'update', { label: '2.0' }, { label: '2.1' });
  // Already parented by an earlier family: the migration must not choose another parent.
  kept.alreadyParented = await insertAudit(runner, tenantId, 'asset_links', randomUUID(), 'update', { asset_id: assetId }, null);
  await runner.query(`UPDATE audit_log SET parent_table = 'cost_centers', parent_id = $2 WHERE id = $1`, [kept.alreadyParented, randomUUID()]);
  // A row outside the family: down() must leave its parent alone.
  kept.outsideFamily = await insertAudit(runner, tenantId, 'assets', randomUUID(), 'update', { name: 'before' }, { name: 'after' });
  await runner.query(`UPDATE audit_log SET parent_table = 'cost_centers', parent_id = $2 WHERE id = $1`, [kept.outsideFamily, randomUUID()]);
  return { assetId, technologyId, filled, kept };
}

async function currentTenantSetting(runner: QueryRunner): Promise<string> {
  const [row] = await runner.query(`SELECT coalesce(current_setting('app.current_tenant', true), '') AS value`);
  return row.value;
}

function recordStatements(runner: QueryRunner): { statements: string[]; stop: () => void } {
  const statements: string[] = [];
  const original = runner.query.bind(runner);
  (runner as any).query = (sql: string, ...rest: unknown[]) => {
    statements.push(sql);
    return (original as any)(sql, ...rest);
  };
  return { statements, stop: () => { (runner as any).query = original; } };
}

async function testBackfillRerunAndDown() {
  await inRolledBackTransaction(async (runner) => {
    await runner.query(`DROP INDEX IF EXISTS ${ASSET_INDEX}`);
    await runner.query(`DROP INDEX IF EXISTS ${TECHNOLOGY_INDEX}`);

    const otherTenant = await seedTenant(runner, 'other');
    const otherSeed = await seedRows(runner, otherTenant);
    const tenantId = await seedTenant(runner, 'main');
    const seed = await seedRows(runner, tenantId);
    await clearTenant(runner);

    // Batches of 3 rows: each tenant's 9-10 rows take several statements.
    migration.batchSize = 3;
    const recorded = recordStatements(runner);
    let first;
    try {
      first = await captureLog(() => migration.up(runner));
    } finally {
      recorded.stop();
      migration.batchSize = 50000;
    }
    const firstLog = first.lines.join('\n');
    const statements = recorded.statements.join('\n');
    assert.doesNotMatch(statements, /ROW LEVEL SECURITY|row_security/i, 'the migration never touches RLS');
    assert.ok(recorded.statements.filter((sql) => /WITH candidates AS/.test(sql)).length >= 2 * 4, 'several batches per tenant');
    assert.equal(await currentTenantSetting(runner), '', 'the tenant setting is restored');
    assert.ok(firstLog.includes(PREFIX), firstLog);
    for (const label of ALL_LABELS) assert.ok(firstLog.includes(`  ${label}:`), `logged: ${label}`);

    for (const tenant of [tenantId, otherTenant]) {
      const byId = new Map<string, any>((await rowsOf(runner, tenant)).map((row: any) => [row.id, row]));
      const tenantSeed = tenant === tenantId ? seed : otherSeed;
      for (const [name, id] of Object.entries(tenantSeed.filled)) {
        const row = byId.get(id);
        assert.equal(row.parent_table, name === 'hardware' || name === 'support' || name === 'assetLink' || name === 'attachment' || name === 'installed' ? 'assets' : 'technologies', `${name}: the parent table`);
        assert.equal(row.parent_id, name === 'hardware' || name === 'support' || name === 'assetLink' || name === 'attachment' || name === 'installed' ? tenantSeed.assetId : tenantSeed.technologyId, `${name}: the parent id`);
      }
      for (const [name, id] of Object.entries(tenantSeed.kept)) {
        const row = byId.get(id);
        assert.ok(row, `${name}: the seeded row is returned`);
        if (name === 'alreadyParented' || name === 'outsideFamily') {
          assert.equal(row.parent_table, 'cost_centers', `${name}: the earlier parent stays`);
        } else {
          assert.equal(row.parent_id, null, `${name}: no parent`);
          assert.equal(row.parent_table, null, `${name}: no parent table`);
        }
      }
    }
    const assetIndex = await indexDefinition(runner, ASSET_INDEX);
    const technologyIndex = await indexDefinition(runner, TECHNOLOGY_INDEX);
    assert.ok(assetIndex, 'the asset index exists');
    assert.ok(technologyIndex, 'the technology index exists');
    assert.match(assetIndex, /\(tenant_id, lower\(\(COALESCE\(after_json, before_json\) ->> 'asset_id'::text\)\), created_at DESC, id DESC\)/);
    assert.match(technologyIndex, /\(tenant_id, lower\(\(COALESCE\(after_json, before_json\) ->> 'technology_id'::text\)\), created_at DESC, id DESC\)/);
    for (const label of ASSET_LABELS) assert.ok(assetIndex.includes(`'${label}'`), `asset index names ${label}`);
    for (const label of TECHNOLOGY_LABELS) assert.ok(technologyIndex.includes(`'${label}'`), `technology index names ${label}`);
    for (const table of ['audit_log', 'assets', 'technologies', 'tenants']) {
      const expected = table === 'tenants' ? { enabled: false, forced: false } : { enabled: true, forced: true };
      assert.deepEqual(await rowSecurity(runner, table), expected, `${table}: RLS as found`);
    }

    const afterFirst = await rowsOf(runner, tenantId);
    // A second run rewrites no row.
    const second = await captureLog(() => migration.up(runner));
    const secondLog = second.lines.join('\n');
    assert.ok(secondLog.includes(PREFIX), secondLog);
    const afterSecond = await rowsOf(runner, tenantId);
    assert.deepEqual(
      afterSecond.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      afterFirst.map((row: any) => [row.id, row.ctid, row.parent_table, row.parent_id]),
      'the second run rewrites no row',
    );

    // A real revert has no tenant positioned; down() drops the indexes and clears the family's
    // parents (leaving another family's parent alone); up() restores them.
    await clearTenant(runner);
    await migration.down(runner);
    assert.equal(await currentTenantSetting(runner), '', 'down() restores the tenant setting');
    assert.equal(await indexDefinition(runner, ASSET_INDEX), null, 'down() drops the asset index');
    assert.equal(await indexDefinition(runner, TECHNOLOGY_INDEX), null, 'down() drops the technology index');
    const afterDown = new Map<string, any>((await rowsOf(runner, tenantId)).map((row: any) => [row.id, row]));
    for (const id of Object.values(seed.filled)) assert.equal(afterDown.get(id).parent_id, null, 'down() clears the family parent');
    assert.equal(afterDown.get(seed.kept.alreadyParented).parent_table, 'cost_centers', 'down() leaves another family parent');
    assert.equal(afterDown.get(seed.kept.outsideFamily).parent_table, 'cost_centers', 'down() leaves another family parent');

    await clearTenant(runner);
    await captureLog(() => migration.up(runner));
    const afterDownUp = new Map<string, any>((await rowsOf(runner, tenantId)).map((row: any) => [row.id, row]));
    for (const [name, id] of Object.entries(seed.filled)) {
      assert.ok(afterDownUp.get(id).parent_id, `${name}: filled again after down/up`);
    }
  });
}

async function run() {
  await dataSource.initialize();
  try {
    await testBackfillRerunAndDown();
  } finally {
    await dataSource.destroy();
  }
  console.log('audit-log-parent-record-family-d-migration.integration.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
