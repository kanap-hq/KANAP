import 'dotenv/config';
import type { QueryRunner } from 'typeorm';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import type { CsvImportResult } from '../../common/csv';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { AppInstancesService } from '../../app-instances/app-instances.service';
import { AppInstance } from '../../app-instances/app-instance.entity';
import { AppAssetAssignment } from '../../app-asset-assignments/app-asset-assignment.entity';
import { InterfaceBinding } from '../../interface-bindings/interface-binding.entity';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Application } from '../application.entity';
import { ApplicationsCsvService } from '../applications-csv.service';
import { ApplicationsCrudService } from '../services/applications-crud.service';
import { ApplicationsListService } from '../services/applications-list.service';

// Lot K2c of 26.12.1: rule P7 (maintainer, 2026-11-23) on the catalog values of an application. A
// value retired from a catalog is refused on a record that does not hold it and kept on the one
// that does, at the creation and at the update, by the API (the change in bulk goes through it)
// and the import: category, lifecycle, access methods, and a deployment's lifecycle. The access
// methods are now checked against the tenant's catalog (they were free text).

type Ctx = { runner: QueryRunner; tenantId: string; crud: ApplicationsCrudService; csv: ApplicationsCsvService; instances: AppInstancesService; settings: ItOpsSettingsService };

async function inTenant(fn: (ctx: Ctx) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'k2c');
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
    const instances = new AppInstancesService(
      manager.getRepository(AppInstance), manager.getRepository(Application), manager.getRepository(InterfaceBinding),
      manager.getRepository(AppAssetAssignment), audit, settings,
    );
    const ctx = { runner, tenantId, crud, csv, instances, settings };
    // Each list gets one retired entry: a category, a lifecycle state, an access method.
    const current = await settings.getSettings(tenantId, { manager });
    await settings.updateSettings(tenantId, {
      applicationCategories: [...current.applicationCategories, { code: 'mainframe', label: 'Mainframe', deprecated: true }],
      lifecycleStates: [...current.lifecycleStates, { code: 'frozen', label: 'Frozen', deprecated: true }],
      accessMethods: current.accessMethods.map((option) => (option.code === 'kiosk' ? { ...option, deprecated: true } : option)),
    }, { manager });
    await fn(ctx);
  });
}

const opts = (ctx: Ctx) => ({ manager: ctx.runner.manager });

async function refusal(fn: () => Promise<unknown>): Promise<{ code: string; message: string; params?: Record<string, unknown> }> {
  try {
    await fn();
  } catch (error: any) {
    const response = error?.getResponse?.();
    return { code: response?.code ?? 'uncoded', message: String(response?.message ?? error.message), params: response?.params };
  }
  throw new Error('Expected a refusal');
}

async function row(ctx: Ctx, id: string) {
  const [stored] = await ctx.runner.query(`SELECT category, lifecycle, access_methods FROM applications WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, id]);
  return stored;
}

/** A record that holds a value the catalog retired since (or never knew), set as older data would be. */
async function holder(ctx: Ctx, name: string, values: Record<string, unknown>): Promise<string> {
  const app = await ctx.crud.create({ name } as any, null, opts(ctx));
  const sets = Object.keys(values).map((key, index) => `${key} = $${index + 3}`).join(', ');
  await ctx.runner.query(`UPDATE applications SET ${sets} WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, app.id, ...Object.values(values)]);
  return app.id;
}

async function testCategory() {
  await inTenant(async (ctx) => {
    let refused = await refusal(() => ctx.crud.create({ name: 'Alpha', category: 'Mainframe' } as any, null, opts(ctx)));
    assert.equal(refused.code, 'catalog_value_retired', 'a new application cannot take a retired category');
    assert.ok(!String(refused.params?.allowed).includes('mainframe'), String(refused.params?.allowed));
    const other = (await ctx.crud.create({ name: 'Bravo' } as any, null, opts(ctx))).id;
    refused = await refusal(() => ctx.crud.update(other, { category: 'mainframe' } as any, null, opts(ctx)));
    assert.equal(refused.code, 'catalog_value_retired', 'an application that does not hold it cannot take it');
    refused = await refusal(() => ctx.crud.update(other, { category: 'nowhere' } as any, null, opts(ctx)));
    assert.equal(refused.code, 'category_invalid');

    const kept = await holder(ctx, 'Charlie', { category: 'mainframe' });
    await ctx.crud.update(kept, { name: 'Charlie 2', category: 'mainframe' } as any, null, opts(ctx));
    assert.equal((await row(ctx, kept)).category, 'mainframe', 'the application that holds it keeps it');
    const legacy = await holder(ctx, 'Delta', { category: 'old_free_text' });
    await ctx.crud.update(legacy, { category: 'old_free_text', description: 'Kept' } as any, null, opts(ctx));
    assert.equal((await row(ctx, legacy)).category, 'old_free_text', 'a value stored before the catalog changed stays');
  });
}

async function testLifecycle() {
  await inTenant(async (ctx) => {
    let refused = await refusal(() => ctx.crud.create({ name: 'Alpha', lifecycle: 'Frozen' } as any, null, opts(ctx)));
    assert.equal(refused.code, 'catalog_value_retired');
    const other = (await ctx.crud.create({ name: 'Bravo' } as any, null, opts(ctx))).id;
    refused = await refusal(() => ctx.crud.update(other, { lifecycle: 'frozen' } as any, null, opts(ctx)));
    assert.equal(refused.code, 'catalog_value_retired');
    const kept = await holder(ctx, 'Charlie', { lifecycle: 'frozen' });
    await ctx.crud.update(kept, { lifecycle: 'Frozen', version: '2' } as any, null, opts(ctx));
    assert.equal((await row(ctx, kept)).lifecycle, 'frozen');
    // The change in bulk offers the states still offered (each application then goes through the update).
    const values = await ctx.crud.bulkEditValues(ctx.runner.manager);
    assert.ok(!values.lifecycle.includes('frozen') && values.lifecycle.includes('active'), values.lifecycle.join(','));
    assert.ok(!values.category.includes('mainframe'));
  });
}

async function testAccessMethods() {
  await inTenant(async (ctx) => {
    const created = await ctx.crud.create({ name: 'Alpha', access_methods: ['web', 'VDI / Remote Desktop'] } as any, null, opts(ctx));
    assert.deepEqual((await row(ctx, created.id)).access_methods, ['web', 'vdi'], 'a code or a name, stored as the code');
    let refused = await refusal(() => ctx.crud.update(created.id, { access_methods: ['web', 'Citrix'] } as any, null, opts(ctx)));
    assert.equal(refused.code, 'access_method_invalid');
    assert.match(String(refused.params?.allowed), /web \(Web\)/);
    assert.match(refused.message, /Unknown access method "Citrix"/);
    refused = await refusal(() => ctx.crud.update(created.id, { access_methods: ['kiosk'] } as any, null, opts(ctx)));
    assert.equal(refused.code, 'catalog_value_retired');
    refused = await refusal(() => ctx.crud.create({ name: 'Bravo', access_methods: ['Kiosk'] } as any, null, opts(ctx)));
    assert.equal(refused.code, 'catalog_value_retired');

    const kept = await holder(ctx, 'Charlie', { access_methods: ['kiosk', 'citrix'] });
    await ctx.crud.update(kept, { access_methods: ['kiosk', 'citrix', 'Web'] } as any, null, opts(ctx));
    assert.deepEqual((await row(ctx, kept)).access_methods, ['kiosk', 'citrix', 'web'], 'held values stay, a new one is added');
    await ctx.crud.update(kept, { access_methods: [] } as any, null, opts(ctx));
    assert.deepEqual((await row(ctx, kept)).access_methods, []);
  });
}

async function importCsv(ctx: Ctx, lines: string[]): Promise<CsvImportResult> {
  return ctx.csv.import(
    { buffer: Buffer.from(lines.join('\n') + '\n'), originalname: 'apps.csv' } as Express.Multer.File,
    { dryRun: true, operation: 'upsert' },
    { manager: ctx.runner.manager, tenantId: ctx.tenantId, access: { isAdmin: true, permissions: {} } },
  );
}

async function testImport() {
  await inTenant(async (ctx) => {
    const other = (await ctx.crud.create({ name: 'Bravo' } as any, null, opts(ctx))).id;
    const kept = await holder(ctx, 'Charlie', { category: 'mainframe', lifecycle: 'frozen', access_methods: ['kiosk'] });
    const result = await importCsv(ctx, [
      'id;name;category;lifecycle;access_methods',
      `;New one;Mainframe;Active;Web`,
      `${other};Bravo;Mainframe;Frozen;Kiosk`,
      `${kept};Charlie;Mainframe;Frozen;Kiosk, Web`,
      `;Echo;;;Citrix`,
    ]);
    const errors = result.errors.map((error) => [error.row, error.column, error.code]);
    assert.deepEqual(errors, [
      [2, 'category', 'catalog_value_retired'],
      [3, 'lifecycle', 'catalog_value_retired'],
      [3, 'category', 'catalog_value_retired'],
      [3, 'access_methods', 'catalog_value_retired'],
      [5, 'access_methods', 'access_method_invalid'],
    ].sort((a, b) => Number(a[0]) - Number(b[0])).map((error) => error), JSON.stringify(result.errors));
  });
}

async function testDeployments() {
  await inTenant(async (ctx) => {
    const app = (await ctx.crud.create({ name: 'Alpha' } as any, null, opts(ctx))).id;
    const scoped = { manager: ctx.runner.manager, tenantId: ctx.tenantId };
    let refused = await refusal(() => ctx.instances.create(app, { environment: 'prod', lifecycle: 'frozen' }, null, scoped));
    assert.equal(refused.code, 'catalog_value_retired', 'a new deployment cannot take a retired lifecycle');
    const prod = await ctx.instances.create(app, { environment: 'prod' }, null, scoped);
    refused = await refusal(() => ctx.instances.update(prod.id, { lifecycle: 'Frozen' }, null, scoped));
    assert.equal(refused.code, 'catalog_value_retired');
    await ctx.runner.query(`UPDATE app_instances SET lifecycle = 'frozen' WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, prod.id]);
    await ctx.instances.update(prod.id, { lifecycle: 'frozen', notes: 'Kept' }, null, scoped);
    const [stored] = await ctx.runner.query(`SELECT lifecycle FROM app_instances WHERE id = $1`, [prod.id]);
    assert.equal(stored.lifecycle, 'frozen', 'the deployment that holds it keeps it');
  });
}

runSpecs('application-catalog-values.integration.spec', [
  ['category', testCategory],
  ['lifecycle', testLifecycle],
  ['access methods', testAccessMethods],
  ['import', testImport],
  ['deployments', testDeployments],
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
