import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import type { CsvCallerAccess, CsvImportParams, CsvImportResult, ImportLookalikeChoice } from '../../common/csv';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Application } from '../application.entity';
import { ApplicationsCsvService } from '../applications-csv.service';
import { ApplicationsListService } from '../services/applications-list.service';

// Lot I3 of 26.11.9, pass 3a (T-I3d, T-I3j, T-I3k): a row of the applications import that would create
// an application and looks like one the person reads is left out by default, with "Create anyway" and
// "Update APP-n"; the update keeps the application's name, follows the file's mode, and is refused when
// the application changed since the check; the owners of a row that updates APP-n under another name
// reach APP-n. A row with a publisher and no supplier is linked to the supplier its publisher names,
// a match listed and undoable, never for a person who does not read the suppliers.

type Ctx = { runner: QueryRunner; tenantId: string; csv: ApplicationsCsvService; userEmail: string; userId: string };

const ADMIN: CsvCallerAccess = { isAdmin: true, permissions: {} };
const NO_SUPPLIERS: CsvCallerAccess = { isAdmin: false, permissions: { applications: 'admin' } };

async function inTenant(fn: (ctx: Ctx) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'i3a');
    const manager = runner.manager;
    const audit = new AuditService(manager.getRepository(AuditLog));
    const settings = new ItOpsSettingsService(manager.getRepository(Tenant), manager.getRepository(Location), audit);
    const resolver = new CsvResolverService();
    const csv = new ApplicationsCsvService(
      manager.getRepository(Application), null as any, null as any,
      new CsvExportService(resolver), new CsvImportService(resolver, new CsvJsonValidators()), resolver, audit,
      new ApplicationsListService(manager.getRepository(Application)), settings,
    );
    const roleId = randomUUID();
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'I3a', 'I3a', false, false, now(), now())`,
      [roleId, tenantId],
    );
    const userId = randomUUID();
    const userEmail = `owner-${tenantId.slice(0, 8)}@example.com`;
    await runner.query(
      `INSERT INTO users (id, tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status, created_at, updated_at)
       VALUES ($1, $2, 'Owner', 'Tester', $3, null, $4, false, 'enabled', now(), now())`,
      [userId, tenantId, userEmail, roleId],
    );
    await fn({ runner, tenantId, csv, userEmail, userId });
  });
}

async function app(ctx: Ctx, name: string, extra: { supplier?: string; editor?: string; description?: string } = {}): Promise<{ id: string; ref: string }> {
  const [row] = await ctx.runner.query(
    `INSERT INTO applications (tenant_id, name, supplier_id, editor, description) VALUES ($1, $2, $3, $4, $5) RETURNING id::text AS id, sequential_id`,
    [ctx.tenantId, name, extra.supplier ?? null, extra.editor ?? null, extra.description ?? null],
  );
  return { id: row.id, ref: row.sequential_id };
}

async function supplier(ctx: Ctx, name: string): Promise<string> {
  const [row] = await ctx.runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id::text AS id`, [ctx.tenantId, name]);
  return row.id;
}

async function importCsv(
  ctx: Ctx,
  lines: string[],
  params: Partial<CsvImportParams> = {},
  access: CsvCallerAccess = ADMIN,
): Promise<CsvImportResult> {
  return ctx.csv.import(
    { buffer: Buffer.from(lines.join('\n') + '\n'), originalname: 'apps.csv' } as Express.Multer.File,
    { dryRun: false, mode: 'enrich', operation: 'upsert', ...params },
    { manager: ctx.runner.manager, tenantId: ctx.tenantId, access },
  );
}

async function names(ctx: Ctx): Promise<string[]> {
  const rows = await ctx.runner.query(`SELECT name FROM applications WHERE tenant_id = $1 ORDER BY name`, [ctx.tenantId]);
  return rows.map((row: { name: string }) => row.name);
}

async function stored(ctx: Ctx, id: string): Promise<Record<string, any>> {
  const [row] = await ctx.runner.query(`SELECT name, description, supplier_id::text AS supplier_id, editor FROM applications WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, id]);
  return row;
}

/** The rule: the same name accents aside, or a close name with the same supplier or publisher; rows the name finds stay updates. */
async function testRule() {
  await inTenant(async (ctx) => {
    const cegid = await supplier(ctx, 'Cegid');
    const compta = await app(ctx, 'Comptabilité');
    const paie = await app(ctx, 'Cegid Paie Pro', { supplier: cegid });
    const crm = await app(ctx, 'Salesforce CRM', { editor: 'Salesforcé' });
    await app(ctx, 'Atlas');
    const result = await importCsv(ctx, [
      'name;supplier_name;editor',
      'Comptabilite;;',          // 2: accents aside
      'Cegid Paie Pros;Cegid;',  // 3: close name, same supplier
      'Salesforce CRMs;;salesforce', // 4: close name, same publisher accents aside
      'Cegid Paie Pros 2;;',     // 5: close name, no supplier or publisher in common: created
      'atlas;;',                 // 6: found by its name: an update
      'Comptabilite;;',          // 7: a second row of the file: not compared with row 2 (duplicate key)
    ], { dryRun: true });
    assert.deepEqual(result.errors.map((error) => [error.row, error.code]), [], 'a row of the file never looks like another one (row 7 left out as row 2)');
    const lookalikes = result.lookalikes!;
    assert.ok(lookalikes, 'the result lists the lookalikes');
    assert.deepEqual(lookalikes.lines.map((entry) => [entry.line, entry.target.ref, entry.reason, entry.outcome, entry.updatable]), [
      [2, compta.ref, 'name_accents', 'ignored', true],
      [3, paie.ref, 'close_name', 'ignored', true],
      [4, crm.ref, 'close_name', 'ignored', true],
      [7, compta.ref, 'name_accents', 'ignored', true],
    ]);
    assert.equal(lookalikes.lines[0].target.id, compta.id);
    assert.equal(lookalikes.lines[0].target.name, 'Comptabilité');
    assert.match(lookalikes.lines[0].target.state, /^[0-9a-f]{16}$/);
    assert.deepEqual([lookalikes.count, lookalikes.ignored, lookalikes.created, lookalikes.updated], [4, 4, 0, 0]);
    assert.deepEqual(lookalikes.targets['2'], { id: compta.id, state: lookalikes.lines[0].target.state });
    assert.deepEqual([result.inserted, result.updated + result.unchanged, result.skipped], [1, 1, 4], 'left out rows count as skipped, never as errors');

    // "Update only": nothing changes.
    const updateOnly = await importCsv(ctx, ['name', 'Comptabilite'], { dryRun: true, operation: 'update_only' });
    assert.equal(updateOnly.lookalikes, undefined);
    // "Add new only": the row is judged, but may not update an application.
    const insertOnly = await importCsv(ctx, ['name', 'Comptabilite'], { dryRun: true, operation: 'insert_only' });
    assert.deepEqual(insertOnly.lookalikes!.lines.map((entry) => [entry.outcome, entry.updatable]), [['ignored', false]]);
  });
}

/** The choices: left out by default and nothing written; created anyway; APP-n updated, name kept, the file's mode, the fields listed. */
async function testChoices() {
  await inTenant(async (ctx) => {
    const compta = await app(ctx, 'Comptabilité', { description: 'Ledger', editor: 'Sage' });
    const file = ['name;description;editor', 'Comptabilite;;Cegid'];
    let result = await importCsv(ctx, file);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual([result.inserted, result.updated, result.skipped], [0, 0, 1]);
    assert.deepEqual(await names(ctx), ['Comptabilité'], 'left out: nothing created');

    result = await importCsv(ctx, file, { lookalikes: [{ kind: 'lookalike', line: 2, action: 'create' }] });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual([result.inserted, result.lookalikes!.created], [1, 1]);
    assert.deepEqual(await names(ctx), ['Comptabilite', 'Comptabilité']);
    await ctx.runner.query(`DELETE FROM applications WHERE tenant_id = $1 AND name = 'Comptabilite'`, [ctx.tenantId]);

    // "Update APP-n": the check lists the fields that change; the load keeps the name and, in "complete", the blank description.
    const check = await importCsv(ctx, file, { dryRun: true, lookalikes: [{ kind: 'lookalike', line: 2, action: 'update', id: compta.id }] });
    const entry = check.lookalikes!.lines[0];
    assert.deepEqual([entry.outcome, entry.fields], ['updated', ['editor']]);
    assert.deepEqual([check.inserted, check.updated], [0, 1]);
    result = await importCsv(ctx, file, { lookalikes: check.lookalikes!.choices });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual(await stored(ctx, compta.id), { name: 'Comptabilité', description: 'Ledger', supplier_id: null, editor: 'Cegid' });

    // Full replace: the blank description is cleared.
    result = await importCsv(ctx, file, { mode: 'replace', lookalikes: [{ kind: 'lookalike', line: 2, action: 'update', id: compta.id }] });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal((await stored(ctx, compta.id)).description, null);

    // For all rows: "Update all" with the targets of the check shown.
    const shown = await importCsv(ctx, ['name;editor', 'Comptabilite;Sage'], { dryRun: true });
    result = await importCsv(ctx, ['name;editor', 'Comptabilite;Sage'], { lookalikes: [{ kind: 'lookalikes', action: 'update', targets: shown.lookalikes!.targets }] });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual([result.updated, (await stored(ctx, compta.id)).editor], [1, 'Sage']);
  });
}

/** The update is refused when APP-n changed since the check: the row is named and nothing is imported. */
async function testChangedSinceTheCheck() {
  await inTenant(async (ctx) => {
    const compta = await app(ctx, 'Comptabilité');
    const file = ['name;editor', 'Comptabilite;Cegid', 'Nouvelle;'];
    const check = await importCsv(ctx, file, { dryRun: true, lookalikes: [{ kind: 'lookalike', line: 2, action: 'update', id: compta.id }] });
    const choices = check.lookalikes!.choices;
    assert.ok(choices.some((choice) => choice.kind === 'lookalike' && choice.action === 'update' && choice.state === check.lookalikes!.lines[0].target.state));
    await ctx.runner.query(`UPDATE applications SET description = 'edited', updated_at = now() + interval '1 second' WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, compta.id]);
    const result = await importCsv(ctx, file, { lookalikes: choices });
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors.map((error) => [error.row, error.code, error.params?.ref]), [[2, 'CSV_LOOKALIKE_CHANGED', compta.ref]]);
    assert.deepEqual(await names(ctx), ['Comptabilité'], 'nothing imported, the new row neither');
    assert.equal((await stored(ctx, compta.id)).editor, null);

    // Left out at the check, left out at the load, even when the application was renamed since (targets kept).
    const shown = await importCsv(ctx, ['name', 'Comptabilite'], { dryRun: true });
    await ctx.runner.query(`UPDATE applications SET name = 'Grand livre' WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, compta.id]);
    const load = await importCsv(ctx, ['name', 'Comptabilite'], { lookalikes: shown.lookalikes!.choices });
    assert.deepEqual([load.inserted, load.skipped], [0, 1]);
    assert.deepEqual(await names(ctx), ['Grand livre']);
  });
}

/** Two rows, one application: the row the name finds updates it; a row that would update it too is left out, and said. */
async function testOneApplicationTwoRows() {
  await inTenant(async (ctx) => {
    const compta = await app(ctx, 'Comptabilité');
    const update: ImportLookalikeChoice = { kind: 'lookalike', line: 3, action: 'update', id: compta.id };
    const result = await importCsv(ctx, ['name;editor', 'comptabilité;Sage', 'Comptabilite;Cegid'], { dryRun: true, lookalikes: [update] });
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings.map((warning) => [warning.row, warning.code, warning.params]), [[3, 'CSV_LOOKALIKE_SAME_RECORD', { ref: compta.ref, other: 2 }]]);
    assert.deepEqual(result.lookalikes!.lines.map((entry) => entry.outcome), ['ignored']);
  });
}

/** The owners of a row that updates APP-n under another name reach APP-n (the name finds nothing). */
async function testOwnersOfAnUpdateUnderAnotherName() {
  await inTenant(async (ctx) => {
    const compta = await app(ctx, 'Comptabilité');
    const result = await importCsv(ctx, ['name;it_owner_email_1;data_residency', `Comptabilite;${ctx.userEmail};FR`], {
      lookalikes: [{ kind: 'lookalike', line: 2, action: 'update', id: compta.id }],
    });
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const owners = await ctx.runner.query(`SELECT owner_type, user_id::text AS user_id FROM application_owners WHERE tenant_id = $1 AND application_id = $2`, [ctx.tenantId, compta.id]);
    assert.deepEqual(owners, [{ owner_type: 'it', user_id: ctx.userId }]);
    const residency = await ctx.runner.query(`SELECT country_iso FROM application_data_residency WHERE tenant_id = $1 AND application_id = $2`, [ctx.tenantId, compta.id]);
    assert.deepEqual(residency, [{ country_iso: 'FR' }]);
  });
}

/** The publisher proposes the supplier (T-I3k): listed, undoable, a stored supplier kept in "complete", nothing without the right. */
async function testPublisherProposesTheSupplier() {
  await inTenant(async (ctx) => {
    const cegid = await supplier(ctx, 'Cégid');
    const sage = await supplier(ctx, 'Sage');
    let result = await importCsv(ctx, ['name;editor', 'Atlas;cegid', 'Orion;Unknown']);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    const [atlas] = await ctx.runner.query(`SELECT id::text AS id, supplier_id::text AS supplier_id, editor FROM applications WHERE tenant_id = $1 AND name = 'Atlas'`, [ctx.tenantId]);
    assert.deepEqual([atlas.supplier_id, atlas.editor], [cegid, 'cegid'], 'linked, the publisher kept as written');
    const [ref] = await ctx.runner.query(`SELECT 'SUP-' || item_number AS ref FROM suppliers WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, cegid]);
    assert.deepEqual(result.matches!.map((match) => [match.column, match.value, match.target, match.ref, match.origin, match.lines, match.undoable]), [
      ['supplier_name', 'cegid', 'Cégid', ref.ref, 'editor', [2], true],
    ]);

    // Undone: no link.
    result = await importCsv(ctx, ['name;editor', 'Vega;cegid'], { unmatched: [{ column: 'supplier_name', value: 'cegid' }] });
    const [vega] = await ctx.runner.query(`SELECT supplier_id FROM applications WHERE tenant_id = $1 AND name = 'Vega'`, [ctx.tenantId]);
    assert.deepEqual([vega.supplier_id, result.matches], [null, undefined]);

    // A row that names its supplier keeps it.
    result = await importCsv(ctx, ['name;supplier_name;editor', 'Lyra;Sage;Cegid']);
    const [lyra] = await ctx.runner.query(`SELECT supplier_id::text AS supplier_id FROM applications WHERE tenant_id = $1 AND name = 'Lyra'`, [ctx.tenantId]);
    assert.deepEqual([lyra.supplier_id, result.matches], [sage, undefined]);

    // "Complete" keeps a stored supplier; full replace takes the publisher's for a blank supplier cell.
    result = await importCsv(ctx, ['name;supplier_name;editor', 'Lyra;;Cegid']);
    assert.equal((await stored(ctx, (await ctx.runner.query(`SELECT id::text AS id FROM applications WHERE tenant_id = $1 AND name = 'Lyra'`, [ctx.tenantId]))[0].id)).supplier_id, sage);
    assert.equal(result.matches, undefined);
    result = await importCsv(ctx, ['name;supplier_name;editor', 'Lyra;;Cegid'], { mode: 'replace' });
    const [after] = await ctx.runner.query(`SELECT supplier_id::text AS supplier_id FROM applications WHERE tenant_id = $1 AND name = 'Lyra'`, [ctx.tenantId]);
    assert.equal(after.supplier_id, cegid);

    // Without the right to read the suppliers, nothing happens.
    result = await importCsv(ctx, ['name;editor', 'Nova;Cegid'], {}, NO_SUPPLIERS);
    const [nova] = await ctx.runner.query(`SELECT supplier_id FROM applications WHERE tenant_id = $1 AND name = 'Nova'`, [ctx.tenantId]);
    assert.deepEqual([nova.supplier_id, result.matches], [null, undefined]);
  });
}

void runSpecs('application-lookalikes.integration', [
  ['the rule', testRule],
  ['the choices', testChoices],
  ['changed since the check', testChangedSinceTheCheck],
  ['one application, two rows', testOneApplicationTwoRows],
  ['owners of an update under another name', testOwnersOfAnUpdateUnderAnotherName],
  ['the publisher proposes the supplier', testPublisherProposesTheSupplier],
]);
