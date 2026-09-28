import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { WORKING_DAY_PROFILE_CSV_HEADERS } from '../working-day-profiles-csv.service';
import { auditCount, context, FR218, runSpecs, seedTenant, services, withRollback } from './working-day-profile-test-helpers';

// The calendars CSV: one row per calendar and year, folded into one calendar
// per code; the whole file is validated before anything is written (rows of a
// code agree, a year appears once, a row with a year gives twelve months);
// years absent from the file are kept; counts per row; a dry run writes
// nothing; an export imports back as all unchanged.

const HEADER = WORKING_DAY_PROFILE_CSV_HEADERS.join(';');
const DE_OFFICE = ['21', '20', '22', '20', '19', '21', '23', '21', '21', '21', '20', '20'];

function file(lines: string[], header = HEADER): Express.Multer.File {
  return { buffer: Buffer.from(`﻿${header}\n${lines.join('\n')}\n`, 'utf8'), originalname: 'working_day_calendars.csv' } as Express.Multer.File;
}

type RowFields = { description?: string; country?: string; region?: string; status?: string; disabledAt?: string };
const row = (code: string, name: string, year: string, days: string[], rest: RowFields = {}) =>
  [code, name, rest.description ?? '', rest.country ?? '', rest.region ?? '', rest.status ?? 'enabled', rest.disabledAt ?? '', year, ...days].join(';');

const noDays = Array.from({ length: 12 }, () => '');

async function seed(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const { svc, csv } = services(runner.manager);
  return { tenantId, svc, csv, ctx: context(runner.manager, tenantId) };
}

async function calendars(runner: QueryRunner, tenantId: string) {
  const rows = await runner.query(
    `SELECT code, name, description, days_by_year FROM working_day_profiles WHERE tenant_id = $1 ORDER BY code`,
    [tenantId],
  );
  return new Map(rows.map((entry: any) => [entry.code, entry]));
}

async function testMultiYearRoundTrip() {
  await withRollback(async (runner) => {
    const { tenantId, csv, ctx } = await seed(runner, 'trip');
    const fractional = [...FR218.slice(0, 11), '19,0833330'];
    const lines = [
      row('FR218', 'France 218', '2027', FR218, { description: 'Office staff' }),
      row('fr218', 'France 218', '2026', fractional, { description: 'Office staff' }),
      row('DE-OFF', 'Germany office', '2026', DE_OFFICE),
      row('EMPTY', 'No years yet', '', noDays, { status: '' }),
    ];
    const dry = await csv.importCsv({ file: file(lines), dryRun: true }, ctx);
    assert.equal(dry.ok, true, JSON.stringify(dry.errors));
    assert.deepEqual([dry.total, dry.inserted, dry.updated, dry.unchanged], [4, 4, 0, 0]);
    assert.equal((await calendars(runner, tenantId)).size, 0, 'a dry run writes nothing');
    assert.equal(await auditCount(runner, tenantId), 0);

    const done = await csv.importCsv({ file: file(lines), dryRun: false }, ctx);
    assert.equal(done.ok, true, JSON.stringify(done.errors));
    assert.deepEqual([done.inserted, done.updated, done.unchanged], [4, 0, 0]);
    const stored = await calendars(runner, tenantId);
    assert.deepEqual([...stored.keys()], ['DE-OFF', 'EMPTY', 'FR218']);
    const fr: any = stored.get('FR218');
    assert.equal(fr.description, 'Office staff');
    assert.deepEqual(Object.keys(fr.days_by_year), ['2026', '2027'], 'two rows, one calendar');
    assert.equal(fr.days_by_year['2026'][11], '19.083333');
    assert.deepEqual((stored.get('EMPTY') as any).days_by_year, {});
    assert.equal(await auditCount(runner, tenantId, 'create'), 3, 'one audit row per calendar written');

    const exported = await csv.exportCsv('data', ctx);
    assert.equal(exported.filename, 'working_day_calendars.csv');
    const exportedLines = exported.content.replace(/^﻿/, '').trim().split('\n');
    assert.equal(exportedLines[0], HEADER);
    assert.deepEqual(exportedLines.slice(1).map((line) => line.split(';').slice(0, 8).join(';')), [
      'DE-OFF;Germany office;;;;enabled;;2026',
      'EMPTY;No years yet;;;;enabled;;',
      'FR218;France 218;Office staff;;;enabled;;2026',
      'FR218;France 218;Office staff;;;enabled;;2027',
    ]);
    assert.equal(exportedLines[3].split(';')[19], '19.083333');

    const again = await csv.importCsv({
      file: { buffer: Buffer.from(exported.content, 'utf8'), originalname: exported.filename } as Express.Multer.File,
      dryRun: false,
    }, ctx);
    assert.equal(again.ok, true, JSON.stringify(again.errors));
    assert.deepEqual([again.total, again.inserted, again.updated, again.unchanged], [4, 0, 0, 4]);
    assert.equal(await auditCount(runner, tenantId), 3, 'an unchanged import writes nothing');

    const template = await csv.exportCsv('template', ctx);
    assert.equal(template.content.replace(/^﻿/, '').trim(), HEADER);
  });
}

async function testAbsentYearsKept() {
  await withRollback(async (runner) => {
    const { tenantId, svc, csv, ctx } = await seed(runner, 'keep');
    await svc.create({ code: 'FR218', name: 'France 218', days_by_year: { 2026: FR218, 2027: FR218 } }, ctx);
    const changed = [...FR218];
    changed[0] = '17.5';
    const result = await csv.importCsv({
      file: file([
        row('FR218', 'France 218', '2027', changed),
        row('FR218', 'France 218', '2028', FR218),
        row('FR218', 'France 218', '2026', FR218),
      ]),
      dryRun: false,
    }, ctx);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.deepEqual([result.inserted, result.updated, result.unchanged], [1, 1, 1], 'new year, changed year, same year');
    const fr: any = (await calendars(runner, tenantId)).get('FR218');
    assert.deepEqual(Object.keys(fr.days_by_year), ['2026', '2027', '2028']);
    assert.equal(fr.days_by_year['2027'][0], '17.5');

    // A file without any year of the calendar keeps them all; a changed name is one update.
    const renamed = await csv.importCsv({ file: file([row('FR218', 'France 218 days', '', noDays)]), dryRun: false }, ctx);
    assert.deepEqual([renamed.ok, renamed.inserted, renamed.updated, renamed.unchanged], [true, 0, 1, 0]);
    const after: any = (await calendars(runner, tenantId)).get('FR218');
    assert.equal(after.name, 'France 218 days');
    assert.deepEqual(Object.keys(after.days_by_year), ['2026', '2027', '2028'], 'an import never removes a year');
    assert.equal(await auditCount(runner, tenantId, 'update'), 2);

    // Disabling through the file: the calendar keeps its years.
    const disabled = await csv.importCsv({ file: file([row('FR218', 'France 218 days', '2026', FR218, { status: 'disabled' })]), dryRun: false }, ctx);
    assert.deepEqual([disabled.ok, disabled.updated], [true, 1]);
    const [stored] = await runner.query(`SELECT status, disabled_at FROM working_day_profiles WHERE tenant_id = $1 AND code = 'FR218'`, [tenantId]);
    assert.equal(stored.status, 'disabled');
    assert.ok(stored.disabled_at);
  });
}

async function testRowErrors() {
  await withRollback(async (runner) => {
    const { tenantId, svc, csv, ctx } = await seed(runner, 'errors');
    await svc.create({ code: 'DE-OFF', name: 'Germany office' }, ctx);
    const eleven = [...FR218.slice(0, 11), ''];
    const leap = [...FR218];
    leap[1] = '29';
    const result = await csv.importCsv({
      file: file([
        row('FR218', 'France 218', '2026', FR218),
        row('FR218', 'France 218 bis', '2027', FR218),
        row('FR218', 'France 218', '2026', FR218),
        row('FR218', 'France 218', '2028', FR218, { description: 'Other' }),
        row('ES', 'Spain', '2027', eleven),
        row('IT', 'Italy', '2027', leap),
        row('PT', 'Portugal', '', FR218),
        row('NL', 'Germany Office', '2027', FR218),
        row('', 'No code', '2027', FR218),
        row('BE', 'Belgium', '2027', FR218, { status: 'paused' }),
        row('LU', 'Luxembourg', '1999', FR218),
      ]),
      dryRun: false,
    }, ctx);
    assert.equal(result.ok, false);
    assert.deepEqual(result.errors, [
      { row: 3, message: 'Rows of FR218 disagree on the name.' },
      { row: 4, message: 'FR218 has 2026 twice (rows 2 and 4).' },
      { row: 5, message: 'Rows of FR218 disagree on the description.' },
      { row: 6, message: 'Enter the working days of all twelve months of 2027.' },
      { row: 7, message: 'February 2027 has 28 days: enter 28 or less.' },
      { row: 8, message: 'Give the year of these working days.' },
      { row: 9, message: 'A calendar named Germany Office already exists.' },
      { row: 10, message: 'Code is required.' },
      { row: 11, message: "Invalid status 'paused'. Use 'enabled' or 'disabled'." },
      { row: 12, message: '1999 is not a year between 2000 and 2100.' },
    ]);
    assert.deepEqual([...(await calendars(runner, tenantId)).keys()], ['DE-OFF'], 'nothing is written when a row fails');

    // Two calendars of the file cannot share a name either.
    const clash = await csv.importCsv({ file: file([row('A', 'Same', '', noDays), row('B', 'same', '', noDays)]), dryRun: true }, ctx);
    assert.deepEqual(clash.errors, [{ row: 3, message: 'A calendar named same already exists.' }]);

    const badHeader = await csv.importCsv({ file: file(['x'], 'code;name;year;jan'), dryRun: true }, ctx);
    assert.equal(badHeader.ok, false);
    assert.equal(badHeader.errors[0].row, 0);
    assert.match(badHeader.errors[0].message, /^Header mismatch\. Missing: description, status, feb/);
  });
}

async function testOptionalEndOfValidity() {
  await withRollback(async (runner) => {
    const { tenantId, csv, ctx } = await seed(runner, 'optional');
    const header = WORKING_DAY_PROFILE_CSV_HEADERS.filter((name) => name !== 'disabled_at').join(';');
    const result = await csv.importCsv({
      file: file([['FR218', 'France 218', '', '', '', 'enabled', '2026', ...FR218].join(';')], header),
      dryRun: false,
    }, ctx);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.equal(result.inserted, 1);

    // With the column, a date sets the end of validity; every row of the code must carry the same one.
    const dated = await csv.importCsv({
      file: file([
        row('FR218', 'France 218', '2026', FR218, { disabledAt: '2099-12-31' }),
        row('FR218', 'France 218', '2027', FR218, { disabledAt: '2099-12-30' }),
      ]),
      dryRun: true,
    }, ctx);
    assert.deepEqual(dated.errors, [{ row: 3, message: 'Rows of FR218 disagree on the end of validity.' }]);
    const [stored] = await runner.query(`SELECT disabled_at FROM working_day_profiles WHERE tenant_id = $1`, [tenantId]);
    assert.equal(stored.disabled_at, null);
  });
}

/**
 * Standard calendars in the file: the country and region are applied on
 * creation, exported as codes with the edited years only, blank or unchanged
 * on an existing calendar; year rows of a standard calendar are edited years.
 */
async function testStandardCalendars() {
  await withRollback(async (runner) => {
    const { tenantId, svc, csv, ctx } = await seed(runner, 'standard');
    const lines = [
      row('FR', 'France', '', noDays, { country: 'fr' }),
      row('FR-57', 'France (Moselle)', '2026', FR218, { country: 'FR', region: '57' }),
      row('DE-BY', 'Bavaria', '', noDays, { country: 'DE', region: 'by' }),
    ];
    const done = await csv.importCsv({ file: file(lines), dryRun: false }, ctx);
    assert.equal(done.ok, true, JSON.stringify(done.errors));
    assert.deepEqual([done.inserted, done.updated, done.unchanged], [3, 0, 0]);
    const stored = await runner.query(
      `SELECT code, country_iso, region_code, days_by_year FROM working_day_profiles WHERE tenant_id = $1 ORDER BY code`,
      [tenantId],
    );
    assert.deepEqual(stored.map((entry: any) => [entry.code, entry.country_iso, entry.region_code, Object.keys(entry.days_by_year)]), [
      ['DE-BY', 'DE', 'BY', []],
      ['FR', 'FR', null, []],
      ['FR-57', 'FR', '57', ['2026']],
    ], 'codes as the rules know them; the year row is an edited year');

    const exported = await csv.exportCsv('data', ctx);
    const exportedLines = exported.content.replace(/^\uFEFF/, '').trim().split('\n');
    assert.deepEqual(exportedLines.slice(1).map((line) => line.split(';').slice(0, 8).join(';')), [
      'DE-BY;Bavaria;;DE;BY;enabled;;',
      'FR;France;;FR;;enabled;;',
      'FR-57;France (Moselle);;FR;57;enabled;;2026',
    ], 'a standard calendar exports its edited years only');
    const again = await csv.importCsv({
      file: { buffer: Buffer.from(exported.content, 'utf8'), originalname: exported.filename } as Express.Multer.File,
      dryRun: false,
    }, ctx);
    assert.deepEqual([again.ok, again.inserted, again.updated, again.unchanged], [true, 0, 0, 3], JSON.stringify(again.errors));

    // Blank cells keep the source; a new year on a standard calendar is an edited year.
    const custom = await svc.create({ code: 'CUSTOM', name: 'Custom days' }, ctx);
    const added = await csv.importCsv({ file: file([row('FR', 'France', '2027', FR218)]), dryRun: false }, ctx);
    assert.deepEqual([added.ok, added.inserted, added.updated], [true, 1, 0], JSON.stringify(added.errors));
    const [france] = await runner.query(
      `SELECT country_iso, region_code, days_by_year FROM working_day_profiles WHERE tenant_id = $1 AND code = 'FR'`,
      [tenantId],
    );
    assert.deepEqual([france.country_iso, france.region_code, Object.keys(france.days_by_year)], ['FR', null, ['2027']]);

    const refused = await csv.importCsv({
      file: file([
        row('ZZ1', 'Nowhere', '', noDays, { country: 'ZZ' }),
        row('FR-BY', 'Wrong region', '', noDays, { country: 'FR', region: 'BY' }),
        row('R57', 'Region only', '', noDays, { region: '57' }),
        row('FR', 'France', '', noDays, { country: 'DE' }),
        row('CUSTOM', 'Custom days', '', noDays, { country: 'FR' }),
        row('FR-57', 'France (Moselle)', '', noDays, { country: 'FR', region: '67' }),
        row('NEW', 'New calendar', '2026', FR218, { country: 'FR' }),
        row('NEW', 'New calendar', '2027', FR218, { country: 'DE' }),
      ]),
      dryRun: false,
    }, ctx);
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.errors, [
      { row: 2, message: 'Country ZZ is not in the list.' },
      { row: 3, message: 'BY is not a region of France.' },
      { row: 4, message: 'Give the country of region 57.' },
      { row: 5, message: 'The country of a calendar cannot be changed. Create another calendar.' },
      { row: 6, message: 'The country of a calendar cannot be changed. Create another calendar.' },
      { row: 7, message: 'The country of a calendar cannot be changed. Create another calendar.' },
      { row: 9, message: 'Rows of NEW disagree on the country.' },
    ]);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM working_day_profiles WHERE tenant_id = $1`, [tenantId]);
    assert.equal(n, 4, 'nothing is written when a row fails');
    assert.equal((await svc.get(custom.id, ctx)).country_iso, null, 'a custom calendar stays custom');

    // A file without the two columns keeps the source of the existing calendars.
    const header = WORKING_DAY_PROFILE_CSV_HEADERS.filter((name) => name !== 'country' && name !== 'region').join(';');
    const without = await csv.importCsv({
      file: file([['FR-57', 'France (Moselle)', 'Metz office', 'enabled', '', '', ...noDays].join(';')], header),
      dryRun: false,
    }, ctx);
    assert.deepEqual([without.ok, without.updated], [true, 1], JSON.stringify(without.errors));
    const [moselle] = await runner.query(
      `SELECT description, country_iso, region_code FROM working_day_profiles WHERE tenant_id = $1 AND code = 'FR-57'`,
      [tenantId],
    );
    assert.deepEqual(moselle, { description: 'Metz office', country_iso: 'FR', region_code: '57' });
  });
}

/** Names moving between calendars: a swap and a chain pass the dry run and the load, with audit rows on the real change. */
async function testRenamesAcrossCalendars() {
  for (const [label, lines, expected] of [
    ['swap', [row('A', 'Bravo', '', noDays), row('B', 'Alpha', '', noDays)], { A: 'Bravo', B: 'Alpha' }],
    ['chain', [row('A', 'Bravo', '', noDays), row('B', 'Charlie', '', noDays)], { A: 'Bravo', B: 'Charlie' }],
  ] as const) {
    await withRollback(async (runner) => {
      const { tenantId, svc, csv, ctx } = await seed(runner, `rename-${label}`);
      const a = await svc.create({ code: 'A', name: 'Alpha', days_by_year: { 2026: FR218 } }, ctx);
      const b = await svc.create({ code: 'B', name: 'Bravo' }, ctx);

      const dry = await csv.importCsv({ file: file([...lines]), dryRun: true }, ctx);
      assert.deepEqual([dry.ok, dry.updated, dry.unchanged], [true, 2, 0], `${label} dry run: ${JSON.stringify(dry.errors)}`);
      const done = await csv.importCsv({ file: file([...lines]), dryRun: false }, ctx);
      assert.deepEqual([done.ok, done.updated, done.unchanged], [true, 2, 0], `${label} load: ${JSON.stringify(done.errors)}`);

      const stored = await calendars(runner, tenantId);
      assert.deepEqual({ A: (stored.get('A') as any).name, B: (stored.get('B') as any).name }, expected, label);
      assert.deepEqual(Object.keys((stored.get('A') as any).days_by_year), ['2026'], `${label}: the years stay`);

      // One update row per calendar, from the stored name straight to the final one.
      const audits: Array<{ record_id: string; before: string; after: string }> = await runner.query(
        `SELECT record_id, before_json->>'name' AS before, after_json->>'name' AS after FROM audit_log
          WHERE tenant_id = $1 AND table_name = 'working_day_profiles' AND action = 'update'
          ORDER BY before_json->>'name'`,
        [tenantId],
      );
      assert.deepEqual(audits, [
        { record_id: a.id, before: 'Alpha', after: expected.A },
        { record_id: b.id, before: 'Bravo', after: expected.B },
      ], label);
    });
  }
}

runSpecs('working-day-profiles-csv.integration.spec', [
  testRenamesAcrossCalendars,
  testMultiYearRoundTrip,
  testAbsentYearsKept,
  testRowErrors,
  testOptionalEndOfValidity,
  testStandardCalendars,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
