// @database-spec
import 'reflect-metadata';
import type { QueryRunner } from 'typeorm';
import { DEFAULT_HOSTING_TYPES, DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { TechnologyCatalogService } from '../catalog/technology-catalog.service';
import { OperatingSystemService } from '../operating-system.service';
import { TechnologiesController } from '../technologies.controller';
import { TechnologyLinksCsvService, type TechnologyLinksCsvContext } from '../technology-links-csv.service';
import { TechnologyLinksService } from '../technology-links.service';
import { TechnologyReachService } from '../technology-reach.service';
import { application, asset, installed, technology } from './technologies.fixtures';

// The two link files under the clearing rule of every import route (D21 and T-I4g of 26.11.9): a
// blank note keeps the link's note, `-` clears it, counted in `cleared`; `-` on a key column, the
// version or the operating system refuses the row. The links themselves are only ever added. The
// routes call the service with the rule.

const HEADER = 'asset_reference,asset_name,technology_reference,technology_name,version,operating_system,notes,source';
const APP_HEADER = 'application_reference,application_name,technology_reference,technology_name,version,notes,source';

function csvService() {
  const audit = { log: async () => undefined };
  const itOps = {
    getSettings: async () => ({
      technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES,
      hostingTypes: DEFAULT_HOSTING_TYPES,
      lifecycleStates: [{ code: 'active' }, { code: 'retired' }],
      cyberCriticalityLevels: [{ code: 'high' }],
      recoveryWaves: [{ code: 'wave_1' }],
    }),
  };
  const links = new TechnologyLinksService(audit as any, new TechnologyReachService(), itOps as any);
  const os = new OperatingSystemService(audit as any, itOps as any, new TechnologyCatalogService(audit as any, itOps as any));
  return new TechnologyLinksCsvService(links, os);
}

function caller(runner: QueryRunner, tenantId: string): TechnologyLinksCsvContext {
  return { manager: runner.manager, tenantId, userId: null };
}

function csvFile(header: string, lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from([header, ...lines].join('\n'), 'utf8'), originalname: 'links.csv' } as Express.Multer.File;
}

async function notesOf(runner: QueryRunner, table: string, id: string): Promise<string | null> {
  const [row] = await runner.query(`SELECT notes FROM ${table} WHERE id = $1`, [id]);
  return row.notes;
}

async function testServerLinkNote() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'links-clear');
    const srv = await asset(runner, tenantId, 'Srv');
    const sql = await technology(runner, tenantId, 2, 'SQL Server');
    const link = await installed(runner, tenantId, srv, sql, null, 'manual');
    await runner.query(`UPDATE asset_technologies SET notes = 'Cluster node' WHERE id = $1`, [link]);
    const csv = csvService();
    const ctx = caller(runner, tenantId);
    const run = (notes: string, dryRun: boolean) => csv.importAssetLinks({ file: csvFile(HEADER, [`,Srv,,SQL Server,,,${notes},`]), dryRun, language: 'en', mode: 'enrich' }, ctx);

    const blank = await run('', false);
    assert.deepEqual([blank.ok, blank.unchanged, blank.cleared], [true, 1, 0]);
    assert.equal(await notesOf(runner, 'asset_technologies', link), 'Cluster node', 'a blank note keeps the note');

    const check = await run('-', true);
    assert.deepEqual([check.ok, check.updated, check.cleared], [true, 1, 1], JSON.stringify(check.errors));
    assert.equal(await notesOf(runner, 'asset_technologies', link), 'Cluster node', 'the check writes nothing');
    const done = await run('-', false);
    assert.deepEqual([done.updated, done.cleared], [1, 1]);
    assert.equal(await notesOf(runner, 'asset_technologies', link), null, '`-` clears the note');
    const [{ source }] = await runner.query(`SELECT source FROM asset_technologies WHERE id = $1`, [link]);
    assert.equal(source, 'manual', 'the link keeps its provenance');

    const again = await run('-', true);
    assert.deepEqual([again.unchanged, again.cleared], [1, 0], 'nothing left to clear');

    // `-` on a new link is a blank note.
    await technology(runner, tenantId, 3, 'Tomcat');
    const fresh = await csv.importAssetLinks({ file: csvFile(HEADER, [',Srv,,Tomcat,,,-,']), dryRun: false, language: 'en', mode: 'enrich' }, ctx);
    assert.deepEqual([fresh.ok, fresh.inserted, fresh.cleared], [true, 1, 0]);

    const refused = await csv.importAssetLinks({
      file: csvFile(HEADER, [',-,,SQL Server,,,,', ',Srv,,-,,,,', ',Srv,,SQL Server,-,,,', ',Srv,,SQL Server,,-,,']),
      dryRun: true, language: 'en', mode: 'enrich',
    }, ctx);
    assert.deepEqual(refused.errors.map((error) => [error.row, error.column, error.code]), [
      [2, 'asset_name', 'CSV_VALUE_CANNOT_BE_CLEARED'],
      [3, 'technology_name', 'CSV_VALUE_CANNOT_BE_CLEARED'],
      [4, 'version', 'CSV_VALUE_CANNOT_BE_CLEARED'],
      [5, 'operating_system', 'CSV_VALUE_CANNOT_BE_CLEARED'],
    ]);
  });
}

async function testApplicationLinkNote() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'app-links-clear');
    const crm = await application(runner, tenantId, 'CRM');
    const sql = await technology(runner, tenantId, 2, 'SQL Server');
    const [{ id }] = await runner.query(
      `INSERT INTO application_technologies (tenant_id, application_id, technology_id, notes, source) VALUES ($1, $2, $3, 'Reporting', 'manual') RETURNING id`,
      [tenantId, crm, sql],
    );
    const csv = csvService();
    const ctx = caller(runner, tenantId);
    const run = (notes: string) => csv.importApplicationLinks({ file: csvFile(APP_HEADER, [`,CRM,,SQL Server,,${notes},`]), dryRun: false, language: 'en', mode: 'enrich' }, ctx, {});
    assert.deepEqual([(await run('')).cleared, await notesOf(runner, 'application_technologies', id)], [0, 'Reporting']);
    const done = await run('-');
    assert.deepEqual([done.ok, done.updated, done.cleared], [true, 1, 1], JSON.stringify(done.errors));
    assert.equal(await notesOf(runner, 'application_technologies', id), null);
  });
}

async function testWithoutModeReplaces() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'links-replace');
    const srv = await asset(runner, tenantId, 'Srv');
    const sql = await technology(runner, tenantId, 2, 'SQL Server');
    const link = await installed(runner, tenantId, srv, sql, null, 'manual');
    // Without a mode, as before: `-` is a note's text.
    const done = await csvService().importAssetLinks({ file: csvFile(HEADER, [',Srv,,SQL Server,,,-,']), dryRun: false, language: 'en' }, caller(runner, tenantId));
    assert.equal(done.ok, true);
    assert.equal(await notesOf(runner, 'asset_technologies', link), '-');
  });
}

async function testRoutesApplyTheRule() {
  const requests: any[] = [];
  const linkFiles = {
    importAssetLinks: async (request: any) => { requests.push(request); return { ok: true }; },
    importApplicationLinks: async (request: any) => { requests.push(request); return { ok: true }; },
  };
  const controller = new TechnologiesController(
    undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, linkFiles as any, undefined as any,
  ) as any;
  controller.requireApplications = async () => ({});
  const ctx = { manager: { query: async () => [] }, tenantId: 't', userId: null } as any;
  const file = csvFile(HEADER, []);
  await controller.importAssetLinks(file, 'true', 'en', undefined, ctx);
  await controller.importApplicationLinks(file, 'true', 'en', undefined, ctx);
  assert.deepEqual(requests.map((request) => request.mode), ['enrich', 'enrich']);
}

runSpecs('technology-links-csv-clear.integration.spec', [
  ['server link note', testServerLinkNote],
  ['application link note', testApplicationLinkNote],
  ['without a mode', testWithoutModeReplaces],
  ['routes', testRoutesApplyTheRule],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
