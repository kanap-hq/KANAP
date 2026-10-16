import 'dotenv/config';
// @database-spec: opens the data-source through runSpecs, so it runs on a database lane.
import { ConflictException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { CompaniesService } from '../companies.service';
import { Company } from '../company.entity';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
  setTenant,
  underSavepoint,
} from '../../spend/__tests__/round-inputs.fixtures';

// Company names are unique per tenant whatever their case: create and rename
// refuse "acme" when "Acme" exists (409 `duplicate`), another tenant may still
// use it, and the CSV import updates "Acme" from a row named "ACME" without
// changing the stored spelling, saying so in its report.

function service(runner: QueryRunner) {
  return new CompaniesService(runner.manager.getRepository(Company), captureAudit() as any, undefined as any);
}

const base = { country_iso: 'FR', city: 'Lyon', base_currency: 'EUR' };

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
  const rows: Array<{ name: string }> = await runner.query(`SELECT name FROM companies ORDER BY name`);
  return rows.map((row) => row.name);
}

/** The CSV import file: the template's header line, then one row per object of values by column. */
async function csvFile(svc: CompaniesService, runner: QueryRunner, rows: Array<Record<string, string>>) {
  const template = await svc.exportCsv('template', { manager: runner.manager, language: 'en' });
  const header = template.content.replace(/^﻿/, '').split(/\r?\n/)[0];
  const columns = header.split(',');
  const lines = rows.map((row) => columns.map((column) => row[column] ?? '').join(','));
  return { buffer: Buffer.from([header, ...lines].join('\n'), 'utf8') } as Express.Multer.File;
}

void runSpecs('companies name rules', [
  ['create refuses a name another company has in any case', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = service(runner);
      await seedTenant(runner, 'company-names');
      await svc.create({ ...base, name: 'Acme' }, undefined, { manager: runner.manager });
      await underSavepoint(runner, () => expectDuplicate(() => svc.create({ ...base, name: 'acme' }, undefined, { manager: runner.manager })));
      await underSavepoint(runner, () => expectDuplicate(() => svc.create({ ...base, name: 'Acme' }, undefined, { manager: runner.manager })));
      assert.deepStrictEqual(await names(runner), ['Acme']);
    });
  }],
  ['rename refuses another company name in another case, and allows a change of case of its own', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = service(runner);
      await seedTenant(runner, 'company-rename');
      const acme = await svc.create({ ...base, name: 'Acme' }, undefined, { manager: runner.manager });
      const other = await svc.create({ ...base, name: 'Globex' }, undefined, { manager: runner.manager });
      await underSavepoint(runner, () => expectDuplicate(() => svc.update(other.id, { name: 'ACME' }, undefined, { manager: runner.manager })));
      await svc.update(acme.id, { name: 'ACME' }, undefined, { manager: runner.manager });
      // Saving other fields with the stored name is never refused.
      await svc.update(other.id, { name: 'Globex', notes: 'Holding' }, undefined, { manager: runner.manager });
      assert.deepStrictEqual(await names(runner), ['ACME', 'Globex']);
    });
  }],
  ['another tenant may use the name in any case', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = service(runner);
      await seedTenant(runner, 'company-names-a');
      await svc.create({ ...base, name: 'Acme' }, undefined, { manager: runner.manager });
      await seedTenant(runner, 'company-names-b');
      await svc.create({ ...base, name: 'acme' }, undefined, { manager: runner.manager });
      assert.deepStrictEqual(await names(runner), ['acme']);
    });
  }],
  ['the CSV import matches an existing company whatever the case of its name', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = service(runner);
      const tenantId = await seedTenant(runner, 'company-import');
      await svc.create({ ...base, name: 'Acme' }, undefined, { manager: runner.manager });
      const file = await csvFile(svc, runner, [{ ...base, name: 'ACME', notes: 'Updated', status: 'enabled' }]);
      const preview = await svc.importCsv({ file, dryRun: true, language: 'en' }, { manager: runner.manager });
      assert.strictEqual(preview.ok, true, JSON.stringify(preview.errors));
      assert.strictEqual(preview.inserted, 0, 'no new company in the preview');
      assert.strictEqual(preview.updated, 1);
      // The preview says which stored company the row matched.
      assert.deepStrictEqual((preview as any).warnings, [{
        row: 2,
        column: 'name',
        message: "'ACME' was matched to 'Acme'.",
        code: 'CSV_NAME_MATCHED_CASE',
        params: { name: 'ACME', stored: 'Acme' },
      }]);
      await setTenant(runner, tenantId);
      const result = await svc.importCsv({ file, dryRun: false, language: 'en' }, { manager: runner.manager });
      assert.strictEqual(result.ok, true, JSON.stringify(result.errors));
      assert.strictEqual(result.inserted, 0);
      const rows: Array<{ name: string; notes: string }> = await runner.query(`SELECT name, notes FROM companies`);
      // The row updates the company and keeps its stored spelling.
      assert.deepStrictEqual(rows, [{ name: 'Acme', notes: 'Updated' }], 'one company, still named Acme');
      // Imported again, the row is unchanged: the case of the name is not a change.
      const again = await svc.importCsv({ file, dryRun: true, language: 'en' }, { manager: runner.manager });
      assert.strictEqual(again.updated, 0);
      assert.strictEqual((again as any).unchanged, 1);
    });
  }],
]);
