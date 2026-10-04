import 'dotenv/config';
import * as assert from 'node:assert/strict';
import dataSource from '../../data-source';
import { resolveDefaultAxisId } from '../analytics-axes.util';
import {
  context,
  csvFile,
  runSpecs,
  seedTenant,
  services,
  withRollback,
} from './analytics-test-helpers';

// The values CSV (`axis_code;name;description;status;disabled_at`): a blank
// dimension code is the default dimension, an unknown code or a disabled
// dimension is a row error, a dry run writes nothing, the whole file is
// checked before any write, and an export imported back is all unchanged.

const HEADER = 'axis_code;name;description;status;disabled_at';
/** The input files below stay `;` (a `;` file still loads); an English export is `,`-separated now. */
const EXPORT_HEADER = HEADER.split(';').join(',');

async function count(tenantId: string, runner: { query: (sql: string, params: unknown[]) => Promise<any> }) {
  const [row] = await runner.query(
    `SELECT (SELECT count(*)::int FROM analytics_categories WHERE tenant_id = $1) AS values,
            (SELECT count(*)::int FROM audit_log WHERE tenant_id = $1) AS audit`,
    [tenantId],
  );
  return { values: row.values as number, audit: row.audit as number };
}

async function testImportRules() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv');
    const { axes, values, csv } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const nature = await axes.create({ code: 'nature', name: 'Nature' }, ctx);
    await axes.create({ code: 'retired', name: 'Retired', status: 'disabled' }, ctx);
    const defaultId = await resolveDefaultAxisId(runner.manager, tenantId);

    // Row errors: the whole file is refused and nothing is written, even without dry run.
    const before = await count(tenantId, runner);
    const refused = await csv.importCsv({
      file: csvFile([
        HEADER,
        ';Licences;Software;enabled;',
        'unknown;Lost;;enabled;',
        'retired;Late;;enabled;',
        'nature;Hardware;;maybe;',
        'NATURE;Services;;enabled;',
        'nature;services;;enabled;',
        ';;No name;enabled;',
      ].join('\n')),
      dryRun: false,
    }, ctx);
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.errors, [
      { row: 3, message: "Unknown dimension 'unknown'." },
      { row: 4, message: 'The Retired dimension is disabled. Enable it or leave it out.' },
      { row: 5, message: "Invalid status 'maybe'. Use 'enabled' or 'disabled'." },
      { row: 7, message: 'services is already on row 6.' },
      { row: 8, message: 'Name is required.' },
    ]);
    assert.deepEqual(await count(tenantId, runner), before, 'a refused file writes nothing');

    // Dry run of a clean file: counts, no write.
    const file = [
      HEADER,
      ';Licences;Software;enabled;',
      'nature;Hardware;;enabled;',
      'nature;Other;;disabled;',
      'default;Other;In the default dimension;enabled;',
    ].join('\n');
    const dry = await csv.importCsv({ file: csvFile(file), dryRun: true }, ctx);
    assert.deepEqual(
      { ok: dry.ok, dryRun: dry.dryRun, total: dry.total, inserted: dry.inserted, updated: dry.updated, unchanged: dry.unchanged },
      { ok: true, dryRun: true, total: 4, inserted: 4, updated: 0, unchanged: 0 },
    );
    assert.deepEqual(await count(tenantId, runner), before, 'a dry run writes nothing');

    const loaded = await csv.importCsv({ file: csvFile(file), dryRun: false }, ctx);
    assert.equal(loaded.ok, true);
    assert.equal(loaded.inserted, 4);
    const stored = await runner.query(
      `SELECT c.name, c.description, c.status::text AS status, a.code
         FROM analytics_categories c JOIN analytics_axes a ON a.id = c.axis_id AND a.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 ORDER BY a.code, c.name`,
      [tenantId],
    );
    assert.deepEqual(stored.map((row: any) => [row.code, row.name, row.description, row.status]), [
      ['default', 'Licences', 'Software', 'enabled'],
      ['default', 'Other', 'In the default dimension', 'enabled'],
      ['nature', 'Hardware', null, 'enabled'],
      ['nature', 'Other', null, 'disabled'],
    ]);
    const licences = (await values.list({ axis_id: defaultId }, ctx)).items.find((item) => item.name === 'Licences');
    assert.ok(licences, 'a blank code went into the default dimension');

    // Matches on (dimension, name) case-insensitively; an absent column keeps what is stored.
    const update = await csv.importCsv({
      file: csvFile(['axis_code;name;status', 'nature;HARDWARE;disabled', ';licences;enabled'].join('\n')),
      dryRun: false,
    }, ctx);
    assert.deepEqual([update.ok, update.inserted, update.updated, update.unchanged], [true, 0, 1, 1]);
    const [hardware] = await runner.query(
      `SELECT name, status::text AS status FROM analytics_categories WHERE tenant_id = $1 AND axis_id = $2 AND lower(name) = 'hardware'`,
      [tenantId, nature.id],
    );
    assert.deepEqual([hardware.name, hardware.status], ['Hardware', 'disabled'], 'the stored name is kept, the status follows the file');
    const [licencesRow] = await runner.query(
      `SELECT description FROM analytics_categories WHERE tenant_id = $1 AND name = 'Licences'`,
      [tenantId],
    );
    assert.equal(licencesRow.description, 'Software', 'an absent description column keeps the stored one');

    // Header rules.
    const badHeader = await csv.importCsv({ file: csvFile('axis_code;label\nnature;x\n'), dryRun: true }, ctx);
    assert.deepEqual(badHeader.errors, [{ row: 0, message: 'Header mismatch. Missing: name, Extra: label' }]);
  });
}

async function testExportImportRoundTrip() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-roundtrip');
    const { axes, values, csv } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const nature = await axes.create({ code: 'nature', name: 'Nature' }, ctx);
    await values.create({ name: 'Licences', description: 'Software; with a semicolon' }, null, ctx);
    await values.create({ name: 'Other' }, null, ctx);
    await values.create({ axis_id: nature.id, name: 'Other', status: 'disabled' }, null, ctx);
    await values.create({ axis_id: nature.id, name: '=Formula', disabled_at: '2031-06-30' }, null, ctx);
    // A disabled dimension's values are exported too and must come back unchanged.
    const retired = await axes.create({ code: 'retired', name: 'Retired' }, ctx);
    await values.create({ axis_id: retired.id, name: 'Legacy', description: 'Kept as it is' }, null, ctx);
    await axes.update(retired.id, { status: 'disabled' }, ctx);

    const template = await csv.exportCsv('template', ctx);
    assert.equal(template.filename, 'analytics_values_template.csv');
    assert.equal(template.content.replace('﻿', '').trim(), EXPORT_HEADER);

    const exported = await csv.exportCsv('data', ctx);
    assert.equal(exported.filename, 'analytics_values.csv');
    const lines = exported.content.replace('﻿', '').trim().split('\n');
    assert.equal(lines[0], EXPORT_HEADER);
    assert.equal(lines.length, 6, 'every value, disabled ones and disabled dimensions included');
    assert.ok(lines[1].startsWith('default,'), 'the default dimension comes first');

    const before = await count(tenantId, runner);
    const result = await csv.importCsv({ file: csvFile(exported.content), dryRun: false }, ctx);
    assert.deepEqual(
      [result.ok, result.total, result.inserted, result.updated, result.unchanged, result.errors],
      [true, 5, 0, 0, 5, []],
    );
    assert.deepEqual(await count(tenantId, runner), before, 'unchanged rows write no audit row');

    // In the disabled dimension an edit or a new value is still refused, and the file writes nothing.
    const edited = await csv.importCsv({
      file: csvFile([HEADER, 'retired;Legacy;Changed;enabled;', 'retired;Newcomer;;enabled;', ';Other;Changed too;enabled;'].join('\n')),
      dryRun: false,
    }, ctx);
    assert.equal(edited.ok, false);
    assert.deepEqual(edited.errors, [
      { row: 2, message: 'The Retired dimension is disabled. Enable it or leave it out.' },
      { row: 3, message: 'The Retired dimension is disabled. Enable it or leave it out.' },
    ]);
    assert.deepEqual(await count(tenantId, runner), before);
  });
}

async function testNoDimensionYet() {
  await withRollback(async (runner) => {
    // A tenant inserted raw has no dimension: a dry run does not create one, the load does.
    const tenantId = await seedTenant(runner, 'csv-empty');
    const { csv } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    const file = csvFile(`${HEADER}\n;Licences;;;\n`);
    const dry = await csv.importCsv({ file, dryRun: true }, ctx);
    assert.deepEqual([dry.ok, dry.inserted], [true, 1]);
    assert.equal(await resolveDefaultAxisId(runner.manager, tenantId), null);
    const loaded = await csv.importCsv({ file, dryRun: false }, ctx);
    assert.deepEqual([loaded.ok, loaded.inserted], [true, 1]);
    const defaultId = await resolveDefaultAxisId(runner.manager, tenantId);
    assert.ok(defaultId);
    const [row] = await runner.query(`SELECT axis_id FROM analytics_categories WHERE tenant_id = $1`, [tenantId]);
    assert.equal(row.axis_id, defaultId);
  });
}

async function testEndOfValidityFormat() {
  await withRollback(async (runner) => {
    const tenantId = await seedTenant(runner, 'csv-date');
    const { axes, csv } = services(runner.manager);
    const ctx = context(runner.manager, tenantId);
    await axes.create({ code: 'nature', name: 'Nature' }, ctx);
    const message = (value: string) => `Invalid disabled_at '${value}'. Use YYYY-MM-DD or a full ISO date and time.`;
    // C4 replaced the interim ISO-only rule: a local day is read under the file's
    // order, and only a file that shows no evidence asks the screen's language.
    const local = await csv.importCsv({
      file: csvFile([
        HEADER,
        'nature;Day first;;;31/12/2027',
        'nature;Settled by the file;;;01/03/2027',
      ].join('\n') + '\n'),
      dryRun: false,
    }, ctx);
    assert.equal(local.ok, true, JSON.stringify(local.errors));
    assert.equal(local.notices.dates, null, '31/12/2027 settles the order, so no notice');
    const localRows = await runner.query(
      `SELECT name, disabled_at FROM analytics_categories WHERE tenant_id = $1 ORDER BY name`,
      [tenantId],
    );
    assert.deepEqual(
      localRows.map((row: { name: string; disabled_at: Date }) => [row.name, new Date(row.disabled_at).toISOString()]),
      [['Day first', '2027-12-31T12:00:00.000Z'], ['Settled by the file', '2027-03-01T12:00:00.000Z']],
    );

    const ambiguous = await csv.importCsv({
      file: csvFile([HEADER, 'nature;Ambiguous;;;01/03/2027'].join('\n') + '\n'),
      dryRun: false,
    }, ctx);
    assert.equal(ambiguous.ok, true, JSON.stringify(ambiguous.errors));
    assert.equal(ambiguous.notices.dates, 'Dates read month first: 01/03/2027 is January 3.');
    const [ambiguousRow] = await runner.query(
      `SELECT disabled_at FROM analytics_categories WHERE tenant_id = $1 AND name = 'Ambiguous'`,
      [tenantId],
    );
    assert.equal(new Date(ambiguousRow.disabled_at).toISOString(), '2027-01-03T12:00:00.000Z', 'English reads 01/03/2027 as January 3');

    // `-` clears a detail that allows it, never an end of validity; an unreadable cell stays a row error.
    const refused = await csv.importCsv({
      file: csvFile([
        HEADER,
        'nature;Dash;;;-',
        'nature;Junk;;;not-a-date',
      ].join('\n') + '\n'),
      dryRun: false,
    }, ctx);
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.errors, [
      { row: 2, message: message('-') },
      { row: 3, message: message('not-a-date') },
    ]);
    const [refusedCount] = await runner.query(
      `SELECT count(*)::int AS n FROM analytics_categories WHERE tenant_id = $1 AND name = ANY($2::text[])`,
      [tenantId, ['Dash', 'Junk']],
    );
    assert.equal(refusedCount.n, 0);

    // A blank status skips the "enabled, but the date has passed" check, so the case still passes after 2027-03-01.
    const accepted = await csv.importCsv({
      file: csvFile([
        HEADER,
        'nature;Bare day;;;2027-03-01',
        'nature;Timestamp;;;2027-03-01T15:04:05.000Z',
      ].join('\n') + '\n'),
      dryRun: false,
    }, ctx);
    assert.equal(accepted.ok, true, JSON.stringify(accepted.errors));
    const rows = await runner.query(
      `SELECT name, disabled_at FROM analytics_categories WHERE tenant_id = $1 AND name = ANY($2::text[]) ORDER BY name`,
      [tenantId, ['Bare day', 'Timestamp']],
    );
    assert.deepEqual(
      rows.map((row: { name: string; disabled_at: Date }) => [row.name, new Date(row.disabled_at).toISOString()]),
      [['Bare day', '2027-03-01T12:00:00.000Z'], ['Timestamp', '2027-03-01T15:04:05.000Z']],
    );
  });
}

void dataSource;

runSpecs('analytics-categories-csv.integration.spec', [
  testImportRules,
  testExportImportRoundTrip,
  testNoDimensionYet,
  testEndOfValidityFormat,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
