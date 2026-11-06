import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { BusinessProcessTypeSearchLabels1856180000000 } from '../../migrations/1856180000000-business-process-type-search-labels';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Migration 1856180000000 against a real database, in a transaction that is rolled back: from the
// search entry of 1856170000000 (its down()), which holds the code of the type only, up() adds the
// label of the type in en, fr, de and es; a second up() changes nothing; the function stays
// SECURITY DEFINER with its search_path pinned.

const migration = new BusinessProcessTypeSearchLabels1856180000000();

async function found(runner: QueryRunner, tenantId: string, processId: string, query: string): Promise<boolean> {
  const [row] = await runner.query(
    `SELECT COALESCE(bool_or(search_vector @@ (plainto_tsquery('kanap_fr', $3) || plainto_tsquery('kanap_en', $3))), false) AS hit
       FROM search_index
      WHERE tenant_id = $1 AND entity_type = 'business_processes' AND entity_id = $2`,
    [tenantId, processId, query],
  );
  return row.hit === true;
}

async function testTypeLabels() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'bp-type-labels');
    const [core] = await runner.query(
      `INSERT INTO business_processes (name, process_type) VALUES ('Order to cash', 'core') RETURNING id`,
    );
    const [support] = await runner.query(
      `INSERT INTO business_processes (name, process_type) VALUES ('Payroll', 'support') RETURNING id`,
    );

    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    await migration.down(runner);
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    assert.equal(await found(runner, tenantId, core.id, 'core'), true, 'before: found by its code');
    assert.equal(await found(runner, tenantId, core.id, 'Réalisation'), false, 'before: not found by its label');

    await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
    await migration.up(runner);
    await migration.up(runner);
    const [setting] = await runner.query(`SELECT current_setting('app.current_tenant', true) AS value`);
    assert.equal(setting.value, '', 'the tenant setting is restored');
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

    for (const query of ['core', 'Core', 'Réalisation', 'realisation', 'Kernprozess', 'Operativo']) {
      assert.equal(await found(runner, tenantId, core.id, query), true, `core process found by "${query}"`);
    }
    for (const query of ['support', 'Unterstützungsprozess', 'Apoyo']) {
      assert.equal(await found(runner, tenantId, support.id, query), true, `support process found by "${query}"`);
    }
    assert.equal(await found(runner, tenantId, support.id, 'Réalisation'), false, 'a support process is not core');

    // A later change of type refreshes the entry through the trigger with the new body.
    await runner.query(`UPDATE business_processes SET process_type = 'management' WHERE id = $1`, [support.id]);
    assert.equal(await found(runner, tenantId, support.id, 'Pilotage'), true, 'found by its new type');
    assert.equal(await found(runner, tenantId, support.id, 'Apoyo'), false, 'no longer found by its old type');

    const [fn] = await runner.query(
      `SELECT p.prosecdef, p.proconfig FROM pg_proc p WHERE p.proname = 'search_index_refresh_business_processes'`,
    );
    assert.equal(fn.prosecdef, true, 'SECURITY DEFINER');
    assert.deepEqual(fn.proconfig, ['search_path=public, pg_temp']);
  });
}

void runSpecs('business-process-type-search-labels-migration.integration.spec', [
  ['testTypeLabels', testTypeLabels],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
