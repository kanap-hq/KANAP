import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { BusinessProcessTypeAndParent1856170000000 } from '../../migrations/1856170000000-business-process-type-and-parent';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Migration 1856170000000 (26.11 H1) against a real database, in a transaction that is rolled
// back: from the schema before it (its down()), with categories, links and a search entry that
// reads a category, up() adds the type and the parent, drops the categories and refreshes the
// search entry; a second up() changes nothing; the keys refuse a process under itself and a
// parent of another tenant.

const migration = new BusinessProcessTypeAndParent1856170000000();

async function columns(runner: QueryRunner): Promise<string[]> {
  const rows = await runner.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'business_processes' AND column_name IN ('process_type', 'parent_id') ORDER BY 1`,
  );
  return rows.map((row: any) => row.column_name);
}

async function tables(runner: QueryRunner): Promise<string[]> {
  const rows = await runner.query(
    `SELECT relname FROM pg_class WHERE relname IN ('business_process_categories', 'business_process_category_links') ORDER BY 1`,
  );
  return rows.map((row: any) => row.relname);
}

async function refused(runner: QueryRunner, sql: string, params: unknown[], pattern: RegExp) {
  await runner.query('SAVEPOINT refused');
  try {
    await runner.query(sql, params);
    assert.fail(`expected a refusal: ${sql}`);
  } catch (error: any) {
    assert.match(String(error?.message), pattern);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT refused');
  }
}

async function testFromCategories() {
  await inRolledBackTransaction(async (runner) => {
    await migration.down(runner);
    assert.deepEqual(await columns(runner), [], 'down() removes the columns');
    assert.deepEqual(await tables(runner), ['business_process_categories', 'business_process_category_links']);

    const tenantId = await seedTenant(runner, 'bp-migration');
    const [category] = await runner.query(`INSERT INTO business_process_categories (name) VALUES ('Finance') RETURNING id`);
    const [process] = await runner.query(`INSERT INTO business_processes (name) VALUES ('Record to report') RETURNING id`);
    await runner.query(`INSERT INTO business_process_category_links (process_id, category_id) VALUES ($1, $2)`, [process.id, category.id]);
    await runner.query(
      `INSERT INTO search_index (tenant_id, entity_type, entity_id, label, summary, extra_json, search_vector)
       VALUES ($1, 'business_processes', $2, 'Record to report', 'Finance', '{"primary_category": "Finance"}', to_tsvector('Finance'))
       ON CONFLICT (tenant_id, entity_type, entity_id) DO UPDATE SET summary = 'Finance', extra_json = '{"primary_category": "Finance"}'`,
      [tenantId, process.id],
    );

    // The refresh loop sets each tenant, then gives the next migration of the run the setting it had.
    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    await migration.up(runner);
    await migration.up(runner);
    const [setting] = await runner.query(`SELECT current_setting('app.current_tenant', true) AS value`);
    assert.equal(setting.value, '', 'the tenant setting is restored');
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

    assert.deepEqual(await columns(runner), ['parent_id', 'process_type']);
    assert.deepEqual(await tables(runner), [], 'the categories and their links are gone');
    const [row] = await runner.query(`SELECT name, process_type, parent_id FROM business_processes WHERE id = $1`, [process.id]);
    assert.deepEqual(row, { name: 'Record to report', process_type: null, parent_id: null }, 'no type and no parent');
    const [entry] = await runner.query(
      `SELECT summary, extra_json FROM search_index WHERE tenant_id = $1 AND entity_type = 'business_processes' AND entity_id = $2`,
      [tenantId, process.id],
    );
    assert.deepEqual(entry, { summary: null, extra_json: { process_type: null } }, 'the search entry no longer reads a category');
    const [fn] = await runner.query(
      `SELECT p.prosecdef, p.proconfig FROM pg_proc p WHERE p.proname = 'search_index_refresh_business_processes'`,
    );
    assert.equal(fn.prosecdef, true, 'SECURITY DEFINER');
    assert.deepEqual(fn.proconfig, ['search_path=public, pg_temp']);
    const [linkFn] = await runner.query(
      `SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'search_index_sync_link_business_process_category_links'`,
    );
    assert.equal(linkFn.n, 0, 'the trigger function of the links is gone');

    // The keys: a type outside the three, a process under itself, a parent of another tenant.
    await refused(runner, `UPDATE business_processes SET process_type = 'operations' WHERE id = $1`, [process.id], /business_processes_process_type_check/);
    await refused(runner, `UPDATE business_processes SET parent_id = id WHERE id = $1`, [process.id], /business_processes_not_own_parent_check/);
    const otherTenant = await seedTenant(runner, 'bp-migration-other');
    const [foreign] = await runner.query(`INSERT INTO business_processes (name) VALUES ('Elsewhere') RETURNING id`);
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await refused(runner, `UPDATE business_processes SET parent_id = $2 WHERE id = $1`, [process.id, foreign.id], /business_processes_parent_fk/);
    void otherTenant;

    // A parent with a child cannot go (NO ACTION); the child under it is kept.
    const [child] = await runner.query(`INSERT INTO business_processes (name, parent_id, process_type) VALUES ('Close', $1, 'support') RETURNING id`, [process.id]);
    await refused(runner, `DELETE FROM business_processes WHERE id = $1`, [process.id], /business_processes_parent_fk/);
    assert.ok(child.id);
  });
}

void runSpecs('business-process-type-and-parent-migration.integration.spec', [
  ['testFromCategories', testFromCategories],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
