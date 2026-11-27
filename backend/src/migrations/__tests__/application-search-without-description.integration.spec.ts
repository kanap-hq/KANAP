import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { ApplicationSearchWithoutDescription1856300000000 } from '../1856300000000-application-search-without-description';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { Application } from '../../applications/application.entity';
import { ApplicationsCsvService } from '../../applications/applications-csv.service';
import { ApplicationsListService } from '../../applications/services/applications-list.service';

// Migration 1856300000000 against a real database, in a transaction that is rolled back (decision P14
// of 26.12.1): from the search entries of 1853000000000 (its down()), which carry the description,
// up() leaves it out of every application entry of both tenants; the entries of the other families
// stay as they are; a second up() changes nothing; the function stays SECURITY DEFINER with its
// search_path pinned. An application changed afterwards (its name, then its description by an
// import) has its entry refreshed, still without its description.

const migration = new ApplicationSearchWithoutDescription1856300000000();

type Entry = { summary: string | null; vector: string; label: string };

async function entry(runner: QueryRunner, tenantId: string, type: string, id: string): Promise<Entry> {
  const [row] = await runner.query(
    `SELECT summary, search_vector::text AS vector, label FROM search_index WHERE tenant_id = $1 AND entity_type = $2 AND entity_id = $3`,
    [tenantId, type, id],
  );
  return row;
}

async function found(runner: QueryRunner, tenantId: string, id: string, word: string): Promise<boolean> {
  const [row] = await runner.query(
    `SELECT COALESCE(bool_or(search_vector @@ (plainto_tsquery('kanap_fr', $3) || plainto_tsquery('kanap_en', $3))), false) AS hit
       FROM search_index WHERE tenant_id = $1 AND entity_type = 'applications' AND entity_id = $2`,
    [tenantId, id, word],
  );
  return row.hit === true;
}

async function asTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function migrate(runner: QueryRunner, step: 'up' | 'down') {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
  await migration[step](runner);
  const [setting] = await runner.query(`SELECT current_setting('app.current_tenant', true) AS value`);
  assert.equal(setting.value, '', 'the tenant setting is restored');
}

function csvService(runner: QueryRunner) {
  const manager = runner.manager;
  const audit = new AuditService(manager.getRepository(AuditLog));
  const resolver = new CsvResolverService();
  return new ApplicationsCsvService(
    manager.getRepository(Application), null as any, null as any,
    new CsvExportService(resolver), new CsvImportService(resolver, new CsvJsonValidators()), resolver, audit,
    new ApplicationsListService(manager.getRepository(Application)),
    new ItOpsSettingsService(manager.getRepository(Tenant), manager.getRepository(Location), audit),
    // The documents are another spec's (application-description-document): the column follows them.
    { syncTitles: async () => 0, repairSourceSlot: async () => undefined, writeSourceSlotContent: async () => undefined } as any,
  );
}

async function testDescriptionLeavesTheEntries() {
  await inRolledBackTransaction(async (runner) => {
    const seeded: Array<{ tenantId: string; app: string; process: string; word: string }> = [];
    for (const [tag, word] of [['app-search-a', 'zebrafish'], ['app-search-b', 'narwhal']]) {
      const tenantId = await seedTenant(runner, tag);
      const [app] = await runner.query(
        `INSERT INTO applications (tenant_id, name, status, lifecycle, description, editor)
         VALUES ($1, 'Ledger', 'enabled', 'active', $2, 'Acme') RETURNING id::text AS id`,
        [tenantId, `Keeps the ${word} accounts`],
      );
      const [process] = await runner.query(
        `INSERT INTO business_processes (name, description) VALUES ('Order to cash', $1) RETURNING id::text AS id`,
        [`The ${word} process`],
      );
      seeded.push({ tenantId, app: app.id, process: process.id, word });
    }

    await migrate(runner, 'down');
    const processes = new Map<string, Entry>();
    for (const s of seeded) {
      await asTenant(runner, s.tenantId);
      assert.equal(await found(runner, s.tenantId, s.app, s.word), true, 'before: found by its description');
      assert.equal((await entry(runner, s.tenantId, 'applications', s.app)).summary, `Keeps the ${s.word} accounts`);
      processes.set(s.process, await entry(runner, s.tenantId, 'business_processes', s.process));
    }

    await migrate(runner, 'up');
    const after = new Map<string, Entry>();
    for (const s of seeded) {
      await asTenant(runner, s.tenantId);
      const app = await entry(runner, s.tenantId, 'applications', s.app);
      assert.equal(app.summary, null, 'the entry carries no description');
      assert.equal(await found(runner, s.tenantId, s.app, s.word), false, 'no longer found by its description');
      assert.equal(await found(runner, s.tenantId, s.app, 'Acme'), true, 'still found by its publisher');
      assert.equal(await found(runner, s.tenantId, s.app, 'Ledger'), true, 'still found by its name');
      assert.deepEqual(await entry(runner, s.tenantId, 'business_processes', s.process), processes.get(s.process), 'another family is untouched');
      after.set(s.app, app);
    }

    await migrate(runner, 'up');
    for (const s of seeded) {
      await asTenant(runner, s.tenantId);
      assert.deepEqual(await entry(runner, s.tenantId, 'applications', s.app), after.get(s.app), 'a second run changes nothing');
    }

    // Changed afterwards: its name, then its description by an import. The entry follows, without it.
    const [first] = seeded;
    await asTenant(runner, first.tenantId);
    await runner.query(`UPDATE applications SET name = 'General ledger' WHERE tenant_id = $1 AND id = $2`, [first.tenantId, first.app]);
    assert.equal((await entry(runner, first.tenantId, 'applications', first.app)).label, 'General ledger', 'a rename refreshes the entry');
    const result = await csvService(runner).import(
      { buffer: Buffer.from(`id;name;description\n${first.app};General ledger;Now about the axolotl\n`), originalname: 'apps.csv' } as Express.Multer.File,
      { dryRun: false, operation: 'update_only' },
      { manager: runner.manager, tenantId: first.tenantId },
    );
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.updated, 1);
    const [{ description }] = await runner.query(`SELECT description FROM applications WHERE tenant_id = $1 AND id = $2`, [first.tenantId, first.app]);
    assert.equal(description, 'Now about the axolotl', 'the import wrote the description');
    const refreshed = await entry(runner, first.tenantId, 'applications', first.app);
    assert.equal(refreshed.summary, null);
    assert.equal(await found(runner, first.tenantId, first.app, 'axolotl'), false, 'the imported description is not in the entry');
    assert.equal(await found(runner, first.tenantId, first.app, 'General'), true, 'the new name is');

    const [fn] = await runner.query(`SELECT p.prosecdef, p.proconfig FROM pg_proc p WHERE p.proname = 'search_index_refresh_applications'`);
    assert.equal(fn.prosecdef, true, 'SECURITY DEFINER');
    assert.deepEqual(fn.proconfig, ['search_path=public, pg_temp']);
  });
}

void runSpecs('application-search-without-description.integration.spec', [
  ['testDescriptionLeavesTheEntries', testDescriptionLeavesTheEntries],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
