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
import { csvOwnerKeys } from '../application-csv.config';
import { APPLICATION_NAME_MAX, applicationNameKey, lockApplicationSuites } from '../application-rules';
import dataSource from '../../data-source';
import { ApplicationsStructureService } from '../services/applications-structure.service';
import { ApplicationsCrudService } from '../services/applications-crud.service';
import { ApplicationsLifecycleService } from '../services/applications-lifecycle.service';
import { ApplicationsListService } from '../services/applications-list.service';

// Recette C1a: the rules an application obeys through the API and the CSV import alike: owners kept
// by empty cells, catalog values refused when unknown, unique names, dates in order, a suite that
// keeps its children, and a French export that imports back without an error.

type Ctx = {
  runner: QueryRunner;
  tenantId: string;
  crud: ApplicationsCrudService;
  lifecycle: ApplicationsLifecycleService;
  csv: ApplicationsCsvService;
  users: Record<'ana' | 'ben' | 'cleo', { id: string; email: string }>;
};

async function inTenant(fn: (ctx: Ctx) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'c1a');
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
    const lifecycle = new ApplicationsLifecycleService(manager.getRepository(Application), audit, null as any, settings);
    const roleId = randomUUID();
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'C1a', 'C1a', false, false, now(), now())`,
      [roleId, tenantId],
    );
    const users = {} as Ctx['users'];
    for (const name of ['ana', 'ben', 'cleo'] as const) {
      const id = randomUUID();
      const email = `${name}-${tenantId.slice(0, 8)}@example.com`;
      await runner.query(
        `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
         VALUES ($1, $2, $3, 'Tester', $4, null, $5, false, 'enabled', now(), now())`,
        [id, tenantId, name, email, roleId],
      );
      users[name] = { id, email };
    }
    await fn({ runner, tenantId, crud, lifecycle, csv, users });
  });
}

const opts = (ctx: Ctx) => ({ manager: ctx.runner.manager });

async function seedApp(ctx: Ctx, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const app = await ctx.crud.create({ name, ...extra } as any, null, opts(ctx));
  return app.id;
}

async function importCsv(ctx: Ctx, lines: string[], params: Partial<CsvImportParams> = {}): Promise<CsvImportResult> {
  return ctx.csv.import(
    { buffer: Buffer.from(lines.join('\n') + '\n'), originalname: 'apps.csv' } as Express.Multer.File,
    { dryRun: false, mode: 'enrich', operation: 'upsert', ...params },
    { manager: ctx.runner.manager, tenantId: ctx.tenantId },
  ).catch((error) => {
    throw new Error(`import refused: ${JSON.stringify(error.getResponse?.() ?? error.message)}`);
  });
}

async function ownersOf(ctx: Ctx, appId: string): Promise<string[]> {
  const rows = await ctx.runner.query(
    `SELECT owner_type, user_id FROM application_owners WHERE tenant_id = $1 AND application_id = $2`,
    [ctx.tenantId, appId],
  );
  return rows.map((row: any) => `${row.owner_type}:${row.user_id}`).sort();
}

async function refusal(promise: Promise<unknown>, status: number, code: string): Promise<Record<string, any>> {
  try {
    await promise;
  } catch (error: any) {
    assert.equal(error.getStatus?.(), status, `status of ${code}: ${error.message}`);
    const response = error.getResponse();
    assert.equal(response.code, code, error.message);
    return response.params ?? {};
  }
  throw new Error(`expected a ${status} ${code}`);
}

function rowCodes(result: CsvImportResult): Array<[number, string | undefined]> {
  return result.errors.map((error) => [error.row, error.code]);
}

async function testOwnersKeptByEmptyCells() {
  await inTenant(async (ctx) => {
    const appId = await seedApp(ctx, 'Atlas');
    await ctx.runner.query(
      `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business'), ($1, $2, $4, 'it')`,
      [ctx.tenantId, appId, ctx.users.ana.id, ctx.users.ben.id],
    );
    const header = 'name;business_owner_email_1;it_owner_email_1';
    const both = [`business:${ctx.users.ana.id}`, `it:${ctx.users.ben.id}`].sort();

    let result = await importCsv(ctx, [header, 'Atlas;;']);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(await ownersOf(ctx, appId), both, 'merge: empty owner cells keep the owners');

    result = await importCsv(ctx, [header, 'Atlas;;'], { operation: 'update_only' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(await ownersOf(ctx, appId), both, 'update only: empty owner cells keep the owners');

    result = await importCsv(ctx, [header, `Atlas;;${ctx.users.cleo.email.toUpperCase()}`]);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(await ownersOf(ctx, appId), [`business:${ctx.users.ana.id}`, `it:${ctx.users.cleo.id}`].sort(), 'a filled type is replaced, the empty one kept');

    // Replace mode: an empty owner type goes. Checked on the rule itself: a replace load of an
    // application fails before the owners today (it clears `access_methods`, a NOT NULL column).
    const users = new Map([[ctx.users.ben.email, ctx.users.ben.id]]);
    const stored = [`business:${ctx.users.ana.id}`, `it:${ctx.users.cleo.id}`];
    const raw = { name: 'Atlas', business_owner_email_1: '', it_owner_email_1: ctx.users.ben.email };
    assert.deepEqual(csvOwnerKeys(raw, users, stored, 'replace'), [`it:${ctx.users.ben.id}`], 'replace: an empty owner type is removed');
    assert.deepEqual(csvOwnerKeys(raw, users, stored, 'enrich'), [`business:${ctx.users.ana.id}`, `it:${ctx.users.ben.id}`]);
    assert.deepEqual(csvOwnerKeys({ name: 'Atlas' }, users, stored, 'replace'), stored, 'absent owner columns keep the owners in both modes');

    result = await importCsv(ctx, [header, 'Atlas;nobody@example.com;'], { dryRun: true });
    assert.equal(result.ok, false);
    assert.deepEqual(rowCodes(result), [[2, 'owner_email_unknown']], 'the dry run refuses an unknown email');
    assert.deepEqual(result.errors[0].params, { email: 'nobody@example.com' });
    result = await importCsv(ctx, [header, 'Atlas;nobody@example.com;']);
    assert.equal(result.ok, false, 'the load refuses it too');
    assert.deepEqual(await ownersOf(ctx, appId), [`business:${ctx.users.ana.id}`, `it:${ctx.users.cleo.id}`].sort(), 'and changes nothing');
  });
}

async function testUnknownCatalogValues() {
  await inTenant(async (ctx) => {
    await seedApp(ctx, 'Atlas');
    const lifecycleAllowed = 'proposed (Proposed), active (Active), deprecated (Deprecated), retired (Retired)';
    const categoryAllowed = [
      'line_of_business (Line-of-business)', 'productivity (Productivity)', 'security (Security)',
      'analytics (Analytics)', 'development (Development)', 'integration (Integration)', 'infrastructure (Infrastructure)',
    ].join(', ');
    let result = await importCsv(ctx, ['name;lifecycle;category', 'Atlas;Bogus;', 'Nova;;business'], { dryRun: true });
    assert.deepEqual(rowCodes(result), [[2, 'lifecycle_invalid'], [3, 'category_invalid']]);
    assert.deepEqual(result.errors[0].params, { value: 'Bogus', allowed: lifecycleAllowed });
    assert.deepEqual(result.errors[1].params, { value: 'business', allowed: categoryAllowed });

    result = await importCsv(ctx, ['name;lifecycle', 'Atlas;Actif', 'Nova;RETIRED', 'Orion;Obsoleto', 'Vega;Vorgeschlagen']);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const stored = await ctx.runner.query(`SELECT name, lifecycle FROM applications WHERE tenant_id = $1 ORDER BY name`, [ctx.tenantId]);
    assert.deepEqual(stored.map((row: any) => [row.name, row.lifecycle]), [
      ['Atlas', 'active'], ['Nova', 'retired'], ['Orion', 'deprecated'], ['Vega', 'proposed'],
    ], 'codes and shown labels in any language resolve to the code');

    const lifecycleParams = await refusal(ctx.crud.update((await seedApp(ctx, 'Lyra')), { lifecycle: 'bogus' } as any, null, opts(ctx)), 400, 'lifecycle_invalid');
    assert.deepEqual(lifecycleParams, { value: 'bogus', allowed: lifecycleAllowed });
    const categoryParams = await refusal(ctx.crud.update((await seedApp(ctx, 'Mira')), { category: 'business' } as any, null, opts(ctx)), 400, 'category_invalid');
    assert.deepEqual(categoryParams, { value: 'business', allowed: categoryAllowed });
  });
}

async function testNames() {
  await inTenant(async (ctx) => {
    const atlas = await seedApp(ctx, 'Atlas');
    const [{ sequential_id: atlasRef }] = await ctx.runner.query(`SELECT sequential_id FROM applications WHERE id = $1`, [atlas]);
    const params = await refusal(seedApp(ctx, '  atlas '), 409, 'name_taken');
    assert.deepEqual(params, { name: 'Atlas', ref: atlasRef || 'Atlas' });
    await refusal(seedApp(ctx, 'x'.repeat(201)), 400, 'name_too_long');
    await refusal(seedApp(ctx, '   '), 400, 'name_required');
    assert.ok(await seedApp(ctx, 'y'.repeat(200)), '200 characters are accepted');

    const nova = await seedApp(ctx, 'Nova');
    await refusal(ctx.crud.update(nova, { name: 'ATLAS' } as any, null, opts(ctx)), 409, 'name_taken');
    const renamed = await ctx.crud.update(atlas, { name: ' atlas ' } as any, null, opts(ctx));
    assert.equal(renamed.name, 'atlas', 'a change of case keeps its own name free');

    // Older data: two applications with one name stay editable while their name does not change.
    const [{ id: twinA }] = await ctx.runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'Twin') RETURNING id::text AS id`, [ctx.tenantId]);
    const [{ id: twinB }] = await ctx.runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'twin ') RETURNING id::text AS id`, [ctx.tenantId]);
    await ctx.crud.update(twinA, { name: 'Twin', description: 'kept' } as any, null, opts(ctx));
    await refusal(ctx.crud.update(twinB, { name: 'Nova' } as any, null, opts(ctx)), 409, 'name_taken');

    const first = await ctx.crud.copyApplication(nova, '', null, opts(ctx));
    const second = await ctx.crud.copyApplication(nova, 'Nova (copy)', null, opts(ctx));
    const third = await ctx.crud.copyApplication(nova, '', null, opts(ctx));
    assert.deepEqual([first.name, second.name, third.name], ['Nova (copy)', 'Nova (copy 2)', 'Nova (copy 3)']);
    const translated = await ctx.crud.copyApplication(nova, 'Nova (copie)', null, opts(ctx));
    assert.equal(translated.name, 'Nova (copie)');
    assert.equal((await ctx.crud.copyApplication(nova, 'Nova (copie)', null, opts(ctx))).name, 'Nova (copie 2)');

    await refusal(ctx.lifecycle.createVersion(nova, { name: 'nova' } as any, null, opts(ctx)), 409, 'name_taken');
    const version = await ctx.lifecycle.createVersion(nova, { name: 'Nova 2', copyOwners: false } as any, null, opts(ctx));
    assert.equal(version.name, 'Nova 2');

    // The import finds an application by its name as the uniqueness rule compares it: an older
    // name with spaces around it (` Spaced`) is updated by `Spaced`, by id or not.
    const [{ id: spaced }] = await ctx.runner.query(`INSERT INTO applications (tenant_id, name) VALUES ($1, ' Spaced') RETURNING id::text AS id`, [ctx.tenantId]);
    let result = await importCsv(ctx, ['id;name', ';Twin', ';spaced', `${nova};Atlas`, `;${'z'.repeat(201)}`], { dryRun: true });
    assert.deepEqual(rowCodes(result), [[2, 'name_ambiguous'], [4, 'name_taken'], [5, 'name_too_long']]);
    result = await importCsv(ctx, ['id;name;description', `${twinB};twin ;updated`, ';Spaced;trimmed']);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.inserted, 0, 'no second Spaced');
    const [stored] = await ctx.runner.query(`SELECT name, description FROM applications WHERE id = $1 AND tenant_id = $2`, [spaced, ctx.tenantId]);
    assert.deepEqual(stored, { name: 'Spaced', description: 'trimmed' });

    // The key removes the spaces `btrim` removes, and those only.
    assert.equal(applicationNameKey('  Atlas '), 'atlas');
    assert.equal(applicationNameKey('\tAtlas'), '\tatlas');
  });
}

async function testDates() {
  await inTenant(async (ctx) => {
    await refusal(seedApp(ctx, 'Early', { go_live_date: '2026-05-01', end_of_support_date: '2026-01-01' }), 400, 'dates_inconsistent');
    const atlas = await seedApp(ctx, 'Atlas', { go_live_date: '2026-05-01' });
    await refusal(ctx.crud.update(atlas, { retired_date: '2026-04-30' } as any, null, opts(ctx)), 400, 'dates_inconsistent');
    const retired = await ctx.crud.update(atlas, { retired_date: '2026-06-01' } as any, null, opts(ctx));
    assert.equal(retired.lifecycle, 'active', 'a retirement date on an active application is allowed');
    const result = await importCsv(ctx, ['name;go_live_date;end_of_support_date', 'Atlas;;2026-02-01', 'Nova;2026-03-01;2026-01-01'], { dryRun: true });
    assert.deepEqual(rowCodes(result), [[2, 'dates_inconsistent'], [3, 'dates_inconsistent']], 'the stored go-live counts when the cell is empty');
  });
}

async function testSuiteWithChildren() {
  await inTenant(async (ctx) => {
    const suite = await seedApp(ctx, 'Suite', { is_suite: true });
    const child = await seedApp(ctx, 'Child');
    await ctx.runner.query(`INSERT INTO application_suites (tenant_id, application_id, suite_id) VALUES ($1, $2, $3)`, [ctx.tenantId, child, suite]);
    assert.deepEqual(await refusal(ctx.crud.update(suite, { is_suite: false } as any, null, opts(ctx)), 409, 'suite_has_children'), { count: 1 });
    const result = await importCsv(ctx, ['name;is_suite', 'Suite;false'], { dryRun: true });
    assert.deepEqual(rowCodes(result), [[2, 'suite_has_children']]);
    await ctx.runner.query(`DELETE FROM application_suites WHERE tenant_id = $1 AND suite_id = $2`, [ctx.tenantId, suite]);
    const unsuited = await ctx.crud.update(suite, { is_suite: false } as any, null, opts(ctx));
    assert.equal(unsuited.is_suite, false);
  });
}

async function testFrenchExportImportsBack() {
  await inTenant(async (ctx) => {
    const catalog = await ctx.crud.getClassificationCatalog(opts(ctx));
    const atlas = await seedApp(ctx, 'Atlas', {
      lifecycle: 'active',
      criticality: catalog.businessCriticalityLevels[0].code,
      data_class: catalog.dataClasses[0].code,
      go_live_date: '2026-01-15',
    });
    await ctx.runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'it')`, [ctx.tenantId, atlas, ctx.users.ana.id]);
    await seedApp(ctx, 'Nova', { lifecycle: 'retired' });
    const exported = await ctx.csv.export({ manager: ctx.runner.manager, tenantId: ctx.tenantId, language: 'fr', scope: 'data' });
    assert.match(exported.content, /;Actif;/, 'the lifecycle is written as the screen shows it in French');
    assert.doesNotMatch(exported.content, /;Active;|;enabled;/, 'no English label nor status code');
    const [header, atlasLine] = exported.content.replace(/^\uFEFF/, '').split(/\r?\n/);
    const statusColumn = header.split(';').indexOf('status');
    assert.ok(statusColumn >= 0, 'the export has the status');
    assert.equal(atlasLine.split(';')[statusColumn], 'Activé', 'named as the screen names it in French');
    const cellOf = (column: string) => atlasLine.split(';')[header.split(';').indexOf(column)];
    assert.equal(cellOf('users_mode'), 'Dérivé', 'the users mode is named as the screen names it in French');
    assert.equal(cellOf('classification_review_state'), 'À compléter', 'the review state is named as the screen names it in French');
    const result = await ctx.csv.import(
      { buffer: Buffer.from(exported.content), originalname: 'export.csv' } as Express.Multer.File,
      { dryRun: false, mode: 'enrich', operation: 'upsert' },
      { manager: ctx.runner.manager, tenantId: ctx.tenantId },
    );
    assert.deepEqual(result.errors, [], 'the French export imports back without an error');
    assert.equal(result.inserted, 0);
    const ignored = result.warnings.find((warning) => warning.code === 'CSV_HEADER_IGNORED_COLUMNS');
    assert.ok(String(ignored?.params?.extra ?? '').split(', ').includes('status'), 'the status column is left out of the import, with a warning');
    assert.deepEqual(await ownersOf(ctx, atlas), [`it:${ctx.users.ana.id}`]);
    const [stored] = await ctx.runner.query(`SELECT lifecycle, criticality, data_class FROM applications WHERE id = $1`, [atlas]);
    assert.deepEqual(stored, { lifecycle: 'active', criticality: catalog.businessCriticalityLevels[0].code, data_class: catalog.dataClasses[0].code });
  });
}

async function testNewVersionCopies() {
  await inTenant(async (ctx) => {
    const [{ id: process }] = await ctx.runner.query(
      `INSERT INTO business_processes (tenant_id, name) VALUES ($1, 'Order to cash') RETURNING id::text AS id`, [ctx.tenantId],
    );
    const source = await seedApp(ctx, 'Source', {
      external_facing: true, etl_enabled: true, is_suite: true, users_mode: 'manual', users_override: 120,
    });
    await ctx.runner.query(`UPDATE applications SET access_methods = ARRAY['web','api'] WHERE id = $1 AND tenant_id = $2`, [source, ctx.tenantId]);
    await ctx.runner.query(`INSERT INTO application_business_processes (tenant_id, application_id, business_process_id) VALUES ($1, $2, $3)`, [ctx.tenantId, source, process]);
    const version = await ctx.lifecycle.createVersion(source, { name: 'Source 2' } as any, null, opts(ctx));
    const [copy] = await ctx.runner.query(
      `SELECT external_facing, etl_enabled, is_suite, access_methods, users_mode, users_override, predecessor_id::text AS predecessor_id
       FROM applications WHERE id = $1 AND tenant_id = $2`, [version.id, ctx.tenantId],
    );
    assert.deepEqual(copy, {
      external_facing: true, etl_enabled: true, is_suite: true, access_methods: ['web', 'api'], users_mode: 'manual', users_override: 120, predecessor_id: source,
    });
    const processes = await ctx.runner.query(
      `SELECT business_process_id::text AS id FROM application_business_processes WHERE application_id = $1 AND tenant_id = $2`, [version.id, ctx.tenantId],
    );
    assert.deepEqual(processes, [{ id: process }], 'the business processes are copied');

    // The description goes through the integrated documents service, with the new application as target.
    const calls: Array<{ from: string; target: any }> = [];
    const withDocuments = new ApplicationsLifecycleService(
      ctx.runner.manager.getRepository(Application), new AuditService(ctx.runner.manager.getRepository(AuditLog)), null as any,
      new ItOpsSettingsService(ctx.runner.manager.getRepository(Tenant), ctx.runner.manager.getRepository(Location), new AuditService(ctx.runner.manager.getRepository(AuditLog))),
      { copyApplicationOverview: async (from: string, target: any) => { calls.push({ from, target }); return true; } } as any,
    );
    const second = await withDocuments.createVersion(source, { name: 'Source 3' } as any, null, opts(ctx));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].from, source);
    assert.equal(calls[0].target.id, second.id);
    assert.equal(calls[0].target.tenant_id, ctx.tenantId);
    assert.match(String(calls[0].target.reference_label), /^APP-\d+$/);
  });
}

async function testOperationLimitsOwnersAndResidency() {
  await inTenant(async (ctx) => {
    const atlas = await seedApp(ctx, 'Atlas');
    await ctx.runner.query(
      `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
      [ctx.tenantId, atlas, ctx.users.ana.id],
    );
    const header = 'name;business_owner_email_1;data_residency';
    let result = await importCsv(ctx, [header, `Atlas;${ctx.users.ben.email};DE`, `Nova;${ctx.users.cleo.email};FR`], { operation: 'insert_only' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual([result.inserted, result.skipped], [1, 1]);
    assert.deepEqual(await ownersOf(ctx, atlas), [`business:${ctx.users.ana.id}`], 'a skipped row keeps its owners');
    const residencyOf = async (id: string) => (await ctx.runner.query(
      `SELECT country_iso FROM application_data_residency WHERE tenant_id = $1 AND application_id = $2`, [ctx.tenantId, id],
    )).map((row: any) => row.country_iso);
    assert.deepEqual(await residencyOf(atlas), [], 'and its residency');
    const [{ id: nova }] = await ctx.runner.query(`SELECT id::text AS id FROM applications WHERE tenant_id = $1 AND name = 'Nova'`, [ctx.tenantId]);
    assert.deepEqual(await ownersOf(ctx, nova), [`business:${ctx.users.cleo.id}`], 'an inserted row gets its owners');
    assert.deepEqual(await residencyOf(nova), ['FR']);

    result = await importCsv(ctx, [header, `Nova;${ctx.users.ana.email};`, `Vega;${ctx.users.ana.email};`], { operation: 'update_only' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual([result.updated, result.skipped], [1, 1]);
    assert.deepEqual(await ownersOf(ctx, nova), [`business:${ctx.users.ana.id}`], 'an updated row gets its owners');
    assert.equal((await ctx.runner.query(`SELECT 1 FROM applications WHERE tenant_id = $1 AND name = 'Vega'`, [ctx.tenantId])).length, 0);
  });
}

async function testEmptyResidencyCell() {
  await inTenant(async (ctx) => {
    const atlas = await seedApp(ctx, 'Atlas');
    await ctx.runner.query(`UPDATE applications SET access_methods = ARRAY['web'] WHERE id = $1 AND tenant_id = $2`, [atlas, ctx.tenantId]);
    const residencyOf = async () => (await ctx.runner.query(
      `SELECT country_iso FROM application_data_residency WHERE tenant_id = $1 AND application_id = $2 ORDER BY 1`, [ctx.tenantId, atlas],
    )).map((row: any) => row.country_iso);
    let result = await importCsv(ctx, ['name;data_residency;description', 'Atlas;DE,FR;First']);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(await residencyOf(), ['DE', 'FR']);
    result = await importCsv(ctx, ['name;data_residency;description', 'Atlas;;Second']);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(await residencyOf(), ['DE', 'FR'], 'an empty cell keeps the residency in enrich mode');
    // Replace mode reads a complete file: start from the export of the application (French: `;`).
    const exported = await ctx.csv.export({ manager: ctx.runner.manager, tenantId: ctx.tenantId, language: 'fr', scope: 'data' });
    const [header, line] = exported.content.replace(/^\uFEFF/, '').split(/\r?\n/).map((text) => text.split(';'));
    const column = header.indexOf('data_residency');
    assert.ok(column >= 0, 'the export has the residency');
    const without = (cells: string[]) => cells.filter((_, index) => index !== column).join(';');
    result = await importCsv(ctx, [without(header), without(line)], { mode: 'replace' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(await residencyOf(), ['DE', 'FR'], 'a file without the column leaves it alone, even in replace mode');
    result = await importCsv(ctx, [header.join(';'), line.map((cell, index) => (index === column ? '' : cell)).join(';')], { mode: 'replace' });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(await residencyOf(), [], 'an empty cell clears it in replace mode');
  });
}

async function testImportRenameSyncsDocumentTitle() {
  await inTenant(async (ctx) => {
    const atlas = await seedApp(ctx, 'Atlas');
    const nova = await seedApp(ctx, 'Nova');
    const calls: Array<{ type: string; source: any }> = [];
    const manager = ctx.runner.manager;
    const audit = new AuditService(manager.getRepository(AuditLog));
    const resolver = new CsvResolverService();
    const csv = new ApplicationsCsvService(
      manager.getRepository(Application), null as any, null as any,
      new CsvExportService(resolver), new CsvImportService(resolver, new CsvJsonValidators()), resolver, audit,
      new ApplicationsListService(manager.getRepository(Application)),
      new ItOpsSettingsService(manager.getRepository(Tenant), manager.getRepository(Location), audit),
      { syncTitles: async (type: string, source: any) => { calls.push({ type, source }); return 1; } } as any,
    );
    const run = (lines: string[], dryRun = false) => csv.import(
      { buffer: Buffer.from(lines.join('\n') + '\n'), originalname: 'apps.csv' } as Express.Multer.File,
      { dryRun, mode: 'enrich', operation: 'upsert' },
      { manager, tenantId: ctx.tenantId },
    );
    let result = await run(['id;name', `${atlas};Atlas Prime`], true);
    assert.equal(calls.length, 0, 'a dry run renames nothing');
    result = await run(['id;name;description', `${atlas};Atlas Prime;`, `${nova};Nova;changed`, ';Vega;new']);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(calls.map((call) => [call.type, call.source.id, call.source.name]), [['applications', atlas, 'Atlas Prime']], 'only the renamed application');
    const [{ sequential_id }] = await ctx.runner.query(`SELECT sequential_id FROM applications WHERE id = $1 AND tenant_id = $2`, [atlas, ctx.tenantId]);
    assert.equal(calls[0].source.reference_label, String(sequential_id || '').trim() || atlas);
  });
}

async function testCopyOfALongName() {
  await inTenant(async (ctx) => {
    for (const length of [196, APPLICATION_NAME_MAX]) {
      const source = await seedApp(ctx, `${String(length)}${'n'.repeat(length - 3)}`);
      const first = await ctx.crud.copyApplication(source, '', null, opts(ctx));
      const second = await ctx.crud.copyApplication(source, '', null, opts(ctx));
      assert.ok(first.name.length <= APPLICATION_NAME_MAX && first.name.endsWith(' (copy)'), first.name);
      assert.ok(second.name.length <= APPLICATION_NAME_MAX && second.name.endsWith(' (copy 2)'), second.name);
      assert.ok(first.name.startsWith(String(length)));
    }
    const plain = await seedApp(ctx, 'p'.repeat(APPLICATION_NAME_MAX));
    const named = await ctx.crud.copyApplication(plain, 'p'.repeat(APPLICATION_NAME_MAX), null, opts(ctx));
    assert.equal(named.name, `${'p'.repeat(APPLICATION_NAME_MAX - 4)} (2)`, 'a numbered name is cut before its number');
  });
}

async function testSuiteCycles() {
  await inTenant(async (ctx) => {
    const structure = new ApplicationsStructureService(ctx.runner.manager.getRepository(Application), new AuditService(ctx.runner.manager.getRepository(AuditLog)));
    const [a, b, c] = [await seedApp(ctx, 'Alpha', { is_suite: true }), await seedApp(ctx, 'Beta', { is_suite: true }), await seedApp(ctx, 'Gamma', { is_suite: true })];
    const sOpts = opts(ctx);
    // A concurrent suite change of the tenant holds the lock: this one waits for its end, so its
    // cycle check sees what the other committed. (First: this transaction then holds the lock.)
    const other = dataSource.createQueryRunner();
    await other.connect();
    try {
      await other.startTransaction();
      await lockApplicationSuites(other.manager, ctx.tenantId);
      let done = false;
      const waiting = structure.bulkReplaceSuites(a, [b], null, sOpts).finally(() => { done = true; });
      await new Promise((resolve) => setTimeout(resolve, 300));
      assert.equal(done, false, 'the change waits for the lock');
      await other.commitTransaction();
      await waiting;
    } finally {
      if (other.isTransactionActive) await other.rollbackTransaction();
      await other.release();
    }
    assert.deepEqual(await refusal(structure.bulkReplaceSuites(a, [a], null, sOpts), 409, 'suite_cycle'), { name: 'Alpha' }, 'not in its own suite');
    await structure.bulkReplaceSuites(a, [b], null, sOpts);
    assert.deepEqual(await refusal(structure.bulkReplaceSuites(b, [a], null, sOpts), 409, 'suite_cycle'), { name: 'Alpha' }, 'Beta contains Alpha already');
    await structure.bulkReplaceSuites(b, [c], null, sOpts);
    assert.deepEqual(await refusal(structure.bulkReplaceSuites(c, [a], null, sOpts), 409, 'suite_cycle'), { name: 'Alpha' }, 'through another suite');
    await structure.bulkReplaceSuites(a, [b, c], null, sOpts);
    const links = await ctx.runner.query(
      `SELECT application_id::text AS app, suite_id::text AS suite FROM application_suites WHERE tenant_id = $1 ORDER BY 1, 2`, [ctx.tenantId],
    );
    assert.equal(links.length, 3, 'a suite inside a suite is kept, without a cycle');
  });
}

runSpecs('application-rules.integration.spec', [
  ['owners kept by empty cells', testOwnersKeptByEmptyCells],
  ['unknown catalog values', testUnknownCatalogValues],
  ['names', testNames],
  ['dates', testDates],
  ['suite with children', testSuiteWithChildren],
  ['french export imports back', testFrenchExportImportsBack],
  ['new version copies', testNewVersionCopies],
  ['operation limits owners and residency', testOperationLimitsOwnersAndResidency],
  ['empty residency cell', testEmptyResidencyCell],
  ['import rename syncs the document title', testImportRenameSyncsDocumentTitle],
  ['copy of a long name', testCopyOfALongName],
  ['suite cycles', testSuiteCycles],
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
