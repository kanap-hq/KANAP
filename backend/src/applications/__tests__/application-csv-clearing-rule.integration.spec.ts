import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import type { CsvImportParams, CsvImportResult } from '../../common/csv';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Application } from '../application.entity';
import { ApplicationsCsvService } from '../applications-csv.service';
import { applicationCsvConfig } from '../application-csv.config';
import { ApplicationsCrudService } from '../services/applications-crud.service';
import { ApplicationsListService } from '../services/applications-list.service';

// Lot I6 of 26.11.9, pass A (D21, T-I6c, T-I6d, T-I6j): the applications import under the one clearing
// rule. A blank cell keeps, `-` clears (`__CLEAR__` reads as `-`), a filled list is the whole list, and
// the check announces the stored values the import clears (`cleared`), for the owners, the data
// residency, the supplier and the classification alike. An export imported back as it is changes nothing.

const USERS = ['ana', 'ben', 'cleo', 'dan', 'eva', 'finn'] as const;

type Ctx = {
  runner: QueryRunner;
  tenantId: string;
  crud: ApplicationsCrudService;
  csv: ApplicationsCsvService;
  users: Record<(typeof USERS)[number], { id: string; email: string }>;
};

async function inTenant(fn: (ctx: Ctx) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'i6a');
    const manager = runner.manager;
    const audit = new AuditService(manager.getRepository(AuditLog));
    const settings = new ItOpsSettingsService(manager.getRepository(Tenant), manager.getRepository(Location), audit);
    const resolver = new CsvResolverService();
    const csv = new ApplicationsCsvService(
      manager.getRepository(Application), null as any, null as any,
      new CsvExportService(resolver), new CsvImportService(resolver, new CsvJsonValidators()), resolver, audit,
      new ApplicationsListService(manager.getRepository(Application)), settings,
    );
    const crud = new ApplicationsCrudService(manager.getRepository(Application), audit, null as any, settings, null as any);
    const roleId = randomUUID();
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'I6a', 'I6a', false, false, now(), now())`,
      [roleId, tenantId],
    );
    const users = {} as Ctx['users'];
    for (const name of USERS) {
      const id = randomUUID();
      const email = `${name}-${tenantId.slice(0, 8)}@example.com`;
      await runner.query(
        `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Tester', $4, null, $5, false, 'enabled', now(), now())`,
        [id, tenantId, name, email, roleId],
      );
      users[name] = { id, email };
    }
    await fn({ runner, tenantId, crud, csv, users });
  });
}

async function importCsv(ctx: Ctx, lines: string[], params: Partial<CsvImportParams> = {}): Promise<CsvImportResult> {
  return ctx.csv.import(
    { buffer: Buffer.from(lines.join('\n') + '\n'), originalname: 'apps.csv' } as Express.Multer.File,
    { dryRun: false, operation: 'upsert', ...params },
    // An administrator: the publisher finds its supplier only for a person who reads the suppliers.
    { manager: ctx.runner.manager, tenantId: ctx.tenantId, access: { isAdmin: true, permissions: {} } },
  ).catch((error) => {
    throw new Error(`import refused: ${JSON.stringify(error.getResponse?.() ?? error.message)}`);
  });
}

/** The check, then the load: the check announces what the load clears. */
async function checkThenLoad(ctx: Ctx, lines: string[]): Promise<{ check: CsvImportResult; load: CsvImportResult }> {
  const check = await importCsv(ctx, lines, { dryRun: true });
  assert.equal(check.ok, true, JSON.stringify(check.errors));
  const load = await importCsv(ctx, lines);
  assert.equal(load.ok, true, JSON.stringify(load.errors));
  return { check, load };
}

async function seedApp(ctx: Ctx, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const app = await ctx.crud.create({ name, ...extra } as any, null, { manager: ctx.runner.manager });
  return app.id;
}

async function addOwners(ctx: Ctx, appId: string, type: 'business' | 'it', names: Array<keyof Ctx['users']>) {
  // One after the other: the export lists them in the order they were added.
  for (const name of names) {
    await ctx.runner.query(
      `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type, created_at) VALUES ($1, $2, $3, $4, clock_timestamp())`,
      [ctx.tenantId, appId, ctx.users[name].id, type],
    );
  }
}

async function ownersOf(ctx: Ctx, appId: string): Promise<string[]> {
  const rows = await ctx.runner.query(
    `SELECT owner_type, user_id FROM application_owners WHERE tenant_id = $1 AND application_id = $2`,
    [ctx.tenantId, appId],
  );
  const nameOf = new Map(Object.entries(ctx.users).map(([name, user]) => [user.id, name]));
  return rows.map((row: any) => `${row.owner_type}:${nameOf.get(row.user_id)}`).sort();
}

async function residencyOf(ctx: Ctx, appId: string): Promise<string[]> {
  return (await ctx.runner.query(
    `SELECT country_iso FROM application_data_residency WHERE tenant_id = $1 AND application_id = $2 ORDER BY 1`, [ctx.tenantId, appId],
  )).map((row: any) => row.country_iso);
}

async function appRow(ctx: Ctx, appId: string): Promise<Record<string, any>> {
  const [row] = await ctx.runner.query(`SELECT * FROM applications WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, appId]);
  return row;
}

const codes = (result: CsvImportResult) => result.errors.map((error) => [error.row, error.column, error.code]);

/** Owners, per type: blank cells keep, filled cells replace, `-` alone empties the type, a `-` among emails adds nothing. */
async function testOwners() {
  await inTenant(async (ctx) => {
    const atlas = await seedApp(ctx, 'Atlas');
    await addOwners(ctx, atlas, 'business', ['ana', 'ben']);
    await addOwners(ctx, atlas, 'it', ['cleo']);
    const header = 'name;business_owner_email_1;business_owner_email_2;business_owner_email_3;business_owner_email_4;it_owner_email_1';
    const { users } = ctx;

    let run = await checkThenLoad(ctx, [header, 'Atlas;;;;;']);
    assert.deepEqual(await ownersOf(ctx, atlas), ['business:ana', 'business:ben', 'it:cleo'], 'blank cells keep the owners');
    assert.deepEqual([run.check.unchanged, run.check.cleared], [1, 0]);

    run = await checkThenLoad(ctx, [header, `Atlas;${users.dan.email};;;;`]);
    assert.deepEqual(await ownersOf(ctx, atlas), ['business:dan', 'it:cleo'], 'filled cells replace the list of their type');
    assert.deepEqual([run.check.cleared, run.load.cleared], [2, 2], 'the two business owners removed are announced');

    run = await checkThenLoad(ctx, [header, `Atlas;-;${users.eva.email};;;`]);
    assert.deepEqual(await ownersOf(ctx, atlas), ['business:eva', 'it:cleo'], 'a `-` among emails adds nothing: the emails are the list');
    assert.equal(run.check.cleared, 1);

    run = await checkThenLoad(ctx, [header, 'Atlas;-;;;;']);
    assert.deepEqual(await ownersOf(ctx, atlas), ['it:cleo'], '`-` with no email empties the type');
    assert.deepEqual([run.check.updated, run.check.cleared], [1, 1]);

    run = await checkThenLoad(ctx, [header, 'Atlas;__CLEAR__;;;;-']);
    assert.deepEqual(await ownersOf(ctx, atlas), [], '`__CLEAR__` reads as `-`');
    assert.equal(run.check.cleared, 1);

    run = await checkThenLoad(ctx, [header, 'Atlas;-;;;;-']);
    assert.deepEqual([run.check.unchanged, run.check.updated, run.check.cleared], [1, 0, 0], 'nothing left to clear');

    run = await checkThenLoad(ctx, [header, `Nova;-;${users.ana.email};;;-`]);
    const [{ id: nova }] = await ctx.runner.query(`SELECT id::text AS id FROM applications WHERE tenant_id = $1 AND name = 'Nova'`, [ctx.tenantId]);
    assert.deepEqual(await ownersOf(ctx, nova), ['business:ana'], 'a new application: `-` reads as a blank cell');
    assert.deepEqual([run.check.inserted, run.check.cleared], [1, 0]);
  });
}

/** Data residency: blank keeps, `-` clears, a filled cell is the whole list. */
async function testResidency() {
  await inTenant(async (ctx) => {
    const atlas = await seedApp(ctx, 'Atlas');
    const header = 'name;data_residency';
    await checkThenLoad(ctx, [header, 'Atlas;FR,DE,IT']);
    assert.deepEqual(await residencyOf(ctx, atlas), ['DE', 'FR', 'IT']);

    let run = await checkThenLoad(ctx, [header, 'Atlas;']);
    assert.deepEqual(await residencyOf(ctx, atlas), ['DE', 'FR', 'IT'], 'a blank cell keeps the residency');
    assert.deepEqual([run.check.unchanged, run.check.cleared], [1, 0]);

    run = await checkThenLoad(ctx, [header, 'Atlas;FR, DE']);
    assert.deepEqual(await residencyOf(ctx, atlas), ['DE', 'FR'], 'a filled cell replaces the list');
    assert.deepEqual([run.check.updated, run.check.cleared, run.load.cleared], [1, 1, 1], 'the country removed is announced');

    run = await checkThenLoad(ctx, [header, 'Atlas;-']);
    assert.deepEqual(await residencyOf(ctx, atlas), [], '`-` clears the residency');
    assert.deepEqual([run.check.updated, run.check.cleared], [1, 2]);
  });
}

/** Supplier and publisher: a stored supplier stays for a blank cell; `-` removes the link and the publisher does not bring it back. */
async function testSupplierAndPublisher() {
  await inTenant(async (ctx) => {
    const [{ id: sage }] = await ctx.runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Sage') RETURNING id::text AS id`, [ctx.tenantId]);
    const [{ id: cegid }] = await ctx.runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Cegid') RETURNING id::text AS id`, [ctx.tenantId]);
    const atlas = await seedApp(ctx, 'Atlas', { supplier_id: sage, editor: 'Sage' });
    const header = 'name;supplier_name;editor';

    let run = await checkThenLoad(ctx, [header, 'Atlas;;Cegid']);
    assert.equal((await appRow(ctx, atlas)).supplier_id, sage, 'a blank supplier cell keeps the stored supplier, whatever the publisher');
    assert.equal(run.check.cleared, 0);

    run = await checkThenLoad(ctx, [header, 'Atlas;-;Cegid']);
    const row = await appRow(ctx, atlas);
    assert.deepEqual([row.supplier_id, row.editor], [null, 'Cegid'], '`-` removes the supplier; the publisher does not link Cegid');
    assert.equal(run.check.cleared, 1);
    assert.equal(run.check.matches, undefined, 'no match by the publisher');

    run = await checkThenLoad(ctx, [header, 'Atlas;;Cegid']);
    assert.equal((await appRow(ctx, atlas)).supplier_id, cegid, 'with no supplier stored, a blank cell lets the publisher name it');

    await checkThenLoad(ctx, [header, 'Vega;-;Cegid']);
    const [vega] = await ctx.runner.query(`SELECT supplier_id FROM applications WHERE tenant_id = $1 AND name = 'Vega'`, [ctx.tenantId]);
    assert.equal(vega.supplier_id, null, 'a new application: `-` says no supplier, the publisher links none');
  });
}

/** Classification: `-` (and `__CLEAR__`) clears a value that may be empty; a yes or no that cannot be empty refuses it. */
async function testClassification() {
  await inTenant(async (ctx) => {
    const catalog = await ctx.crud.getClassificationCatalog({ manager: ctx.runner.manager });
    const level = catalog.businessCriticalityLevels[0];
    const atlas = await seedApp(ctx, 'Atlas', { criticality: level.code, rto_minutes: 240, rpo_minutes: 60, classification_justification: 'Core', contains_pii: true, external_facing: true });
    const header = 'name;criticality;rto_minutes;rpo_minutes;classification_justification';

    let run = await checkThenLoad(ctx, [header, 'Atlas;;;;']);
    assert.equal(run.check.unchanged, 1, 'blank cells keep the classification');
    const revision = (await appRow(ctx, atlas)).classification_revision;

    run = await checkThenLoad(ctx, [header, 'Atlas;-;-;__CLEAR__;']);
    let row = await appRow(ctx, atlas);
    assert.deepEqual([row.criticality, row.rto_minutes, row.rpo_minutes, row.classification_justification], [null, null, null, 'Core']);
    assert.deepEqual([run.check.cleared, run.load.cleared], [3, 3], 'three classification values cleared');
    assert.equal(row.classification_revision, revision + 1, 'a change of the classification is a new revision');

    for (const [column, label] of [['contains_pii', 'contains_pii'], ['external_facing', 'external_facing'], ['etl_enabled', 'etl_enabled'], ['lifecycle', 'lifecycle'], ['category', 'category']]) {
      const check = await importCsv(ctx, [`name;${column}`, 'Atlas;-'], { dryRun: true });
      assert.deepEqual(codes(check), [[2, label, 'CSV_VALUE_CANNOT_BE_CLEARED']], `${column} cannot be cleared`);
    }
    row = await appRow(ctx, atlas);
    assert.deepEqual([row.contains_pii, row.external_facing], [true, true]);

    // The template's titles no longer speak of __CLEAR__.
    assert.ok(applicationCsvConfig.fields.every((field) => !String(field.label ?? '').includes('__CLEAR__')), 'no __CLEAR__ in the labels');
  });
}

/**
 * An export imported back as it is changes nothing: five business owners (the file has four columns
 * per type), a residency `FR,DE`, and a stored text "-" (written `'-`, read as the text).
 */
async function testRoundTrip() {
  await inTenant(async (ctx) => {
    const atlas = await seedApp(ctx, 'Atlas', { notes: '-', version: '-', editor: 'Acme' });
    await addOwners(ctx, atlas, 'business', ['ana', 'ben', 'cleo', 'dan']);
    await addOwners(ctx, atlas, 'it', ['eva']);
    await checkThenLoad(ctx, ['name;data_residency', 'Atlas;FR,DE']);
    const before = { owners: await ownersOf(ctx, atlas), residency: await residencyOf(ctx, atlas), row: await appRow(ctx, atlas) };
    assert.deepEqual(before.residency, ['DE', 'FR']);

    for (const language of ['en', 'fr'] as const) {
      const exported = await ctx.csv.export({ manager: ctx.runner.manager, tenantId: ctx.tenantId, language, scope: 'data' });
      const file = { buffer: Buffer.from(exported.content), originalname: 'export.csv' } as Express.Multer.File;
      const run = (dryRun: boolean) => ctx.csv.import(file, { dryRun, operation: 'upsert' }, { manager: ctx.runner.manager, tenantId: ctx.tenantId });
      const check = await run(true);
      assert.deepEqual(check.errors, [], `${language}: the export imports back without an error`);
      assert.deepEqual([check.inserted, check.updated, check.unchanged, check.cleared], [0, 0, 1, 0], `${language}: nothing changes`);
      const load = await run(false);
      assert.deepEqual([load.updated, load.unchanged, load.cleared], [0, 1, 0]);
      assert.deepEqual(await ownersOf(ctx, atlas), before.owners, `${language}: the owners stay`);
      assert.deepEqual(await residencyOf(ctx, atlas), before.residency, `${language}: the residency stays`);
      const after = await appRow(ctx, atlas);
      assert.deepEqual([after.notes, after.version, after.classification_revision], ['-', '-', before.row.classification_revision], `${language}: the text "-" stays`);
    }

    // A fifth owner of a type: the export writes four of them, and the check announces the fifth goes.
    await addOwners(ctx, atlas, 'business', ['finn']);
    const exported = await ctx.csv.export({ manager: ctx.runner.manager, tenantId: ctx.tenantId, language: 'en', scope: 'data' });
    const check = await ctx.csv.import(
      { buffer: Buffer.from(exported.content), originalname: 'export.csv' } as Express.Multer.File,
      { dryRun: true, operation: 'upsert' },
      { manager: ctx.runner.manager, tenantId: ctx.tenantId },
    );
    assert.deepEqual([check.updated, check.cleared], [1, 1], 'beyond four owners of a type, the check says one value will be cleared');
  });
}

runSpecs('application-csv-clearing-rule.integration.spec', [
  ['owners', testOwners],
  ['data residency', testResidency],
  ['supplier and publisher', testSupplierAndPublisher],
  ['classification', testClassification],
  ['round trip', testRoundTrip],
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
