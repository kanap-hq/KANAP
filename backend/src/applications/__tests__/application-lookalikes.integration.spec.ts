import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { CsvExportService } from '../../common/csv/csv-export.service';
import { CsvImportService } from '../../common/csv/csv-import.service';
import { CsvJsonValidators } from '../../common/csv/csv-json-validators';
import { CsvResolverService } from '../../common/csv/csv-resolver.service';
import type { CsvCallerAccess, CsvImportParams, CsvImportResult, ImportLookalikeChoice } from '../../common/csv';
import { csvLookalikes } from '../../common/csv/csv-lookalikes';
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
  encoding: BufferEncoding = 'utf8',
): Promise<CsvImportResult> {
  return ctx.csv.import(
    { buffer: Buffer.from(lines.join('\n') + '\n', encoding), originalname: 'apps.csv' } as Express.Multer.File,
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
      'Comptabilite;;',          // 7: a second row of the file: not compared with row 2, refused as its duplicate
    ], { dryRun: true });
    assert.deepEqual(result.errors.map((error) => [error.row, error.code]), [[7, 'CSV_DUPLICATE_KEY']], 'a row left out still counts in the file\'s duplicates');
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
    // A refusal of the whole row names no column (correctifs I).
    assert.deepEqual(result.errors.map((error) => [error.row, error.code, error.params?.ref, error.column]), [[2, 'CSV_LOOKALIKE_CHANGED', compta.ref, undefined]]);
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

/**
 * A target gone since the check (the fusion of passes 3a and 3b): the row keeps it, with an empty
 * reference, name and state, may not update it (the update chosen before is refused), and the check
 * after leaves it out. The choices the check gives back,
 * and "Update all" with its targets, are read again by the route: never refused for the empty state.
 */
async function testGoneTarget() {
  await inTenant(async (ctx) => {
    const compta = await app(ctx, 'Comptabilité');
    const file = ['name;editor', 'Comptabilite;Cegid'];
    const first = await importCsv(ctx, file, { dryRun: true, lookalikes: [{ kind: 'lookalike', line: 2, action: 'update', id: compta.id }] });
    await ctx.runner.query(`DELETE FROM applications WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, compta.id]);
    const check = await importCsv(ctx, file, { dryRun: true, lookalikes: csvLookalikes(JSON.stringify(first.lookalikes!.choices)) });
    const entry = check.lookalikes!.lines[0];
    assert.deepEqual([entry.target, entry.reason, entry.outcome, entry.updatable], [{ id: compta.id, ref: '', name: '', state: '' }, undefined, 'ignored', false]);
    // The update chosen on the first check is refused; the choices given back leave the row out (review 3, C2).
    assert.deepEqual(check.errors.map((error) => [error.row, error.code, error.column]), [[2, 'CSV_LOOKALIKE_GONE', undefined]]);
    // What the screen sends at the load, and on "Update all": read without a 400.
    const followed = csvLookalikes(JSON.stringify(check.lookalikes!.choices));
    csvLookalikes(JSON.stringify([{ kind: 'lookalikes', action: 'update', targets: check.lookalikes!.targets }]));
    const load = await importCsv(ctx, file, { lookalikes: followed });
    assert.equal(load.ok, true, JSON.stringify(load.errors));
    assert.deepEqual([load.inserted, load.updated, load.skipped], [0, 0, 1], 'left out at the check, left out at the load');
    assert.deepEqual(await names(ctx), []);
  });
}

/** The rows a row of the file names, by its id: the application and its description. */
async function described(ctx: Ctx, id: string): Promise<{ name: string; description: string | null } | null> {
  const [row] = await ctx.runner.query(`SELECT name, description FROM applications WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, id]);
  return row ?? null;
}

/**
 * Review 3, C1: a row the check listed follows the choice made on it, even when its name now finds an
 * application. "Update APP-1" never updates another one: an application created since under the row's
 * name refuses the row, and nothing is imported; checking again makes it an update of that one. A row
 * left out writes nothing and stays left out (review 4, C1, T-I3l).
 */
async function testNameFindsAnApplicationSinceTheCheck() {
  await inTenant(async (ctx) => {
    const compta = await app(ctx, 'Comptabilité', { description: 'ancienne' });
    const file = ['name;description', 'Comptabilite;écrite par le fichier', 'Nouvelle;'];
    const check = await importCsv(ctx, file, { dryRun: true, lookalikes: [{ kind: 'lookalike', line: 2, action: 'update', id: compta.id }] });
    assert.deepEqual([check.ok, check.updated], [true, 1]);
    const followed = csvLookalikes(JSON.stringify(check.lookalikes!.choices));
    const other = await app(ctx, 'Comptabilite', { description: 'autre application' });
    const load = await importCsv(ctx, file, { lookalikes: followed });
    assert.equal(load.ok, false);
    assert.deepEqual(load.errors.map((error) => [error.row, error.code, error.params?.ref, error.column]), [[2, 'CSV_LOOKALIKE_NAME_FOUND', other.ref, undefined]]);
    assert.deepEqual(await described(ctx, compta.id), { name: 'Comptabilité', description: 'ancienne' });
    assert.deepEqual(await described(ctx, other.id), { name: 'Comptabilite', description: 'autre application' });
    assert.deepEqual(await names(ctx), ['Comptabilite', 'Comptabilité'], 'nothing imported, the new row neither');
    // Checking again with what the refusal gave back: the row is an update of the application its name finds.
    const again = await importCsv(ctx, file, { dryRun: true, lookalikes: csvLookalikes(JSON.stringify(load.lookalikes?.choices ?? [])) });
    assert.deepEqual([again.ok, again.updated, again.inserted, again.lookalikes?.count], [true, 1, 1, 0], JSON.stringify(again.errors));

    // A row left out at the check writes nothing: it stays left out, never refused (review 4, C1).
    await ctx.runner.query(`DELETE FROM applications WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, other.id]);
    const leftOut = await importCsv(ctx, ['name', 'Comptabilite'], { dryRun: true });
    assert.deepEqual(leftOut.lookalikes!.lines.map((entry) => [entry.target.ref, entry.outcome]), [[compta.ref, 'ignored']]);
    const third = await app(ctx, 'COMPTABILITE');
    const kept = await importCsv(ctx, ['name', 'Comptabilite'], { lookalikes: leftOut.lookalikes!.choices });
    assert.deepEqual([kept.ok, kept.inserted, kept.updated, kept.skipped], [true, 0, 0, 1], JSON.stringify(kept.errors));
    assert.deepEqual(await described(ctx, third.id), { name: 'COMPTABILITE', description: null });
  });
}

/** Review 3, C1 variant: APP-1 renamed to the row's name, then edited, since the check: refused, APP-1 untouched. */
async function testRenamedToTheRowsNameAndEdited() {
  await inTenant(async (ctx) => {
    const compta = await app(ctx, 'Comptabilité', { description: 'ancienne' });
    const file = ['name;description', 'Comptabilite;écrite par le fichier'];
    const check = await importCsv(ctx, file, { dryRun: true, lookalikes: [{ kind: 'lookalike', line: 2, action: 'update', id: compta.id }] });
    const followed = csvLookalikes(JSON.stringify(check.lookalikes!.choices));
    await ctx.runner.query(
      `UPDATE applications SET name = 'Comptabilite', description = 'saisie entre-temps', updated_at = now() + interval '1 second' WHERE tenant_id = $1 AND id = $2`,
      [ctx.tenantId, compta.id],
    );
    const load = await importCsv(ctx, file, { lookalikes: followed });
    assert.equal(load.ok, false);
    assert.deepEqual(load.errors.map((error) => [error.row, error.code, error.params?.ref]), [[2, 'CSV_LOOKALIKE_CHANGED', compta.ref]]);
    assert.deepEqual(await described(ctx, compta.id), { name: 'Comptabilite', description: 'saisie entre-temps' });
  });
}

/**
 * Review 3, C2: APP-1 deleted between the check and the load, with no check in between: the row is
 * refused and nothing is imported, for "Update APP-1" and for "Update all" alike.
 */
async function testGoneBeforeTheLoad() {
  await inTenant(async (ctx) => {
    const file = ['name;description', 'Comptabilite;nouvelle description', 'Nouvelle;'];
    for (const all of [false, true]) {
      const compta = await app(ctx, 'Comptabilité');
      const shown = await importCsv(ctx, file, { dryRun: true });
      const chosen: ImportLookalikeChoice[] = all
        ? [{ kind: 'lookalikes', action: 'update', targets: shown.lookalikes!.targets }]
        : [{ kind: 'lookalike', line: 2, action: 'update', id: compta.id, state: shown.lookalikes!.lines[0].target.state }];
      const check = await importCsv(ctx, file, { dryRun: true, lookalikes: chosen });
      assert.deepEqual([check.ok, check.updated], [true, 1]);
      await ctx.runner.query(`DELETE FROM applications WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, compta.id]);
      const load = await importCsv(ctx, file, { lookalikes: csvLookalikes(JSON.stringify(check.lookalikes!.choices)) });
      assert.equal(load.ok, false, all ? 'update all' : 'update APP-1');
      assert.deepEqual(load.errors.map((error) => [error.row, error.code]), [[2, 'CSV_LOOKALIKE_GONE']]);
      assert.deepEqual(await names(ctx), [], 'nothing imported, the new row neither');
    }
  });
}

/**
 * Review 3, C3: a row left out is neither read nor written, and still counts in the file's duplicates.
 * Its owners and data residency never reach another row's application: the owners and residency follow
 * the application each row writes, by its id.
 */
async function testLeftOutRowsCountAsDuplicates() {
  await inTenant(async (ctx) => {
    await app(ctx, 'Comptabilité');
    const other = await app(ctx, 'Paie');
    const file = ['name;it_owner_email_1;data_residency', `Comptabilite;${ctx.userEmail};FR`, 'COMPTABILITE;;'];
    for (const choice of [{ kind: 'lookalike', line: 3, action: 'create' }, { kind: 'lookalike', line: 3, action: 'update', id: other.id }] as ImportLookalikeChoice[]) {
      const check = await importCsv(ctx, file, { dryRun: true, lookalikes: [choice] });
      assert.deepEqual(check.errors.map((error) => [error.row, error.code]), [[3, 'CSV_DUPLICATE_KEY']], choice.action);
      const load = await importCsv(ctx, file, { lookalikes: [choice] });
      assert.equal(load.ok, false);
      assert.deepEqual(await names(ctx), ['Comptabilité', 'Paie']);
    }
    const owners = await ctx.runner.query(`SELECT count(*)::int AS n FROM application_owners WHERE tenant_id = $1`, [ctx.tenantId]);
    const residency = await ctx.runner.query(`SELECT count(*)::int AS n FROM application_data_residency WHERE tenant_id = $1`, [ctx.tenantId]);
    assert.deepEqual([owners[0].n, residency[0].n], [0, 0]);

    // A row left out and a row created anyway, under other names: each row's owners and residency on its own
    // application only. A file Excel saved as plain CSV (Windows-1252, latin1 for "è"): the owners and the
    // residency are the cells the import read, never the file read a second time.
    const created = await importCsv(ctx, ['name;it_owner_email_1;data_residency', `Comptabilite;${ctx.userEmail};FR`, 'Comptabilitè;;DE'], {
      lookalikes: [{ kind: 'lookalike', line: 3, action: 'create' }],
    }, ADMIN, 'latin1');
    assert.equal(created.ok, true, JSON.stringify(created.errors));
    assert.deepEqual([created.inserted, created.lookalikes!.created, created.lookalikes!.ignored], [1, 1, 1]);
    const written = await ctx.runner.query(
      `SELECT a.name, (SELECT count(*)::int FROM application_owners o WHERE o.tenant_id = a.tenant_id AND o.application_id = a.id) AS owners,
              (SELECT string_agg(r.country_iso, ',') FROM application_data_residency r WHERE r.tenant_id = a.tenant_id AND r.application_id = a.id) AS residency
         FROM applications a WHERE a.tenant_id = $1`,
      [ctx.tenantId],
    );
    const byName = Object.fromEntries(written.map((row: { name: string; owners: number; residency: string | null }) => [row.name, [row.owners, row.residency]]));
    assert.deepEqual(byName, { 'Comptabilité': [0, null], 'Comptabilitè': [0, 'DE'], Paie: [0, null] });
  });
}

/** Review 3, C6: the state of APP-n covers its owners and data residency: a change of either since the check refuses the row. */
async function testOwnersOrResidencyChangedSinceTheCheck() {
  await inTenant(async (ctx) => {
    const compta = await app(ctx, 'Comptabilité');
    const file = ['name;description', 'Comptabilite;nouvelle description'];
    const changes = [
      `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, '${ctx.userId}', 'it')`,
      `INSERT INTO application_data_residency (tenant_id, application_id, country_iso) VALUES ($1, $2, 'FR')`,
    ];
    for (const change of changes) {
      const check = await importCsv(ctx, file, { dryRun: true, lookalikes: [{ kind: 'lookalike', line: 2, action: 'update', id: compta.id }] });
      await ctx.runner.query(change, [ctx.tenantId, compta.id]);
      const load = await importCsv(ctx, file, { lookalikes: csvLookalikes(JSON.stringify(check.lookalikes!.choices)) });
      assert.deepEqual(load.errors.map((error) => [error.row, error.code, error.params?.ref]), [[2, 'CSV_LOOKALIKE_CHANGED', compta.ref]], change);
      assert.equal((await described(ctx, compta.id))!.description, null);
    }
  });
}

/** The applications of the tenant with their owners and data residency counted. */
async function written(ctx: Ctx): Promise<Record<string, [string | null, number, string | null]>> {
  const rows = await ctx.runner.query(
    `SELECT a.name, a.description, (SELECT count(*)::int FROM application_owners o WHERE o.tenant_id = a.tenant_id AND o.application_id = a.id) AS owners,
            (SELECT string_agg(r.country_iso, ',') FROM application_data_residency r WHERE r.tenant_id = a.tenant_id AND r.application_id = a.id) AS residency
       FROM applications a WHERE a.tenant_id = $1`,
    [ctx.tenantId],
  );
  return Object.fromEntries(rows.map((row: any) => [row.name, [row.description, row.owners, row.residency]]));
}

/**
 * Review 4, C1 (T-I3l: the refusal holds only for a row that would write). A row left out at the check,
 * by default or by "Leave out", whose name finds an application since (one created under that name, or
 * its target renamed to it) stays left out, and the rest of the file loads (P1a to P1c). Checking again
 * with the choices given back keeps it left out: it never becomes an update of that application (P1d).
 */
async function testLeftOutStaysLeftOut() {
  for (const variant of ['default', 'leave out', 'renamed'] as const) {
    await inTenant(async (ctx) => {
      const compta = await app(ctx, 'Comptabilité');
      const file = ['name;description;it_owner_email_1;data_residency', 'Comptabilite;écrite par le fichier;;', `Nouvelle;neuve;${ctx.userEmail};FR`];
      const chosen: ImportLookalikeChoice[] = variant === 'leave out' ? [{ kind: 'lookalike', line: 2, action: 'ignore' }] : [];
      const check = await importCsv(ctx, file, { dryRun: true, lookalikes: chosen });
      assert.deepEqual(check.lookalikes!.lines.map((entry) => [entry.line, entry.outcome]), [[2, 'ignored']], variant);
      const followed = csvLookalikes(JSON.stringify(check.lookalikes!.choices));
      if (variant === 'renamed') {
        await ctx.runner.query(`UPDATE applications SET name = 'Comptabilite', updated_at = now() + interval '1 second' WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, compta.id]);
      } else await app(ctx, 'Comptabilite', { description: 'créée entre-temps' });
      const again = await importCsv(ctx, file, { dryRun: true, lookalikes: followed });
      assert.deepEqual([again.ok, again.inserted, again.updated, again.skipped], [true, 1, 0, 1], `${variant}, checked again: ${JSON.stringify(again.errors)}`);
      const load = await importCsv(ctx, file, { lookalikes: csvLookalikes(JSON.stringify(again.lookalikes!.choices)) });
      assert.equal(load.ok, true, `${variant}: ${JSON.stringify(load.errors)}`);
      assert.deepEqual([load.inserted, load.updated, load.skipped], [1, 0, 1], variant);
      assert.deepEqual(load.lookalikes!.lines.map((entry) => [entry.line, entry.target.ref, entry.outcome]), [[2, compta.ref, 'ignored']], variant);
      assert.deepEqual(await written(ctx), {
        Comptabilite: [variant === 'renamed' ? null : 'créée entre-temps', 0, null],
        ...(variant === 'renamed' ? {} : { 'Comptabilité': [null, 0, null] }),
        Nouvelle: ['neuve', 1, 'FR'],
      }, variant);
    });
  }
}

/**
 * Review 4, C1 variant (P5): in "add new only", "Create anyway" whose name finds an application since is
 * skipped by the operation, as the same row without a choice: never refused. In "add and update", the
 * same row would update that application: refused, nothing imported.
 */
async function testCreateAnywayNameTakenSinceTheCheck() {
  for (const operation of ['insert_only', 'upsert'] as const) {
    await inTenant(async (ctx) => {
      await app(ctx, 'Comptabilité');
      const file = ['name;description', 'Comptabilite;écrite par le fichier', 'Nouvelle;neuve'];
      const check = await importCsv(ctx, file, { dryRun: true, operation, lookalikes: [{ kind: 'lookalike', line: 2, action: 'create' }] });
      assert.deepEqual([check.inserted, check.lookalikes!.created], [2, 1], operation);
      const other = await app(ctx, 'Comptabilite', { description: 'créée entre-temps' });
      const load = await importCsv(ctx, file, { operation, lookalikes: csvLookalikes(JSON.stringify(check.lookalikes!.choices)) });
      if (operation === 'insert_only') {
        assert.equal(load.ok, true, JSON.stringify(load.errors));
        assert.deepEqual([load.inserted, load.updated, load.skipped], [1, 0, 1]);
      } else {
        assert.deepEqual(load.errors.map((error) => [error.row, error.code, error.params?.ref]), [[2, 'CSV_LOOKALIKE_NAME_FOUND', other.ref]]);
      }
      assert.equal((await described(ctx, other.id))!.description, 'créée entre-temps', operation);
      assert.deepEqual(Object.keys(await written(ctx)).sort(), operation === 'insert_only'
        ? ['Comptabilite', 'Comptabilité', 'Nouvelle']
        : ['Comptabilite', 'Comptabilité'], operation);
    });
  }
}

/**
 * Review 4, C6: a row the check would create, that looks like an application created since, is refused
 * at the load and nothing is imported, whether the check listed other lookalikes or none. A check run
 * since lists it, left out by default, and the load that follows that check goes through.
 */
async function testLooksLikeAnApplicationSinceTheCheck() {
  await inTenant(async (ctx) => {
    const compta = await app(ctx, 'Comptabilité');
    const file = ['name;description', 'Comptabilite;', 'Paie;neuve', 'Nouvelle;neuve'];
    const check = await importCsv(ctx, file, { dryRun: true });
    assert.deepEqual([check.inserted, check.skipped], [2, 1]);
    const followed = csvLookalikes(JSON.stringify(check.lookalikes!.choices));
    const paie = await app(ctx, 'Paié');
    const load = await importCsv(ctx, file, { lookalikes: followed });
    assert.equal(load.ok, false);
    assert.deepEqual(load.errors.map((error) => [error.row, error.code, error.params?.ref, error.column]), [[3, 'CSV_LOOKALIKE_NEW', paie.ref, undefined]]);
    assert.deepEqual(Object.keys(await written(ctx)).sort(), ['Comptabilité', 'Paié'], 'nothing imported');
    // The check after it shows the row left out, with its application, and its load goes through.
    for (const sent of [followed, csvLookalikes(JSON.stringify(load.lookalikes!.choices))]) {
      const again = await importCsv(ctx, file, { dryRun: true, lookalikes: sent });
      assert.equal(again.ok, true, JSON.stringify(again.errors));
      assert.deepEqual(again.lookalikes!.lines.map((entry) => [entry.line, entry.target.ref, entry.outcome]), [[2, compta.ref, 'ignored'], [3, paie.ref, 'ignored']]);
    }
    const again = await importCsv(ctx, file, { dryRun: true, lookalikes: csvLookalikes(JSON.stringify(load.lookalikes!.choices)) });
    const second = await importCsv(ctx, file, { lookalikes: csvLookalikes(JSON.stringify(again.lookalikes!.choices)) });
    assert.deepEqual([second.ok, second.inserted, second.skipped], [true, 1, 2], JSON.stringify(second.errors));
  });
  // A check that listed no lookalike: its choices are given back all the same, and the load refuses the row.
  await inTenant(async (ctx) => {
    const check = await importCsv(ctx, ['name', 'Paie'], { dryRun: true });
    assert.deepEqual([check.inserted, check.lookalikes?.count], [1, 0]);
    const paie = await app(ctx, 'Paié');
    const load = await importCsv(ctx, ['name', 'Paie'], { lookalikes: csvLookalikes(JSON.stringify(check.lookalikes?.choices ?? [])) });
    assert.deepEqual(load.errors.map((error) => [error.row, error.code, error.params?.ref]), [[2, 'CSV_LOOKALIKE_NEW', paie.ref]]);
    // "Create anyway" for all rows: the row the check created is created, as the check said.
    const all = await importCsv(ctx, ['name', 'Paie'], { lookalikes: [{ kind: 'lookalikes', action: 'create', targets: {} }] });
    assert.deepEqual([all.ok, all.inserted], [true, 1], JSON.stringify(all.errors));
  });
}

/** Review 4, C5: "Update" without the state of the check is not a valid choice, for one row or for all of them. */
async function testUpdateWithoutStateIsRefused() {
  const id = randomUUID();
  for (const bad of [[{ kind: 'lookalikes', action: 'update' }], [{ kind: 'lookalike', line: 2, action: 'update', id }]]) {
    assert.throws(() => csvLookalikes(JSON.stringify(bad)), /not valid/, JSON.stringify(bad));
  }
  assert.deepEqual(csvLookalikes(JSON.stringify([{ kind: 'lookalikes', action: 'update', targets: {} }, { kind: 'lookalike', line: 2, action: 'update', id, state: '0123456789abcdef' }])), [
    { kind: 'lookalikes', action: 'update', targets: {} },
    { kind: 'lookalike', line: 2, action: 'update', id, state: '0123456789abcdef' },
  ]);
  for (const action of ['ignore', 'create']) assert.equal(csvLookalikes(JSON.stringify([{ kind: 'lookalikes', action }])).length, 1);
}

void runSpecs('application-lookalikes.integration', [
  ['the rule', testRule],
  ['the choices', testChoices],
  ['changed since the check', testChangedSinceTheCheck],
  ['one application, two rows', testOneApplicationTwoRows],
  ['owners of an update under another name', testOwnersOfAnUpdateUnderAnotherName],
  ['the publisher proposes the supplier', testPublisherProposesTheSupplier],
  ['a target gone since the check', testGoneTarget],
  ['the name finds an application since the check', testNameFindsAnApplicationSinceTheCheck],
  ['renamed to the row\'s name and edited since the check', testRenamedToTheRowsNameAndEdited],
  ['the target gone before the load', testGoneBeforeTheLoad],
  ['rows left out count as duplicates', testLeftOutRowsCountAsDuplicates],
  ['owners or residency changed since the check', testOwnersOrResidencyChangedSinceTheCheck],
  ['a row left out stays left out when its name finds an application since', testLeftOutStaysLeftOut],
  ['"Create anyway" whose name is taken since the check', testCreateAnywayNameTakenSinceTheCheck],
  ['a row that looks like an application since the check', testLooksLikeAnApplicationSinceTheCheck],
  ['"Update" without the state of the check', testUpdateWithoutStateIsRefused],
]);
