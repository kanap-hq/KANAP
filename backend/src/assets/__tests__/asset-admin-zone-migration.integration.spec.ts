// @database-spec
import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { AssetAdminZone1854340000000 as Migration } from '../../migrations/1854340000000-asset-admin-zone';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Migration 1854340000000 (`assets.admin_zone`), against a real database, in transactions
// rolled back at the end:
// - as migrated: text, nullable, no default; a second up() changes nothing and keeps the values;
// - dirty database: the column already there as varchar NOT NULL DEFAULT '' with blank and real
//   values; up() brings it to text, nullable, no default, turns the blanks into NULL per tenant
//   (the search index trigger writes under the tenant policy) and keeps the codes.

const migration = new Migration();

async function column(runner: QueryRunner) {
  const rows: Array<{ data_type: string; is_nullable: string; column_default: string | null }> = await runner.query(
    `SELECT data_type, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'assets' AND column_name = 'admin_zone'`,
  );
  return rows[0] ?? null;
}

async function asset(runner: QueryRunner, tenantId: string, name: string) {
  const [{ id }] = await runner.query(
    `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, $2, 'vm', 'prod') RETURNING id`,
    [tenantId, name],
  );
  return id as string;
}

const EXPECTED = { data_type: 'text', is_nullable: 'YES', column_default: null };

async function testMigratedAndRerun() {
  await inRolledBackTransaction(async (runner) => {
    assert.deepEqual(await column(runner), EXPECTED);
    const tenantId = await seedTenant(runner, 'adz-asset-rerun');
    const id = await asset(runner, tenantId, 'dc1');
    await runner.query(`UPDATE assets SET admin_zone = 'tier_0' WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    await migration.up(runner);
    await setTenant(runner, tenantId);
    assert.deepEqual(await column(runner), EXPECTED);
    const [{ admin_zone }] = await runner.query(`SELECT admin_zone FROM assets WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);
    assert.equal(admin_zone, 'tier_0');
  });
}

async function testDirtyDatabase() {
  await inRolledBackTransaction(async (runner) => {
    await runner.query(`ALTER TABLE assets DROP COLUMN admin_zone`);
    await runner.query(`ALTER TABLE assets ADD COLUMN admin_zone varchar(20) NOT NULL DEFAULT ''`);
    const a = await seedTenant(runner, 'adz-asset-dirty-a');
    const blank = await asset(runner, a, 'Blank');
    const spaces = await asset(runner, a, 'Spaces');
    const placed = await asset(runner, a, 'Placed');
    await runner.query(`UPDATE assets SET admin_zone = '   ' WHERE tenant_id = $1 AND id = $2`, [a, spaces]);
    await runner.query(`UPDATE assets SET admin_zone = 'tier_1' WHERE tenant_id = $1 AND id = $2`, [a, placed]);
    const b = await seedTenant(runner, 'adz-asset-dirty-b');
    const other = await asset(runner, b, 'Other blank');

    await migration.up(runner);
    assert.deepEqual(await column(runner), EXPECTED);
    await setTenant(runner, a);
    const rows: Array<{ id: string; admin_zone: string | null }> = await runner.query(`SELECT id, admin_zone FROM assets WHERE tenant_id = $1`, [a]);
    const zoneOf = new Map(rows.map((row) => [row.id, row.admin_zone]));
    assert.deepEqual([zoneOf.get(blank), zoneOf.get(spaces), zoneOf.get(placed)], [null, null, 'tier_1']);
    await setTenant(runner, b);
    const [{ admin_zone }] = await runner.query(`SELECT admin_zone FROM assets WHERE tenant_id = $1 AND id = $2`, [b, other]);
    assert.equal(admin_zone, null, 'every tenant is repaired');

    await migration.up(runner);
    assert.deepEqual(await column(runner), EXPECTED, 'rerun on the repaired database');
  });
}

void runSpecs('Asset admin zone migration', [
  ['as migrated, rerun', testMigratedAndRerun],
  ['dirty database: column present with another shape and blank values', testDirtyDatabase],
]);
