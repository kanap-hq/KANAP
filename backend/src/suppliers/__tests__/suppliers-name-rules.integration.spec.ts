import 'dotenv/config';
// @database-spec: opens the data-source through runSpecs, so it runs on a database lane.
import { ConflictException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { SuppliersService } from '../suppliers.service';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
  setTenant,
  underSavepoint,
} from '../../spend/__tests__/round-inputs.fixtures';

// Supplier names are unique per tenant whatever their case: create, rename and
// the CSV import refuse or match "sap" when "SAP" exists, while another tenant
// may still use it. The list sorts names alphabetically, ignoring case and
// accents, and the record navigation (listIds) follows the same order.

function service() {
  return new SuppliersService(undefined as any, captureAudit() as any);
}

async function expectDuplicate(fn: () => Promise<unknown>) {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ConflictException, `expected a 409, got ${String(caught)}`);
  const body = (caught as ConflictException).getResponse() as { code?: string };
  assert.strictEqual(body.code, 'duplicate');
}

async function names(runner: QueryRunner): Promise<string[]> {
  const rows: Array<{ name: string }> = await runner.query(`SELECT name FROM suppliers ORDER BY name`);
  return rows.map((row) => row.name);
}

/** The CSV import file: the template's header line, then the rows. */
async function csvFile(svc: SuppliersService, runner: QueryRunner, rows: string[]) {
  const template = await svc.exportCsv('template', { manager: runner.manager, language: 'en' });
  const header = template.content.replace(/^﻿/, '').split(/\r?\n/)[0];
  return { buffer: Buffer.from([header, ...rows].join('\n'), 'utf8') } as Express.Multer.File;
}

void runSpecs('suppliers name rules', [
  ['create refuses a name another supplier has in another case', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = service();
      await seedTenant(runner, 'supplier-names');
      await svc.create({ name: 'SAP' }, undefined, { manager: runner.manager });
      await underSavepoint(runner, () => expectDuplicate(() => svc.create({ name: 'sap' }, undefined, { manager: runner.manager })));
      await underSavepoint(runner, () => expectDuplicate(() => svc.create({ name: 'SAP' }, undefined, { manager: runner.manager })));
      assert.deepStrictEqual(await names(runner), ['SAP']);
    });
  }],
  ['rename refuses another supplier name in another case, and allows a change of case of its own', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = service();
      await seedTenant(runner, 'supplier-rename');
      const sap = await svc.create({ name: 'SAP' }, undefined, { manager: runner.manager });
      const other = await svc.create({ name: 'Sage' }, undefined, { manager: runner.manager });
      await underSavepoint(runner, () => expectDuplicate(() => svc.update(other.id, { name: 'sap' }, undefined, { manager: runner.manager })));
      await svc.update(sap.id, { name: 'Sap' }, undefined, { manager: runner.manager });
      // Saving other fields with the stored name is never refused.
      await svc.update(other.id, { name: 'Sage', notes: 'Payroll' }, undefined, { manager: runner.manager });
      assert.deepStrictEqual(await names(runner), ['Sage', 'Sap']);
    });
  }],
  ['another tenant may use the name in any case', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = service();
      await seedTenant(runner, 'supplier-names-a');
      await svc.create({ name: 'SAP' }, undefined, { manager: runner.manager });
      await seedTenant(runner, 'supplier-names-b');
      await svc.create({ name: 'sap' }, undefined, { manager: runner.manager });
      assert.deepStrictEqual(await names(runner), ['sap']);
    });
  }],
  ['the CSV import matches an existing supplier whatever the case of its name', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = service();
      const tenantId = await seedTenant(runner, 'supplier-import');
      await svc.create({ name: 'SAP', erp_supplier_id: 'SUP-1' }, undefined, { manager: runner.manager });
      const file = await csvFile(svc, runner, ['sap,SUP-1,,,,Updated,enabled']);
      const preview = await svc.importCsv({ file, dryRun: true, language: 'en' }, { manager: runner.manager });
      assert.strictEqual(preview.ok, true, JSON.stringify(preview.errors));
      assert.strictEqual(preview.inserted, 0, 'no new supplier in the preview');
      assert.strictEqual(preview.updated, 1);
      // The preview says which stored supplier the row matched.
      assert.deepStrictEqual(preview.warnings, [{
        row: 2,
        column: 'name',
        message: "'sap' was matched to 'SAP'.",
        code: 'CSV_NAME_MATCHED_CASE',
        params: { name: 'sap', stored: 'SAP' },
      }]);
      await setTenant(runner, tenantId);
      const result = await svc.importCsv({ file, dryRun: false, language: 'en' }, { manager: runner.manager });
      assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
      assert.strictEqual(result.inserted, 0);
      const rows: Array<{ name: string; notes: string }> = await runner.query(`SELECT name, notes FROM suppliers`);
      // The row updates the supplier and keeps its stored spelling.
      assert.deepStrictEqual(rows, [{ name: 'SAP', notes: 'Updated' }], 'one supplier, still named SAP');
      // Imported again, the row is unchanged: the case of the name is not a change.
      const again = await svc.importCsv({ file, dryRun: true, language: 'en' }, { manager: runner.manager });
      assert.strictEqual(again.updated, 0);
      assert.strictEqual(again.unchanged, 1);
    });
  }],
  ['the list sorts names alphabetically, ignoring case and accents, and listIds follows it', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = service();
      await seedTenant(runner, 'supplier-sort');
      for (const name of ['Zeta', 'SAP', 'OVHcloud', 'Élan', 'Sage', 'Okta', 'adobe']) {
        await svc.create({ name }, undefined, { manager: runner.manager });
      }
      const expected = ['adobe', 'Élan', 'Okta', 'OVHcloud', 'Sage', 'SAP', 'Zeta'];
      const asc = await svc.list({ sort: 'name:ASC', limit: 50 }, { manager: runner.manager });
      assert.deepStrictEqual(asc.items.map((s) => s.name), expected);
      assert.strictEqual(asc.total, expected.length);
      const desc = await svc.list({ sort: 'name:DESC', limit: 50 }, { manager: runner.manager });
      assert.deepStrictEqual(desc.items.map((s) => s.name), [...expected].reverse());
      const page2 = await svc.list({ sort: 'name:ASC', limit: 3, page: 2 }, { manager: runner.manager });
      assert.deepStrictEqual(page2.items.map((s) => s.name), expected.slice(3, 6));
      const ids = await svc.listIds({ sort: 'name:ASC' }, { manager: runner.manager });
      assert.deepStrictEqual(ids.ids, asc.items.map((s) => s.id));
      // The quick search still applies with the sort.
      const searched = await svc.list({ sort: 'name:ASC', q: 's', limit: 50 }, { manager: runner.manager });
      assert.deepStrictEqual(searched.items.map((s) => s.name), ['Sage', 'SAP']);
      // A non-text column keeps its own order.
      const byDate = await svc.list({ sort: 'created_at:ASC', limit: 50 }, { manager: runner.manager });
      assert.strictEqual(byDate.items.length, expected.length);
    });
  }],
]);
