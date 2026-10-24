// @database-spec
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DEFAULT_HOSTING_TYPES, DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { SOURCE_REF_MAX } from '../../common/link-provenance';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import type { QueryRunner } from 'typeorm';
import { TechnologyCatalogService } from '../catalog/technology-catalog.service';
import { OperatingSystemService } from '../operating-system.service';
import { TechnologiesController } from '../technologies.controller';
import { TechnologyLinksCsvService, type TechnologyLinksCsvContext, type TechnologyLinksImportResult } from '../technology-links-csv.service';
import { TechnologyLinksService } from '../technology-links.service';
import { TechnologyReachService } from '../technology-reach.service';
import { application, asset, installed, member, one, technology, version, type AuditEntry } from './technologies.fixtures';

// The two link files of the technologies list: servers and technologies (asset_technologies),
// applications and technologies (application_technologies, declared links).
// A clean file writes in the caller's transaction. A file with a row error writes nothing.

const HEADER = 'asset_reference,asset_name,technology_reference,technology_name,version,operating_system,notes,source';

function csvService(entries?: AuditEntry[]) {
  const audit = { log: async (entry: AuditEntry) => { entries?.push(entry); } };
  const itOps = {
    getSettings: async () => ({
      technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES,
      hostingTypes: DEFAULT_HOSTING_TYPES,
      lifecycleStates: [{ code: 'active' }, { code: 'retired' }],
      cyberCriticalityLevels: [{ code: 'high' }],
      recoveryWaves: [{ code: 'wave_1' }],
    }),
  };
  const reach = new TechnologyReachService();
  const links = new TechnologyLinksService(audit as any, reach, itOps as any);
  const catalog = new TechnologyCatalogService(audit as any, itOps as any);
  const os = new OperatingSystemService(audit as any, itOps as any, catalog);
  // `screens`: the links service the screens write through, for the provenance they leave.
  return Object.assign(new TechnologyLinksCsvService(links, os), { screens: links });
}

function caller(runner: QueryRunner, tenantId: string): TechnologyLinksCsvContext {
  return { manager: runner.manager, tenantId, userId: null };
}

function csvFile(content: string, name = 'servers.csv'): Express.Multer.File {
  return { buffer: Buffer.from(content, 'utf8'), originalname: name } as Express.Multer.File;
}

/** Rows without `asset_reference`: the server matches by name. */
function fileOf(lines: string[], name = 'servers.csv') {
  return csvFile([HEADER, ...lines.map((line) => `,${line}`)].join('\n'), name);
}

async function assetReference(runner: QueryRunner, assetId: string): Promise<string> {
  const [row] = await runner.query(`SELECT asset_reference FROM assets WHERE id = $1`, [assetId]);
  return row.asset_reference as string;
}

function textBody(content: string): string {
  return content.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trimEnd();
}

async function counts(runner: QueryRunner, tenantId: string) {
  const [row] = await runner.query(
    `SELECT (SELECT count(*)::int FROM asset_technologies WHERE tenant_id = $1) AS links,
            (SELECT count(*)::int FROM technology_versions WHERE tenant_id = $1) AS versions`,
    [tenantId],
  );
  return { links: row.links as number, versions: row.versions as number };
}

async function storedLinks(runner: QueryRunner, tenantId: string) {
  return runner.query(
    `SELECT a.name AS asset, t.name AS technology, v.label AS version, at.notes, at.source, at.source_ref, at.is_operating_system
       FROM asset_technologies at
       JOIN assets a ON a.tenant_id = at.tenant_id AND a.id = at.asset_id
       JOIN technologies t ON t.tenant_id = at.tenant_id AND t.id = at.technology_id
       LEFT JOIN technology_versions v ON v.tenant_id = at.tenant_id AND v.id = at.technology_version_id
      WHERE at.tenant_id = $1
      ORDER BY lower(a.name), a.id, lower(t.name), t.id, lower(v.label) NULLS FIRST, at.id`,
    [tenantId],
  ) as Promise<Array<{
    asset: string; technology: string; version: string | null; notes: string | null;
    source: string; source_ref: string | null; is_operating_system: boolean;
  }>>;
}

function codes(report: TechnologyLinksImportResult) {
  return report.errors.map((error) => ({ row: error.row, code: error.code, params: error.params ?? null }));
}

async function testRoundTrip() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'links-round');
    const srv = await asset(runner, tenantId, 'alpha');
    const old = await asset(runner, tenantId, 'beta');
    await runner.query(`UPDATE assets SET status = 'retired' WHERE id = $1`, [old]);
    const sql = await technology(runner, tenantId, 2, 'SQL Server', 'database');
    const sql2019 = await version(runner, tenantId, sql, '2019');
    const win = await technology(runner, tenantId, 3, 'Windows Server', 'operating_system');
    const formula = await installed(runner, tenantId, srv, sql, null, 'manual');
    await runner.query(`UPDATE asset_technologies SET notes = '=1+1' WHERE id = $1`, [formula]);
    await installed(runner, tenantId, srv, sql, sql2019, 'manual');
    await runner.query(`UPDATE asset_technologies SET notes = 'keep' WHERE tenant_id = $1 AND asset_id = $2 AND technology_version_id = $3`, [tenantId, srv, sql2019]);
    const osLink = await installed(runner, tenantId, srv, win, null, 'manual');
    await runner.query(`UPDATE asset_technologies SET is_operating_system = true WHERE id = $1`, [osLink]);
    await installed(runner, tenantId, old, sql, null, 'netbox');
    const ctx = caller(runner, tenantId);
    const csv = csvService();

    const exported = await csv.exportAssetLinks('data', ctx, 'en');
    assert.equal(exported.filename, 'servers-technologies.csv');
    const body = textBody(exported.content);
    assert.ok(body.includes("'=1+1"), 'a formula note is guarded');
    const alphaRef = await assetReference(runner, srv);
    const betaRef = await assetReference(runner, old);
    assert.match(alphaRef, /^AST-\d+$/);
    assert.deepEqual(body.split('\n').slice(1).map((line) => line.split(',').slice(0, 6)), [
      [alphaRef, 'alpha', 'TEC-2', 'SQL Server', '', 'no'],
      [alphaRef, 'alpha', 'TEC-2', 'SQL Server', '2019', 'no'],
      [alphaRef, 'alpha', 'TEC-3', 'Windows Server', '', 'yes'],
      [betaRef, 'beta', 'TEC-2', 'SQL Server', '', 'no'],
    ]);
    assert.deepEqual(body.split('\n').slice(1).map((line) => line.split(',').at(-1)), ['Manual entry', 'Manual entry', 'Manual entry', 'Netbox']);
    const before = await storedLinks(runner, tenantId);
    const loaded = await csv.importAssetLinks({ file: csvFile(exported.content, 'round.csv'), dryRun: false, language: 'en' }, ctx);
    assert.deepEqual(
      { ok: loaded.ok, total: loaded.total, inserted: loaded.inserted, updated: loaded.updated, unchanged: loaded.unchanged, errors: loaded.errors },
      { ok: true, total: 4, inserted: 0, updated: 0, unchanged: 4, errors: [] },
    );
    assert.deepEqual(await storedLinks(runner, tenantId), before, 'the round trip leaves every link as stored, formula included');

    const french = await csv.exportAssetLinks('data', ctx, 'fr');
    const header = textBody(french.content).split('\n')[0];
    assert.equal(header, HEADER.replace(/,/g, ';'));
    const frenchRows = textBody(french.content).split('\n').slice(1).map((line) => line.split(';'));
    assert.deepEqual(frenchRows.map((cells) => [cells[5], cells[7]]), [
      ['non', 'Saisie manuelle'], ['non', 'Saisie manuelle'], ['oui', 'Saisie manuelle'], ['non', 'Netbox'],
    ], 'yes, no and the source are written in the file language');
    const again = await csv.importAssetLinks({ file: csvFile(french.content), dryRun: false, language: 'fr' }, ctx);
    assert.equal(again.unchanged, 4);
    assert.deepEqual(await storedLinks(runner, tenantId), before);

    const template = await csv.exportAssetLinks('template', ctx, 'en');
    assert.equal(template.filename, 'servers-technologies-template.csv');
    assert.equal(textBody(template.content), HEADER);
  });
}

async function testCreateProvenance() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'links-create');
    const srv = await asset(runner, tenantId, 'Srv');
    const other = await asset(runner, tenantId, 'Other');
    await asset(runner, tenantId, 'Second');
    const longBox = await asset(runner, tenantId, 'Long');
    const retired = await asset(runner, tenantId, 'Old box');
    await runner.query(`UPDATE assets SET status = 'retired' WHERE id = $1`, [retired]);
    const sql = await technology(runner, tenantId, 2, 'SQL Server', 'database');
    await version(runner, tenantId, sql, '2019');
    const ctx = caller(runner, tenantId);
    const entries: AuditEntry[] = [];
    const csv = csvService(entries);
    const before = await counts(runner, tenantId);

    const clean = [
      '  srv  ,  tec-2  ,ignored,, ,kept,',
      'Other,,SQL Server,Fresh,,',
      'Second,,SQL Server,Fresh,,',
      'Other,,sql server,2019,,',
      'Old box,,SQL Server,,,',
    ];
    const preview = await csv.importAssetLinks({ file: fileOf(clean, 'first.csv'), dryRun: true, language: 'en' }, ctx);
    assert.equal(preview.ok, true);
    assert.equal(preview.dryRun, true);
    assert.deepEqual(
      { inserted: preview.inserted, updated: preview.updated, unchanged: preview.unchanged },
      { inserted: 5, updated: 0, unchanged: 0 },
    );
    assert.deepEqual(preview.warnings.map((warning) => warning.code), ['CSV_TECHNOLOGY_VERSION_CREATED', 'CSV_TECHNOLOGY_VERSION_CREATED']);
    assert.deepEqual(await counts(runner, tenantId), before, 'a dry run creates no version and no link');

    const loaded = await csv.importAssetLinks({ file: fileOf(clean, 'first.csv'), dryRun: false, language: 'en' }, ctx);
    assert.equal(loaded.inserted, 5);
    const rows = await storedLinks(runner, tenantId);
    assert.deepEqual(rows.map((row) => [row.asset, row.technology, row.version, row.notes, row.source, row.source_ref]), [
      ['Old box', 'SQL Server', null, null, 'import', 'first.csv'],
      ['Other', 'SQL Server', '2019', null, 'import', 'first.csv'],
      ['Other', 'SQL Server', 'Fresh', null, 'import', 'first.csv'],
      ['Second', 'SQL Server', 'Fresh', null, 'import', 'first.csv'],
      ['Srv', 'SQL Server', null, 'kept', 'import', 'first.csv'],
    ]);
    assert.equal((await counts(runner, tenantId)).versions, before.versions + 1, 'one version for the two rows that name Fresh');
    assert.ok(entries.some((entry) => entry.action === 'create' && entry.table === 'asset_technologies'));

    const longName = `${'n'.repeat(SOURCE_REF_MAX + 40)}.csv`;
    const createdLong = await csv.importAssetLinks({
      file: fileOf(['Long,,SQL Server,,,'], longName),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(createdLong.inserted, 1);
    const [longLink] = await runner.query(
      `SELECT source, source_ref, char_length(source_ref)::int AS len
         FROM asset_technologies WHERE tenant_id = $1 AND asset_id = $2`,
      [tenantId, longBox],
    );
    assert.equal(longLink.source, 'import');
    assert.equal(longLink.len, SOURCE_REF_MAX);
    assert.equal(longLink.source_ref, longName.slice(0, SOURCE_REF_MAX));

    const renamed = await csv.importAssetLinks({
      file: fileOf(['Srv,,SQL Server,,,renamed'], 'second.csv'),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(renamed.updated, 1);
    const [srvLink] = await runner.query(
      `SELECT source, source_ref, notes FROM asset_technologies
        WHERE tenant_id = $1 AND asset_id = $2 AND technology_version_id IS NULL`,
      [tenantId, srv],
    );
    assert.deepEqual(srvLink, { source: 'import', source_ref: 'first.csv', notes: 'renamed' });

    const blankName = await csv.importAssetLinks({
      file: csvFile([HEADER, ',Other,,SQL Server,2019,,second,'].join('\n'), '   '),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(blankName.updated, 1);
    const [named] = await runner.query(
      `SELECT at.notes, at.source_ref FROM asset_technologies at
         JOIN technology_versions v ON v.id = at.technology_version_id
        WHERE at.tenant_id = $1 AND at.asset_id = $2 AND v.label = '2019'`,
      [tenantId, other],
    );
    assert.deepEqual(named, { notes: 'second', source_ref: 'first.csv' });

    const noSourceColumn = await csv.importAssetLinks({
      file: csvFile('asset_reference,asset_name,technology_reference,technology_name,version,operating_system,notes\n,Srv,TEC-2,SQL Server,,,from-short\n'),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(noSourceColumn.ok, true);
    assert.equal(noSourceColumn.updated, 1);
    const [short] = await runner.query(
      `SELECT notes, source_ref FROM asset_technologies WHERE tenant_id = $1 AND asset_id = $2 AND technology_version_id IS NULL`,
      [tenantId, srv],
    );
    assert.deepEqual(short, { notes: 'from-short', source_ref: 'first.csv' });

    // Multer hands the name over in latin1: the reference reads it back as typed.
    const accented = await asset(runner, tenantId, 'Accented');
    const asMulter = (name: string) => Buffer.from(name, 'utf8').toString('latin1');
    await csv.importAssetLinks({ file: fileOf(['Accented,,SQL Server,,,'], asMulter('inventaire-été.csv')), dryRun: false, language: 'en' }, ctx);
    const [accentedLink] = await runner.query(`SELECT source_ref FROM asset_technologies WHERE tenant_id = $1 AND asset_id = $2`, [tenantId, accented]);
    assert.equal(accentedLink.source_ref, 'inventaire-été.csv');
    const emoji = await asset(runner, tenantId, 'Emoji');
    const emojiName = `${'e'.repeat(SOURCE_REF_MAX - 1)}\u{1F600}.csv`;
    const emojiLoaded = await csv.importAssetLinks({ file: fileOf(['Emoji,,SQL Server,,,'], asMulter(emojiName)), dryRun: false, language: 'en' }, ctx);
    assert.equal(emojiLoaded.inserted, 1);
    const [emojiLink] = await runner.query(`SELECT source_ref FROM asset_technologies WHERE tenant_id = $1 AND asset_id = $2`, [tenantId, emoji]);
    assert.equal(emojiLink.source_ref, 'e'.repeat(SOURCE_REF_MAX - 1), 'the cut never splits a character');
  });
}

async function testKeepsManualProvenance() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'links-manual');
    const srv = await asset(runner, tenantId, 'Srv');
    const sql = await technology(runner, tenantId, 2, 'SQL Server');
    const link = await installed(runner, tenantId, srv, sql, null, 'manual');
    await runner.query(`UPDATE asset_technologies SET notes = 'keep', source_ref = 'hand' WHERE id = $1`, [link]);
    const [stamp] = await runner.query(`SELECT updated_at FROM asset_technologies WHERE id = $1`, [link]);
    const ctx = caller(runner, tenantId);
    const entries: AuditEntry[] = [];
    const csv = csvService(entries);

    const same = await csv.importAssetLinks({
      file: fileOf(['Srv,,SQL Server,,,keep,import']),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(same.unchanged, 1);
    assert.deepEqual(entries, []);
    const [untouched] = await runner.query(`SELECT notes, source, source_ref, updated_at FROM asset_technologies WHERE id = $1`, [link]);
    assert.deepEqual(
      { notes: untouched.notes, source: untouched.source, source_ref: untouched.source_ref },
      { notes: 'keep', source: 'manual', source_ref: 'hand' },
    );
    assert.equal(new Date(untouched.updated_at).getTime(), new Date(stamp.updated_at).getTime());

    const emptyNotes = await csv.importAssetLinks({
      file: fileOf(['Srv,,SQL Server,,,,import']),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(emptyNotes.unchanged, 1);
    const [kept] = await runner.query(`SELECT notes, source, source_ref FROM asset_technologies WHERE id = $1`, [link]);
    assert.deepEqual(kept, { notes: 'keep', source: 'manual', source_ref: 'hand' });

    const edited = await csv.importAssetLinks({
      file: fileOf(['Srv,,SQL Server,,,replaced,import'], 'other.csv'),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(edited.updated, 1);
    const [manual] = await runner.query(`SELECT notes, source, source_ref FROM asset_technologies WHERE id = $1`, [link]);
    assert.deepEqual(manual, { notes: 'replaced', source: 'manual', source_ref: 'hand' });

    // A screen that writes a link the import created makes it manual again (no option = the old SQL).
    const app = await application(runner, tenantId, 'App');
    await csv.importAssetLinks({ file: fileOf(['Srv,,SQL Server,2019,,']), dryRun: false, language: 'en' }, ctx);
    await csv.importApplicationLinks({ file: appFileOf([',App,,SQL Server,,,']), dryRun: false, language: 'en' }, ctx, {});
    const opts = { manager: runner.manager, tenantId, userId: null };
    await csv.screens.addAssetLink(sql, srv, { version_label: '2019' }, opts);
    await csv.screens.setApplicationTechnology(app, sql, true, {}, opts);
    const [assetLink] = await runner.query(
      `SELECT source, source_ref FROM asset_technologies WHERE tenant_id = $1 AND asset_id = $2 AND technology_version_id IS NOT NULL`,
      [tenantId, srv],
    );
    assert.deepEqual(assetLink, { source: 'manual', source_ref: null });
    const [appLink] = await runner.query(`SELECT source, source_ref FROM application_technologies WHERE tenant_id = $1 AND application_id = $2`, [tenantId, app]);
    assert.deepEqual(appLink, { source: 'manual', source_ref: null });
  });
}

async function testHomonymServers() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'links-homonyms');
    const prod = await asset(runner, tenantId, 'web01');
    const test = await asset(runner, tenantId, 'WEB01');
    await asset(runner, tenantId, 'db01');
    const sql = await technology(runner, tenantId, 2, 'SQL Server', 'database');
    await installed(runner, tenantId, prod, sql, null, 'manual');
    await installed(runner, tenantId, test, sql, null, 'manual');
    const ctx = caller(runner, tenantId);
    const csv = csvService();
    const prodRef = await assetReference(runner, prod);
    const testRef = await assetReference(runner, test);

    const exported = await csv.exportAssetLinks('data', ctx, 'en');
    const lines = textBody(exported.content).split('\n').slice(1);
    assert.deepEqual(lines.map((line) => line.split(',').slice(0, 2)).sort(), [[prodRef, 'web01'], [testRef, 'WEB01']].sort());
    const before = await storedLinks(runner, tenantId);
    const edited = exported.content.replace(`${testRef},WEB01,TEC-2,SQL Server,,no,,`, `${testRef},WEB01,TEC-2,SQL Server,,no,recette,`);
    assert.notEqual(edited, exported.content, 'the note of the second web01 is edited');
    const round = await csv.importAssetLinks({ file: csvFile(edited, 'round.csv'), dryRun: false, language: 'en' }, ctx);
    assert.deepEqual(
      { ok: round.ok, errors: round.errors, updated: round.updated, unchanged: round.unchanged },
      { ok: true, errors: [], updated: 1, unchanged: 1 },
      'two servers with one name export and import again by their reference',
    );
    const [testNotes] = await runner.query(`SELECT notes FROM asset_technologies WHERE tenant_id = $1 AND asset_id = $2`, [tenantId, test]);
    assert.equal(testNotes.notes, 'recette');
    assert.equal((await storedLinks(runner, tenantId)).length, before.length);

    const refused = await csv.importAssetLinks({
      file: csvFile([
        HEADER,
        `${prodRef.toLowerCase()},,,SQL Server,2019,,,`,
        `AST-999999,web01,,SQL Server,,,,`,
        `${prodRef},db01,,SQL Server,,,,`,
        `,web01,,SQL Server,,,,`,
        `${testRef}, web01 ,,SQL Server,,,lower case name,`,
      ].join('\n')),
      dryRun: true,
      language: 'en',
    }, ctx);
    assert.deepEqual(codes(refused), [
      { row: 3, code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'AST-999999' } },
      { row: 4, code: 'CSV_ASSET_REFERENCE_MISMATCH', params: { value: prodRef, name: 'web01' } },
      { row: 5, code: 'CSV_NAME_AMBIGUOUS', params: { value: 'web01' } },
    ]);
  });
}

async function testRowErrors() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'links-errors');
    await asset(runner, tenantId, 'Twin');
    await asset(runner, tenantId, 'Twin');
    await asset(runner, tenantId, 'Srv');
    await technology(runner, tenantId, 2, 'SQL Server');
    const ctx = caller(runner, tenantId);
    const csv = csvService();
    const before = await counts(runner, tenantId);

    const refused = await csv.importAssetLinks({
      file: fileOf([
        'Nope,,SQL Server,BrandNew,,',
        'Twin,,SQL Server,,,',
        'Srv,TEC-9,SQL Server,,,',
        'Srv,,Missing,,,',
        'Srv,,SQL Server,BrandNew,,',
        'Srv,,SQL Server,BrandNew,,',
        'Srv,,SQL Server,,maybe,',
        `Srv,,SQL Server,${'v'.repeat(101)},,`,
        `Srv,,SQL Server,,,${'n'.repeat(2001)},`,
        ',,SQL Server,,,',
        'Srv,,,,,',
        'Srv,SQL Server,,,,',
      ]),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(refused.ok, false);
    assert.deepEqual(codes(refused), [
      { row: 2, code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Nope' } },
      { row: 3, code: 'CSV_NAME_AMBIGUOUS', params: { value: 'Twin' } },
      { row: 4, code: 'CSV_TECHNOLOGY_NOT_ADOPTED', params: { value: 'TEC-9' } },
      { row: 5, code: 'CSV_TECHNOLOGY_NOT_ADOPTED', params: { value: 'Missing' } },
      { row: 7, code: 'CSV_LINK_DUPLICATE', params: { firstRow: 6 } },
      { row: 8, code: 'CSV_OPERATING_SYSTEM_VALUE', params: { value: 'maybe' } },
      { row: 9, code: 'CSV_VERSION_TOO_LONG', params: { max: 100 } },
      { row: 10, code: 'CSV_NOTES_TOO_LONG', params: { max: 2000 } },
      { row: 11, code: 'CSV_ASSET_REQUIRED', params: null },
      { row: 12, code: 'CSV_TECHNOLOGY_REQUIRED', params: null },
      { row: 13, code: 'CSV_TECHNOLOGY_REFERENCE_INVALID', params: { value: 'SQL Server' } },
    ]);
    assert.ok(refused.errors.some((error) => error.message.includes('Adopt it from the catalog first.')));
    assert.deepEqual(await counts(runner, tenantId), before, 'the duplicate file writes nothing, including the version its first row would create');

    const header = await csv.importAssetLinks({
      file: csvFile('technology_name,version\nSQL Server,2019\n'),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(header.ok, false);
    assert.equal(header.total, 0);
    assert.equal(header.errors[0].row, 0);
    assert.equal(header.errors[0].code, 'CSV_HEADER_MISSING_COLUMNS');
    assert.deepEqual(await counts(runner, tenantId), before);

    const extra = await csv.importAssetLinks({
      file: csvFile(`${HEADER},extra\n,Srv,,SQL Server,,,\n`),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(extra.errors[0].code, 'CSV_HEADER_UNKNOWN_COLUMNS');
    assert.deepEqual(await counts(runner, tenantId), before);
  });
}

async function testOperatingSystem() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'links-os');
    const srv = await asset(runner, tenantId, 'Srv');
    // A cluster with members has no operating system; a cluster without member may have one.
    const cluster = await asset(runner, tenantId, 'Cluster', true);
    await member(runner, tenantId, cluster, await asset(runner, tenantId, 'Node'));
    await asset(runner, tenantId, 'Lone cluster', true);
    const win = await technology(runner, tenantId, 3, 'Windows Server', 'operating_system');
    await technology(runner, tenantId, 4, 'Ubuntu', 'operating_system');
    await technology(runner, tenantId, 2, 'SQL Server', 'database');
    const marked = await installed(runner, tenantId, srv, win, null, 'manual');
    await runner.query(`UPDATE asset_technologies SET is_operating_system = true, notes = 'os' WHERE id = $1`, [marked]);
    const ctx = caller(runner, tenantId);
    const csv = csvService();
    const before = await counts(runner, tenantId);

    const clusterRefused = await csv.importAssetLinks({
      file: fileOf(['Cluster,,Ubuntu,,yes,']),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.deepEqual(codes(clusterRefused), [
      { row: 2, code: 'CSV_OPERATING_SYSTEM_CLUSTER', params: null },
    ]);
    const loneCluster = await csv.importAssetLinks({
      file: fileOf(['Lone cluster,,Ubuntu,,yes,']),
      dryRun: true,
      language: 'en',
    }, ctx);
    assert.equal(loneCluster.ok, true, JSON.stringify(loneCluster.errors));
    assert.equal(loneCluster.inserted, 1);

    const familyRefused = await csv.importAssetLinks({
      file: fileOf(['Srv,,SQL Server,,yes,']),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.deepEqual(codes(familyRefused), [
      { row: 2, code: 'CSV_OPERATING_SYSTEM_FAMILY', params: null },
    ]);

    const taken = await csv.importAssetLinks({
      file: fileOf(['Srv,,Ubuntu,,yes,fresh']),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.deepEqual(codes(taken), [
      { row: 2, code: 'CSV_OPERATING_SYSTEM_TAKEN', params: null },
    ]);

    const both = await csv.importAssetLinks({
      file: fileOf(['Srv,,Windows Server,,yes,', 'Srv,,Ubuntu,,yes,']),
      dryRun: false,
      language: 'en',
    }, ctx);
    // The server already carries Windows. Ubuntu is the second claim, and the file writes nothing.
    assert.ok(both.errors.some((error) => error.code === 'CSV_OPERATING_SYSTEM_TAKEN'));
    assert.deepEqual(await counts(runner, tenantId), before);
    const [still] = await runner.query(
      `SELECT t.name, at.is_operating_system, at.notes, at.source
         FROM asset_technologies at JOIN technologies t ON t.id = at.technology_id
        WHERE at.tenant_id = $1`,
      [tenantId],
    );
    assert.deepEqual(still, { name: 'Windows Server', is_operating_system: true, notes: 'os', source: 'manual' });

    const cleared = await csv.importAssetLinks({
      file: fileOf(['Srv,,Windows Server,,no,']),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(cleared.unchanged, 1);
    const [keptMark] = await runner.query(`SELECT is_operating_system, notes FROM asset_technologies WHERE id = $1`, [marked]);
    assert.deepEqual(keptMark, { is_operating_system: true, notes: 'os' });

    const sameMark = await csv.importAssetLinks({
      file: fileOf(['Srv,,Windows Server,,yes,os']),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(sameMark.unchanged, 1);

    const bare = await asset(runner, tenantId, 'Bare');
    const markedBare = await csv.importAssetLinks({
      file: fileOf(['Bare,,Ubuntu,,YES,']),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(markedBare.inserted, 1);
    const [ubuntuLink] = await runner.query(
      `SELECT at.is_operating_system, at.source, at.source_ref
         FROM asset_technologies at WHERE at.tenant_id = $1 AND at.asset_id = $2`,
      [tenantId, bare],
    );
    assert.deepEqual(ubuntuLink, { is_operating_system: true, source: 'import', source_ref: 'servers.csv' });

    const noted = await csv.importAssetLinks({
      file: fileOf(['Bare,,Ubuntu,,,placed']),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(noted.updated, 1, 'notes change on the marked link, and the mark stays');
    const [afterNotes] = await runner.query(`SELECT notes, is_operating_system, source FROM asset_technologies WHERE tenant_id = $1 AND asset_id = $2`, [tenantId, bare]);
    assert.deepEqual(afterNotes, { notes: 'placed', is_operating_system: true, source: 'import' });

    // A second operating system on a server that has none yet, asked beside a database, is the mark.
    const plain = await asset(runner, tenantId, 'Plain');
    const paired = await csv.importAssetLinks({
      file: fileOf(['Plain,,SQL Server,,,', 'Plain,,Windows Server,,yes,']),
      dryRun: false,
      language: 'en',
    }, ctx);
    assert.equal(paired.ok, true);
    assert.equal(paired.inserted, 2);
    const marks = await runner.query(
      `SELECT t.name, at.is_operating_system FROM asset_technologies at
         JOIN technologies t ON t.id = at.technology_id
        WHERE at.tenant_id = $1 AND at.asset_id = $2 ORDER BY t.name`,
      [tenantId, plain],
    );
    assert.deepEqual(marks, [
      { name: 'SQL Server', is_operating_system: false },
      { name: 'Windows Server', is_operating_system: true },
    ]);
  });
}

async function testOperatingSystemDefault() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'links-os-default');
    for (const name of ['Auto', 'Never', 'Explicit']) await asset(runner, tenantId, name);
    await asset(runner, tenantId, 'Cluster', true);
    const kept = await asset(runner, tenantId, 'Kept');
    const owned = await asset(runner, tenantId, 'Owned');
    const ubuntu = await technology(runner, tenantId, 4, 'Ubuntu', 'operating_system');
    const win = await technology(runner, tenantId, 3, 'Windows Server', 'operating_system');
    await technology(runner, tenantId, 2, 'SQL Server', 'database');
    await installed(runner, tenantId, kept, ubuntu, null, 'manual');
    const ownedMark = await installed(runner, tenantId, owned, win, null, 'manual');
    await runner.query(`UPDATE asset_technologies SET is_operating_system = true WHERE id = $1`, [ownedMark]);
    const ctx = caller(runner, tenantId);
    const csv = csvService();
    const before = await counts(runner, tenantId);
    const file = () => fileOf([
      'Auto,,SQL Server,,,',
      'Auto,,Ubuntu,,,',
      'Never,,Ubuntu,,non,',
      'Explicit,,Ubuntu,,,',
      'Explicit,,Windows Server,,Oui,',
      'Cluster,,Ubuntu,,,',
      'Kept,,Ubuntu,,,',
      'Owned,,Ubuntu,,,',
    ]);

    const preview = await csv.importAssetLinks({ file: file(), dryRun: true, language: 'en' }, ctx);
    assert.equal(preview.ok, true);
    assert.deepEqual(
      preview.warnings.map((warning) => [warning.row, warning.code]),
      [[3, 'CSV_OPERATING_SYSTEM_MARKED']],
      'the preview names the link an empty cell marks',
    );
    assert.deepEqual({ inserted: preview.inserted, unchanged: preview.unchanged }, { inserted: 7, unchanged: 1 });
    assert.deepEqual(await counts(runner, tenantId), before);

    const loaded = await csv.importAssetLinks({ file: file(), dryRun: false, language: 'en' }, ctx);
    assert.equal(loaded.ok, true);
    const marks = await runner.query(
      `SELECT a.name AS asset, t.name AS technology, at.is_operating_system AS marked
         FROM asset_technologies at
         JOIN assets a ON a.id = at.asset_id
         JOIN technologies t ON t.id = at.technology_id
        WHERE at.tenant_id = $1
        ORDER BY a.name, t.name`,
      [tenantId],
    );
    assert.deepEqual(marks.map((row: any) => [row.asset, row.technology, row.marked]), [
      ['Auto', 'SQL Server', false],
      ['Auto', 'Ubuntu', true],
      ['Cluster', 'Ubuntu', false],
      ['Explicit', 'Ubuntu', false],
      ['Explicit', 'Windows Server', true],
      ['Kept', 'Ubuntu', false],
      ['Never', 'Ubuntu', false],
      ['Owned', 'Ubuntu', false],
      ['Owned', 'Windows Server', true],
    ], 'empty: the server page rule for a created link; no: never; yes: the mark; an existing link keeps its state');
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const tenantA = await seedTenant(runner, 'links-iso-a');
    const tenantB = await seedTenant(runner, 'links-iso-b');
    await asset(runner, tenantB, 'Shared');
    await technology(runner, tenantB, 1, 'SharedTech');
    await asset(runner, tenantB, 'OnlyB');
    await technology(runner, tenantB, 2, 'OnlyBTech');
    await setTenant(runner, tenantA);
    const shared = await asset(runner, tenantA, 'Shared');
    const tech = await technology(runner, tenantA, 1, 'SharedTech');
    const csv = csvService();

    const hidden = await csv.importAssetLinks({
      file: fileOf(['OnlyB,,OnlyBTech,,,', 'Shared,,SharedTech,,,']),
      dryRun: false,
      language: 'en',
    }, caller(runner, tenantA));
    assert.equal(hidden.ok, false);
    assert.deepEqual(codes(hidden), [
      { row: 2, code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'OnlyB' } },
    ]);
    assert.equal((await counts(runner, tenantA)).links, 0);

    const loaded = await csv.importAssetLinks({
      file: fileOf(['Shared,TEC-1,Other name,,,']),
      dryRun: false,
      language: 'en',
    }, caller(runner, tenantA));
    assert.equal(loaded.inserted, 1);
    const [link] = await runner.query(
      `SELECT asset_id, technology_id, source FROM asset_technologies WHERE tenant_id = $1`,
      [tenantA],
    );
    assert.deepEqual(link, { asset_id: shared, technology_id: tech, source: 'import' });

    await setTenant(runner, tenantB);
    assert.equal((await counts(runner, tenantB)).links, 0, 'tenant B gains no link from a file read as A');
    const missed = await csv.importAssetLinks({
      file: fileOf(['Shared,,SharedTech,,,']),
      dryRun: false,
      language: 'en',
    }, caller(runner, tenantA));
    assert.equal(missed.inserted, 0);
    assert.equal(missed.ok, false, 'RLS hides tenant A while the session tenant is B');
  });
}

async function testRoutes() {
  const names = Object.getOwnPropertyNames(TechnologiesController.prototype);
  assert.ok(names.indexOf('exportAssetLinks') < names.indexOf('get'), 'the export is declared before :id');
  assert.ok(names.indexOf('importAssetLinks') < names.indexOf('get'));
  assert.equal(Reflect.getMetadata(PATH_METADATA, TechnologiesController.prototype.exportAssetLinks), 'asset-links/export');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, TechnologiesController.prototype.exportAssetLinks), RequestMethod.GET);
  assert.equal(Reflect.getMetadata(PATH_METADATA, TechnologiesController.prototype.importAssetLinks), 'asset-links/import');
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, TechnologiesController.prototype.exportAssetLinks), { resource: 'infrastructure', level: 'reader' });
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, TechnologiesController.prototype.importAssetLinks), { resource: 'infrastructure', level: 'member' });

  const csv = csvService();
  const controller = new TechnologiesController(
    undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, csv, undefined as any,
  );
  const res = { setHeader() {}, send() {} };
  await assert.rejects(() => controller.exportAssetLinks('nope', 'en', res as any, {} as any), /scope must be/);
  await assert.rejects(
    () => controller.exportAssetLinks('data', 'pt', res as any, { manager: {} } as any),
    /language must be/,
  );

  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'links-route');
    await asset(runner, tenantId, 'Srv');
    await technology(runner, tenantId, 2, 'SQL Server');
    const ctx = { manager: runner.manager, tenantId, userId: null } as any;
    const preview = await controller.importAssetLinks(fileOf(['Srv,,SQL Server,,,']), undefined, 'en', ctx) as TechnologyLinksImportResult;
    assert.equal(preview.dryRun, true);
    assert.equal(preview.inserted, 1);
    assert.equal((await counts(runner, tenantId)).links, 0);
    const headers: Record<string, string> = {};
    let sent = '';
    await controller.exportAssetLinks('template', 'en', {
      setHeader(name: string, value: string) { headers[name] = value; },
      send(body: string) { sent = body; },
    } as any, ctx);
    assert.ok(headers['Content-Disposition'].includes('servers-technologies-template.csv'));
    assert.equal(textBody(sent), HEADER);
  });
}

const APP_HEADER = 'application_reference,application_name,technology_reference,technology_name,version,notes,source';

function appFileOf(lines: string[], name = 'applications.csv') {
  return csvFile([APP_HEADER, ...lines].join('\n'), name);
}

async function appLinks(runner: QueryRunner, tenantId: string) {
  return runner.query(
    `SELECT a.name AS application, t.name AS technology, v.label AS version, l.notes, l.source, l.source_ref
       FROM application_technologies l
       JOIN applications a ON a.tenant_id = l.tenant_id AND a.id = l.application_id
       JOIN technologies t ON t.tenant_id = l.tenant_id AND t.id = l.technology_id
       LEFT JOIN technology_versions v ON v.tenant_id = l.tenant_id AND v.id = l.technology_version_id
      WHERE l.tenant_id = $1
      ORDER BY lower(a.name), lower(t.name), lower(v.label) NULLS FIRST`,
    [tenantId],
  ) as Promise<Array<{ application: string; technology: string; version: string | null; notes: string | null; source: string; source_ref: string | null }>>;
}

async function reference(runner: QueryRunner, appId: string): Promise<string> {
  const [row] = await runner.query(`SELECT sequential_id FROM applications WHERE id = $1`, [appId]);
  return row.sequential_id as string;
}

async function testApplicationRoundTripAndProvenance() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'app-links');
    const crm = await application(runner, tenantId, 'CRM');
    await application(runner, tenantId, 'ERP');
    await application(runner, tenantId, 'Payroll');
    const sql = await technology(runner, tenantId, 2, 'SQL Server', 'database');
    const sql2019 = await version(runner, tenantId, sql, '2019');
    await technology(runner, tenantId, 3, 'Tomcat');
    await runner.query(
      `INSERT INTO application_technologies (tenant_id, application_id, technology_id, technology_version_id, notes, source, source_ref)
       VALUES ($1, $2, $3, NULL, 'hand', 'manual', NULL), ($1, $2, $3, $4, NULL, 'agent', 'run-1')`,
      [tenantId, crm, sql, sql2019],
    );
    const ctx = caller(runner, tenantId);
    const entries: AuditEntry[] = [];
    const csv = csvService(entries);
    const crmRef = await reference(runner, crm);

    const exported = await csv.exportApplicationLinks('data', ctx, {}, 'en');
    assert.equal(exported.filename, 'applications-technologies.csv');
    assert.deepEqual(textBody(exported.content).split('\n'), [
      APP_HEADER,
      `${crmRef},CRM,TEC-2,SQL Server,,hand,Manual entry`,
      `${crmRef},CRM,TEC-2,SQL Server,2019,,Agent`,
    ]);
    const before = await appLinks(runner, tenantId);
    const round = await csv.importApplicationLinks({ file: csvFile(exported.content, 'round.csv'), dryRun: false, language: 'en' }, ctx, {});
    assert.deepEqual({ ok: round.ok, unchanged: round.unchanged, inserted: round.inserted, updated: round.updated }, { ok: true, unchanged: 2, inserted: 0, updated: 0 });
    assert.deepEqual(await appLinks(runner, tenantId), before);
    assert.equal(entries.length, 0, 'an unchanged file writes no audit entry');
    const template = await csv.exportApplicationLinks('template', ctx, {}, 'en');
    assert.equal(template.filename, 'applications-technologies-template.csv');
    assert.equal(textBody(template.content), APP_HEADER);

    const file = appFileOf([
      `${crmRef.toLowerCase()},ignored,tec-2,,,new notes,`,
      ',erp,,sql server,2022,,',
      ',ERP,TEC-3,,,,',
    ], 'apps.csv');
    const preview = await csv.importApplicationLinks({ file, dryRun: true, language: 'en' }, ctx, {});
    assert.deepEqual(
      { ok: preview.ok, inserted: preview.inserted, updated: preview.updated, unchanged: preview.unchanged },
      { ok: true, inserted: 2, updated: 1, unchanged: 0 },
    );
    assert.deepEqual(preview.warnings.map((w) => [w.row, w.code, w.params]), [[3, 'CSV_TECHNOLOGY_VERSION_CREATED', { value: '2022' }]]);
    assert.deepEqual(await appLinks(runner, tenantId), before, 'a dry run writes nothing');

    const loaded = await csv.importApplicationLinks({ file, dryRun: false, language: 'en' }, ctx, {});
    assert.equal(loaded.ok, true);
    assert.deepEqual((await appLinks(runner, tenantId)).map((r) => [r.application, r.technology, r.version, r.notes, r.source, r.source_ref]), [
      ['CRM', 'SQL Server', null, 'new notes', 'manual', null],
      ['CRM', 'SQL Server', '2019', null, 'agent', 'run-1'],
      ['ERP', 'SQL Server', '2022', null, 'import', 'apps.csv'],
      ['ERP', 'Tomcat', null, null, 'import', 'apps.csv'],
    ]);
    assert.ok(entries.some((e) => e.table === 'application_technologies' && e.action === 'create'));
    assert.ok(entries.some((e) => e.table === 'application_technologies' && e.action === 'update'));
  });
}

async function testApplicationErrorsAndScope() {
  await inRolledBackTransaction(async (runner) => {
    const other = await seedTenant(runner, 'app-links-other');
    await application(runner, other, 'Elsewhere');
    await technology(runner, other, 9, 'Elsewhere tech');
    const tenantId = await seedTenant(runner, 'app-links-errors');
    const mine = await application(runner, tenantId, 'Mine');
    const hidden = await application(runner, tenantId, 'Hidden');
    await application(runner, tenantId, 'Twin');
    await application(runner, tenantId, 'Twin');
    const sql = await technology(runner, tenantId, 2, 'SQL Server');
    await runner.query(
      `INSERT INTO application_technologies (tenant_id, application_id, technology_id) VALUES ($1, $2, $4), ($1, $3, $4)`,
      [tenantId, mine, hidden, sql],
    );
    const role = await one(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Contributor c2a') RETURNING id`, [tenantId]);
    const user = await one(
      runner,
      `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Bea', 'Contributor', 'bea.c2a@example.invalid', 'enabled') RETURNING id`,
      [tenantId, role],
    );
    await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [tenantId, mine, user]);
    const ctx = caller(runner, tenantId);
    const csv = csvService();
    const scoped = { scope: { userId: user } };
    const hiddenRef = await reference(runner, hidden);
    const before = await appLinks(runner, tenantId);

    const exported = textBody((await csv.exportApplicationLinks('data', ctx, scoped, 'en')).content).split('\n');
    assert.equal(exported.length, 2, 'the scoped export holds the contributor\'s application only');
    assert.ok(exported[1].includes(',Mine,'));

    const refused = await csv.importApplicationLinks({
      file: appFileOf([
        ',Mine,,SQL Server,2030,,',
        ',Hidden,,SQL Server,,,',
        `${hiddenRef},,,SQL Server,,,`,
        ',Twin,,SQL Server,,,',
        ',Elsewhere,,SQL Server,,,',
        ',Mine,,Elsewhere tech,,,',
        ',,,SQL Server,,,',
        'APP-999999,Mine,,SQL Server,,,',
        ',mine,,sql server,2030,,',
      ]),
      dryRun: false,
      language: 'en',
    }, ctx, scoped);
    assert.equal(refused.ok, false);
    assert.deepEqual(codes(refused), [
      { row: 3, code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Hidden' } },
      { row: 4, code: 'CSV_REFERENCE_NOT_FOUND', params: { value: hiddenRef } },
      { row: 5, code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Twin' } },
      { row: 6, code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Elsewhere' } },
      { row: 7, code: 'CSV_TECHNOLOGY_NOT_ADOPTED', params: { value: 'Elsewhere tech' } },
      { row: 8, code: 'CSV_APPLICATION_REQUIRED', params: null },
      { row: 9, code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'APP-999999' } },
      { row: 10, code: 'CSV_LINK_DUPLICATE', params: { firstRow: 2 } },
    ]);
    assert.deepEqual(await appLinks(runner, tenantId), before, 'a file with errors writes nothing, not even the version of row 2');
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM technology_versions WHERE tenant_id = $1`, [tenantId]);
    assert.equal(n, 0);

    const twins = await csv.importApplicationLinks({ file: appFileOf([',Twin,,SQL Server,,,']), dryRun: true, language: 'en' }, ctx, {});
    assert.deepEqual(codes(twins), [{ row: 2, code: 'CSV_NAME_AMBIGUOUS', params: { value: 'Twin' } }]);
    const unscoped = await csv.importApplicationLinks({ file: appFileOf([',Hidden,,SQL Server,,,']), dryRun: true, language: 'en' }, ctx, {});
    assert.deepEqual({ ok: unscoped.ok, unchanged: unscoped.unchanged }, { ok: true, unchanged: 1 }, 'without a scope every application is read');
  });
}

async function testApplicationRoutes() {
  const proto = TechnologiesController.prototype;
  const names = Object.getOwnPropertyNames(proto);
  assert.ok(names.indexOf('exportApplicationLinks') < names.indexOf('get'), 'declared before :id');
  assert.ok(names.indexOf('importApplicationLinks') < names.indexOf('get'));
  assert.equal(Reflect.getMetadata(PATH_METADATA, proto.exportApplicationLinks), 'application-links/export');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, proto.exportApplicationLinks), RequestMethod.GET);
  assert.equal(Reflect.getMetadata(PATH_METADATA, proto.importApplicationLinks), 'application-links/import');
  assert.equal(Reflect.getMetadata(METHOD_METADATA, proto.importApplicationLinks), RequestMethod.POST);
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.exportApplicationLinks), { resource: 'infrastructure', level: 'reader' });
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.importApplicationLinks), { resource: 'infrastructure', level: 'member' });

  let called = false;
  const spy = new Proxy({}, { get: () => () => { called = true; } }) as any;
  const controller = new TechnologiesController(
    undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, spy, undefined as any,
  );
  const noApplications = { tenantId: 'x', permissions: { infrastructure: 'member' }, manager: {} } as any;
  await assert.rejects(() => controller.exportApplicationLinks('data', 'en', {} as any, noApplications), /cannot read applications/);
  await assert.rejects(() => controller.importApplicationLinks(csvFile(APP_HEADER), 'false', 'en', noApplications), /cannot read applications/);
  assert.equal(called, false, 'nothing is read or written without the applications right');
}

runSpecs('technology-links-csv.integration.spec', [
  ['round trip', testRoundTrip],
  ['create and provenance', testCreateProvenance],
  ['manual provenance stays', testKeepsManualProvenance],
  ['servers with the same name', testHomonymServers],
  ['row errors write nothing', testRowErrors],
  ['operating system', testOperatingSystem],
  ['operating system: an empty cell follows the server page', testOperatingSystemDefault],
  ['tenant isolation', testTenantIsolation],
  ['routes', testRoutes],
  ['applications: round trip and provenance', testApplicationRoundTripAndProvenance],
  ['applications: errors and scope', testApplicationErrorsAndScope],
  ['applications: routes and rights', testApplicationRoutes],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
