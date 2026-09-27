import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { ensureDefaultAnalyticsAxis } from '../../analytics/analytics-axes.util';
import { assert, inRolledBackTransaction, Kind, runSpecs, seedTenant, setTenant } from './round-inputs.fixtures';
import { csvService, ITEM_TABLE, seedCompany } from './cost-center.fixtures';

// The analytics columns of the OPEX and CAPEX item CSVs (one rule for both):
// - analytics_category is the default dimension (older files import
//   unchanged); analytics:<code> is any enabled dimension by its code;
// - an unknown or disabled dimension column, or two columns for one
//   dimension (the alias and the default's code), refuse the file;
// - every analytics column is optional: absent leaves the stored values,
//   present and blank clears;
// - a name is looked up within its own dimension (case-insensitive); an
//   unknown one is created in that dimension only, under the value name rules
//   (a row error of the dry run otherwise); a disabled value that is not the
//   line's current one is a row error found by the dry run;
// - export writes analytics_category then one analytics:<code> column per
//   enabled non-default dimension; export then import changes nothing.
// runSpecs opens the data-source, so test:ci runs this file in its database lane.

const KINDS: Kind[] = ['opex', 'capex'];
const COMPANY = 'Csv analytics company';
const LINK_TABLE: Record<Kind, string> = { opex: 'spend_item_analytics_values', capex: 'capex_item_analytics_values' };

function csvFile(headers: string[], rows: Array<Record<string, string>>) {
  const lines = rows.map((values) => headers.map((h) => values[h] ?? '').join(';'));
  return { buffer: Buffer.from(`${headers.join(';')}\n${lines.join('\n')}\n`, 'utf8') } as any;
}

function row(kind: Kind, name: string, extra: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = kind === 'opex'
    ? { product_name: name, company_name: COMPANY, account_number: '6000', currency: 'EUR', status: 'enabled' }
    : { description: name, company_name: COMPANY, ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium', currency: 'EUR', status: 'enabled' };
  return { ...base, ...extra };
}

/** The base headers with analytics:nature right after analytics_category. */
function withNature(headers: string[]): string[] {
  const at = headers.indexOf('analytics_category');
  return [...headers.slice(0, at + 1), 'analytics:nature', ...headers.slice(at + 1)];
}

type Setup = { tenantId: string; main: string; nature: string; old: string; retired: string };

async function setup(runner: QueryRunner, kind: Kind): Promise<Setup> {
  const tenantId = await seedTenant(runner, `csv-analytics-${kind}`);
  await setTenant(runner, tenantId);
  await seedCompany(runner, tenantId, COMPANY);
  const main = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
  const axis = async (code: string, name: string, sortOrder: number, disabled = false) => {
    const [r] = await runner.query(
      `INSERT INTO analytics_axes (tenant_id, code, name, sort_order, status, disabled_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenantId, code, name, sortOrder, disabled ? 'disabled' : 'enabled', disabled ? new Date(Date.now() - 86_400_000) : null],
    );
    return r.id as string;
  };
  const nature = await axis('nature', 'Nature', 1);
  const old = await axis('old', 'Old axis', 2, true);
  const value = async (axisId: string, name: string, disabled = false) => {
    const [r] = await runner.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name, status, disabled_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, axisId, name, disabled ? 'disabled' : 'enabled', disabled ? new Date(Date.now() - 86_400_000) : null],
    );
    return r.id as string;
  };
  await value(main, 'Licences');
  await value(main, 'Other');
  await value(nature, 'Other');
  await value(nature, 'Hardware');
  const retired = await value(nature, 'Retired', true);
  await value(old, 'Legacy');
  return { tenantId, main, nature, old, retired };
}

/** "<line> | <dimension code> | <value>" for every link of the tenant, sorted. */
async function linkLines(runner: QueryRunner, kind: Kind, tenantId: string): Promise<string[]> {
  const name = kind === 'opex' ? 'product_name' : 'description';
  const rows: Array<{ line: string; code: string; value: string }> = await runner.query(
    `SELECT i.${name} AS line, ax.code, c.name AS value
       FROM ${LINK_TABLE[kind]} v
       JOIN ${ITEM_TABLE[kind]} i ON i.id = v.item_id
       JOIN analytics_axes ax ON ax.id = v.axis_id
       JOIN analytics_categories c ON c.id = v.category_id
      WHERE v.tenant_id = $1`,
    [tenantId],
  );
  return rows.map((r) => `${r.line} | ${r.code} | ${r.value}`).sort();
}

async function valuesOf(runner: QueryRunner, axisId: string): Promise<string[]> {
  const rows: Array<{ name: string }> = await runner.query(`SELECT name FROM analytics_categories WHERE axis_id = $1 ORDER BY name`, [axisId]);
  return rows.map((r) => r.name);
}

function errorsOf(result: any): string[] {
  return result.errors.map((e: any) => `${e.row}: ${e.message}`);
}

async function testLegacyHeader(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = csvService(kind);
    const opts = { manager: runner.manager };
    const headers: string[] = svc.csvHeaders();
    assert.ok(headers.includes('analytics_category'), `${kind}: the base headers keep analytics_category`);
    const result = await svc.importCsv({
      file: csvFile(headers, [row(kind, 'Alpha', { analytics_category: 'licences' }), row(kind, 'Bravo', { analytics_category: 'Brand new value' })]),
      dryRun: false,
      userId: null,
    }, opts);
    assert.deepEqual(result.errors, [], `${kind}: the file loads`);
    assert.deepEqual(await linkLines(runner, kind, s.tenantId), [
      'Alpha | default | Licences',
      'Bravo | default | Brand new value',
    ], `${kind}: analytics_category writes the default dimension, case-insensitively`);
    assert.deepEqual(await valuesOf(runner, s.main), ['Brand new value', 'Licences', 'Other'], `${kind}: the new name is created in the default dimension`);
    assert.deepEqual(await valuesOf(runner, s.nature), ['Hardware', 'Other', 'Retired'], `${kind}: and nowhere else`);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${ITEM_TABLE[kind]} WHERE tenant_id = $1 AND analytics_category_id IS NOT NULL`, [s.tenantId]);
    assert.equal(n, 0, `${kind}: the item column is not written`);
  });
}

async function testTwoDimensionRoundTrip(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = csvService(kind);
    const opts = { manager: runner.manager };
    const headers = withNature(svc.csvHeaders());
    const loaded = await svc.importCsv({
      file: csvFile(headers, [
        row(kind, 'Alpha', { analytics_category: 'Licences', 'analytics:nature': 'Hardware' }),
        row(kind, 'Bravo', { analytics_category: '', 'analytics:nature': 'other' }),
        row(kind, 'Charlie', { analytics_category: 'Other' }),
      ]),
      dryRun: false,
      userId: null,
    }, opts);
    assert.deepEqual(loaded.errors, [], `${kind}: the two-dimension file loads`);
    // "Other" exists in both dimensions: each column reads its own.
    const expected = ['Alpha | default | Licences', 'Alpha | nature | Hardware', 'Bravo | nature | Other', 'Charlie | default | Other'];
    assert.deepEqual(await linkLines(runner, kind, s.tenantId), expected);
    // A disabled current value exports and imports back.
    const [bravo] = await runner.query(`SELECT id FROM ${ITEM_TABLE[kind]} WHERE tenant_id = $1 AND ${kind === 'opex' ? 'product_name' : 'description'} = 'Bravo'`, [s.tenantId]);
    await runner.query(`UPDATE ${LINK_TABLE[kind]} SET category_id = $2 WHERE item_id = $1 AND axis_id = $3`, [bravo.id, s.retired, s.nature]);
    const before = await linkLines(runner, kind, s.tenantId);

    const template = await svc.exportCsv('template', opts);
    const templateHeaders = template.content.replace(/^﻿/, '').trim().split(';');
    assert.deepEqual(templateHeaders, headers, `${kind}: the template carries analytics:nature right after analytics_category, not the disabled dimension`);

    const exported = await svc.exportCsv('data', opts);
    const [header, ...dataLines] = exported.content.replace(/^﻿/, '').trim().split('\n');
    const columns = header.split(';');
    assert.deepEqual(columns, headers, `${kind}: the export has the same columns`);
    const alpha = Object.fromEntries(dataLines.find((l: string) => l.includes('Alpha'))!.split(';').map((v: string, i: number) => [columns[i], v]));
    assert.equal(alpha.analytics_category, 'Licences');
    assert.equal(alpha['analytics:nature'], 'Hardware');

    const reimported = await svc.importCsv({ file: { buffer: Buffer.from(exported.content, 'utf8') }, dryRun: false, userId: null }, opts);
    assert.deepEqual(reimported.errors, [], `${kind}: the export imports back`);
    assert.equal(reimported.inserted, 0);
    assert.deepEqual(await linkLines(runner, kind, s.tenantId), before, `${kind}: export then import changes nothing`);
  });
}

async function testFileRefusals(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = csvService(kind);
    const opts = { manager: runner.manager };
    const base: string[] = svc.csvHeaders();
    const cases: Array<[string, string[], string]> = [
      ['unknown dimension', [...base, 'analytics:nope'], '0: The column analytics:nope names no dimension. Check the dimension code or remove the column.'],
      ['disabled dimension', [...base, 'analytics:old'], '0: The Old axis dimension is disabled. Enable it or leave it out.'],
      ['alias and default code', [...base, 'analytics:default'], '0: The file has two columns for the analytics dimension: analytics_category and analytics:default. Keep one.'],
    ];
    for (const [label, headers, message] of cases) {
      for (const dryRun of [true, false]) {
        const result = await svc.importCsv({ file: csvFile(headers, [row(kind, `Refused ${label}`, { analytics_category: 'Licences' })]), dryRun, userId: null }, opts);
        assert.equal(result.ok, false, `${kind} ${label} (dry run ${dryRun}): refused`);
        assert.deepEqual(errorsOf(result), [message], `${kind} ${label} (dry run ${dryRun})`);
      }
    }
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${ITEM_TABLE[kind]} WHERE tenant_id = $1`, [s.tenantId]);
    assert.equal(n, 0, `${kind}: nothing written`);
    // Renamed and recoded, the default dimension still conflicts with its alias.
    await runner.query(`UPDATE analytics_axes SET name = 'Catégorie analytique', code = 'cat' WHERE id = $1`, [s.main]);
    const renamed = await svc.importCsv({ file: csvFile([...base, 'analytics:cat'], [row(kind, 'Renamed')]), dryRun: true, userId: null }, opts);
    assert.deepEqual(errorsOf(renamed), ['0: The file has two columns for the Catégorie analytique dimension: analytics_category and analytics:cat. Keep one.']);
  });
}

async function testAbsentAndBlankColumns(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = csvService(kind);
    const opts = { manager: runner.manager };
    const base: string[] = svc.csvHeaders();
    const both = withNature(base);
    await svc.importCsv({ file: csvFile(both, [row(kind, 'Kept', { analytics_category: 'Licences', 'analytics:nature': 'Hardware' })]), dryRun: false, userId: null }, opts);
    const full = ['Kept | default | Licences', 'Kept | nature | Hardware'];
    assert.deepEqual(await linkLines(runner, kind, s.tenantId), full);

    // An older file without any analytics column leaves both values.
    const older = base.filter((h) => h !== 'analytics_category');
    const noColumns = await svc.importCsv({ file: csvFile(older, [row(kind, 'Kept', { notes: 'older file' })]), dryRun: false, userId: null }, opts);
    assert.deepEqual(noColumns.errors, [], `${kind}: a file without analytics columns imports`);
    assert.equal(noColumns.updated, 1);
    assert.deepEqual(await linkLines(runner, kind, s.tenantId), full, `${kind}: absent columns leave the values`);

    // Only analytics:nature, blank: Nature cleared, the default untouched.
    const natureOnly = [...older, 'analytics:nature'];
    await svc.importCsv({ file: csvFile(natureOnly, [row(kind, 'Kept', { 'analytics:nature': '' })]), dryRun: false, userId: null }, opts);
    assert.deepEqual(await linkLines(runner, kind, s.tenantId), ['Kept | default | Licences'], `${kind}: a blank cell clears its dimension only`);

    // analytics_category present and blank: the default cleared.
    await svc.importCsv({ file: csvFile(base, [row(kind, 'Kept')]), dryRun: false, userId: null }, opts);
    assert.deepEqual(await linkLines(runner, kind, s.tenantId), [], `${kind}: a blank analytics_category clears the default dimension`);
  });
}

async function testValuesPerDimension(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = csvService(kind);
    const opts = { manager: runner.manager };
    const headers = withNature(svc.csvHeaders());
    // "Licences" exists in the default dimension only: in the Nature column it is a new Nature value.
    const result = await svc.importCsv({
      file: csvFile(headers, [
        row(kind, 'Alpha', { analytics_category: 'Licences', 'analytics:nature': 'Licences' }),
        row(kind, 'Bravo', { 'analytics:nature': 'LICENCES' }),
        row(kind, 'Charlie', { 'analytics:nature': 'hardware' }),
      ]),
      dryRun: false,
      userId: null,
    }, opts);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(await valuesOf(runner, s.nature), ['Hardware', 'Licences', 'Other', 'Retired'], `${kind}: created once, in Nature only`);
    assert.deepEqual(await valuesOf(runner, s.main), ['Licences', 'Other'], `${kind}: the default dimension is unchanged`);
    assert.deepEqual(await linkLines(runner, kind, s.tenantId), [
      'Alpha | default | Licences',
      'Alpha | nature | Licences',
      'Bravo | nature | Licences',
      'Charlie | nature | Hardware',
    ]);
    const [{ n }] = await runner.query(
      `SELECT count(DISTINCT category_id)::int AS n FROM ${LINK_TABLE[kind]} WHERE tenant_id = $1 AND axis_id = $2`,
      [s.tenantId, s.nature],
    );
    assert.equal(n, 2, `${kind}: Alpha and Bravo share the one new value`);
  });
}

async function testDisabledValueInDryRun(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = csvService(kind);
    const opts = { manager: runner.manager };
    const headers = withNature(svc.csvHeaders());
    await svc.importCsv({ file: csvFile(headers, [row(kind, 'Holder', { 'analytics:nature': 'Hardware' })]), dryRun: false, userId: null }, opts);
    const [holder] = await runner.query(`SELECT id FROM ${ITEM_TABLE[kind]} WHERE tenant_id = $1`, [s.tenantId]);
    // The holder's current value becomes Retired (disabled): it stays valid on that line only.
    await runner.query(`UPDATE ${LINK_TABLE[kind]} SET category_id = $2 WHERE item_id = $1 AND axis_id = $3`, [holder.id, s.retired, s.nature]);
    const file = csvFile(headers, [
      row(kind, 'Holder', { 'analytics:nature': 'retired' }),
      row(kind, 'Newcomer', { 'analytics:nature': 'Retired' }),
    ]);
    const dry = await svc.importCsv({ file, dryRun: true, userId: null }, opts);
    assert.deepEqual(errorsOf(dry), ['3: Retired is disabled. Pick an enabled value.'], `${kind}: a disabled value is refused as new, in the dry run`);
    const wet = await svc.importCsv({ file, dryRun: false, userId: null }, opts);
    assert.deepEqual(errorsOf(wet), ['3: Retired is disabled. Pick an enabled value.']);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${ITEM_TABLE[kind]} WHERE tenant_id = $1`, [s.tenantId]);
    assert.equal(n, 1, `${kind}: nothing written`);
    const accepted = await svc.importCsv({ file: csvFile(headers, [row(kind, 'Holder', { 'analytics:nature': 'Retired' })]), dryRun: false, userId: null }, opts);
    assert.deepEqual(accepted.errors, [], `${kind}: the line's current disabled value is accepted`);
    assert.deepEqual(await linkLines(runner, kind, s.tenantId), ['Holder | nature | Retired']);
  });
}

async function testNameRules(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const s = await setup(runner, kind);
    const svc = csvService(kind);
    const opts = { manager: runner.manager };
    const file = csvFile(withNature(svc.csvHeaders()), [
      row(kind, 'Too long', { analytics_category: 'L'.repeat(250) }),
      row(kind, 'Invisible', { 'analytics:nature': 'Zero\u200bwidth' }),
      row(kind, 'Fine', { analytics_category: 'Licences', 'analytics:nature': 'Brand new' }),
    ]);
    for (const dryRun of [true, false]) {
      const result = await svc.importCsv({ file, dryRun, userId: null }, opts);
      assert.equal(result.ok, false, `${kind} (dry run ${dryRun}): refused`);
      assert.deepEqual(errorsOf(result), [
        '2: Name must be 200 characters or fewer.',
        '3: Name cannot contain control or invisible characters.',
      ], `${kind} (dry run ${dryRun}): the value name rules, as row errors`);
    }
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM ${ITEM_TABLE[kind]} WHERE tenant_id = $1`, [s.tenantId]);
    assert.equal(n, 0, `${kind}: no line written`);
    assert.deepEqual(await valuesOf(runner, s.main), ['Licences', 'Other'], `${kind}: no value created`);
    assert.deepEqual(await valuesOf(runner, s.nature), ['Hardware', 'Other', 'Retired']);
  });
}

void runSpecs('csv-analytics.integration.spec', KINDS.flatMap((kind): Array<[string, () => Promise<void>]> => [
  [`legacy header is the default dimension (${kind})`, () => testLegacyHeader(kind)],
  [`two-dimension round trip (${kind})`, () => testTwoDimensionRoundTrip(kind)],
  [`file refusals (${kind})`, () => testFileRefusals(kind)],
  [`absent and blank columns (${kind})`, () => testAbsentAndBlankColumns(kind)],
  [`values per dimension (${kind})`, () => testValuesPerDimension(kind)],
  [`disabled value in the dry run (${kind})`, () => testDisabledValueInDryRun(kind)],
  [`value name rules in the dry run (${kind})`, () => testNameRules(kind)],
])).catch((err) => {
  console.error(err);
  process.exit(1);
});
