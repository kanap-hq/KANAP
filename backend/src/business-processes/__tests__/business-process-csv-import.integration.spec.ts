import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { BusinessProcessesService } from '../business-processes.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The business process CSV import, against a real database, each test in a transaction that
// is rolled back: a row identical to the stored process, its categories included, counts as
// unchanged and writes nothing, in the dry run and the load alike. A category the file names
// that does not exist yet, or a different set of categories, makes the row an update.

const HEADER = 'name;categories;description;notes;status';
const STAMP = '2020-01-01T00:00:00Z';

function service() {
  return new BusinessProcessesService(undefined as any, undefined as any, undefined as any, undefined as any, new AuditService(undefined as any));
}

function file(lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from(lines.join('\n') + '\n', 'utf8') } as Express.Multer.File;
}

async function seedProcess(runner: QueryRunner, values: Record<string, unknown>, categoryIds: string[] = []): Promise<string> {
  const columns = Object.keys(values);
  const [row] = await runner.query(
    `INSERT INTO business_processes (${columns.join(', ')}, updated_at) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}, '${STAMP}') RETURNING id`,
    Object.values(values),
  );
  for (const categoryId of categoryIds) {
    await runner.query(`INSERT INTO business_process_category_links (process_id, category_id) VALUES ($1, $2)`, [row.id, categoryId]);
  }
  return row.id;
}

async function seedCategory(runner: QueryRunner, name: string): Promise<string> {
  const [row] = await runner.query(`INSERT INTO business_process_categories (name) VALUES ($1) RETURNING id`, [name]);
  return row.id;
}

async function testIdenticalRowsUnchanged() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'bp-csv');
    const finance = await seedCategory(runner, 'Finance');
    const sales = await seedCategory(runner, 'Sales');
    const keptId = await seedProcess(runner, { name: 'Order to cash', description: 'From order to payment', notes: 'Kept' }, [finance, sales]);
    const retiredId = await seedProcess(runner, { name: 'Legacy billing', status: 'disabled', disabled_at: '2021-06-30T00:00:00Z' });
    const changedId = await seedProcess(runner, { name: 'Procure to pay', description: 'Old text' }, [finance]);
    const newCategoryId = await seedProcess(runner, { name: 'Hire to retire' }, [finance]);
    const lessCategoriesId = await seedProcess(runner, { name: 'Record to report' }, [finance, sales]);
    const svc = service();
    const opts = { manager: runner.manager };
    const upload = file([
      HEADER,
      // Categories in another order and case: still the stored links.
      'Order to cash;"sales;Finance";From order to payment;Kept;enabled',
      'Legacy billing;;;;disabled',
      'Procure to pay;Finance;New text;;enabled',
      'Hire to retire;"Finance;People";;;enabled',
      'Record to report;Finance;;;enabled',
    ]);

    const check: any = await svc.importCsv({ file: upload, dryRun: true }, opts);
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual([check.inserted, check.updated, check.unchanged], [0, 3, 2], 'dry run');

    const load: any = await svc.importCsv({ file: upload, dryRun: false }, opts);
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    assert.deepEqual([load.inserted, load.updated, load.unchanged], [0, 3, 2], 'load');

    const audits = await runner.query(
      `SELECT record_id FROM audit_log WHERE tenant_id = $1 AND table_name = 'business_processes'`,
      [tenantId],
    );
    assert.deepEqual(
      audits.map((row: any) => row.record_id).sort(),
      [changedId, newCategoryId, lessCategoriesId].sort(),
      'only the changed processes are written',
    );
    const stamps = await runner.query(
      `SELECT id FROM business_processes WHERE tenant_id = $1 AND updated_at = '${STAMP}'::timestamptz`,
      [tenantId],
    );
    const keptStamps = new Set(stamps.map((row: any) => row.id));
    assert.ok(keptStamps.has(keptId) && keptStamps.has(retiredId), 'the identical processes keep their updated_at');
    const [links] = await runner.query(
      `SELECT count(*)::int AS n FROM business_process_category_links WHERE tenant_id = $1 AND process_id = $2`,
      [tenantId, lessCategoriesId],
    );
    assert.equal(links.n, 1, 'the row with fewer categories drops the other link');

    // The same file again: everything is now stored.
    const again: any = await svc.importCsv({ file: upload, dryRun: true }, opts);
    assert.deepEqual([again.inserted, again.updated, again.unchanged], [0, 0, 5], 'second import');
  });
}

void runSpecs('business-process-csv-import.integration.spec', [
  ['testIdenticalRowsUnchanged', testIdenticalRowsUnchanged],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
