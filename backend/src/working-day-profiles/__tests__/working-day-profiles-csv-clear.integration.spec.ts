import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { WorkingDayProfilesController } from '../working-day-profiles.controller';
import { WORKING_DAY_PROFILE_CSV_HEADERS } from '../working-day-profiles-csv.service';
import { context, FR218, runSpecs, seedTenant, services, withRollback } from './working-day-profile-test-helpers';

// The calendars import under the clearing rule of every import route (D21 and T-I4g of 26.11.9):
// on a stored calendar a blank cell keeps the value (the description, the status: a blank status no
// longer enables a disabled calendar), `-` clears the description and the end of validity (the
// calendar is active again), and `-` on a value that cannot be cleared refuses the row with the
// codes of the other imports. The check counts the stored values the rows clear (`cleared`). The
// route calls the service with the rule.

const HEADER = WORKING_DAY_PROFILE_CSV_HEADERS.join(';');
const noDays = Array.from({ length: 12 }, () => '');

function file(lines: string[]): Express.Multer.File {
  return { buffer: Buffer.from(`${HEADER}\n${lines.join('\n')}\n`, 'utf8'), originalname: 'working_day_calendars.csv' } as Express.Multer.File;
}

type Cells = { name?: string; description?: string; status?: string; disabledAt?: string; year?: string; days?: string[] };
const row = (code: string, cells: Cells = {}) =>
  [code, cells.name ?? '', cells.description ?? '', '', '', cells.status ?? '', cells.disabledAt ?? '', cells.year ?? '', ...(cells.days ?? noDays)].join(';');

async function seed(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const { csv } = services(runner.manager);
  const ctx = context(runner.manager, tenantId);
  // A stored calendar with a description, disabled since 2025.
  const created = await csv.importCsv({
    file: file([row('OFF', { name: 'Office', description: 'Office staff', status: 'disabled', disabledAt: '2025-01-15', year: '2026', days: FR218 })]),
    dryRun: false,
  }, ctx);
  assert.equal(created.ok, true, JSON.stringify(created.errors));
  return { tenantId, csv, ctx };
}

async function stored(runner: QueryRunner, tenantId: string) {
  const [calendar] = await runner.query(
    `SELECT name, description, status, disabled_at, days_by_year FROM working_day_profiles WHERE tenant_id = $1 AND code = 'OFF'`,
    [tenantId],
  );
  return calendar;
}

async function testBlankKeeps() {
  await withRollback(async (runner) => {
    const { tenantId, csv, ctx } = await seed(runner, 'keep');
    // Name, description, status and end of validity blank: nothing changes, the calendar stays disabled.
    const check = await csv.importCsv({ file: file([row('OFF')]), dryRun: true, mode: 'enrich' }, ctx);
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual([check.inserted, check.updated, check.unchanged, check.cleared], [0, 0, 1, 0]);
    const done = await csv.importCsv({ file: file([row('OFF', { year: '2027', days: FR218 })]), dryRun: false, mode: 'enrich' }, ctx);
    assert.equal(done.ok, true, JSON.stringify(done.errors));
    assert.deepEqual([done.inserted, done.cleared], [1, 0]);
    const calendar = await stored(runner, tenantId);
    assert.deepEqual([calendar.name, calendar.description, calendar.status], ['Office', 'Office staff', 'disabled']);
    assert.ok(calendar.disabled_at, 'the end of validity stays');
    assert.deepEqual(Object.keys(calendar.days_by_year), ['2026', '2027']);
    // A new calendar still needs its name.
    const unnamed = await csv.importCsv({ file: file([row('NEW')]), dryRun: true, mode: 'enrich' }, ctx);
    assert.equal(unnamed.ok, false);
    assert.deepEqual(unnamed.errors.map((error) => [error.row, error.column, error.code]), [[2, 'name', 'CSV_VALUE_REQUIRED']]);
  });
}

async function testDashClears() {
  await withRollback(async (runner) => {
    const { tenantId, csv, ctx } = await seed(runner, 'clear');
    const lines = [row('OFF', { description: '-', disabledAt: '-' })];
    const check = await csv.importCsv({ file: file(lines), dryRun: true, mode: 'enrich' }, ctx);
    assert.equal(check.ok, true, JSON.stringify(check.errors));
    assert.deepEqual([check.updated, check.cleared], [1, 2], 'the description and the end of validity');
    const done = await csv.importCsv({ file: file(lines), dryRun: false, mode: 'enrich' }, ctx);
    assert.deepEqual([done.updated, done.cleared], [1, 2]);
    const calendar = await stored(runner, tenantId);
    assert.deepEqual([calendar.description, calendar.status, calendar.disabled_at], [null, 'enabled', null]);
    // Cleared already: `-` changes nothing and counts nothing.
    const again = await csv.importCsv({ file: file(lines), dryRun: true, mode: 'enrich' }, ctx);
    assert.deepEqual([again.updated, again.unchanged, again.cleared], [0, 1, 0]);
    // On a new calendar `-` is a blank cell.
    const fresh = await csv.importCsv({ file: file([row('NEW', { name: 'New', description: '-', disabledAt: '-' })]), dryRun: false, mode: 'enrich' }, ctx);
    assert.deepEqual([fresh.ok, fresh.inserted, fresh.cleared], [true, 1, 0]);
  });
}

async function testDashRefused() {
  await withRollback(async (runner) => {
    const { csv, ctx } = await seed(runner, 'refused');
    const refused = await csv.importCsv({
      file: file([
        row('OFF', { name: '-' }),
        row('OFF', { status: '-' }),
        row('OFF', { year: '-' }),
        row('OFF', { year: '2026', days: ['-', ...FR218.slice(1)] }),
        row('OFF', { status: 'disabled', disabledAt: '-' }),
      ]),
      dryRun: true,
      mode: 'enrich',
    }, ctx);
    assert.equal(refused.ok, false);
    assert.deepEqual(refused.errors.map((error) => [error.row, error.column, error.code]), [
      [2, 'name', 'CSV_VALUE_CANNOT_BE_CLEARED'],
      [3, 'status', 'CSV_VALUE_CANNOT_BE_CLEARED'],
      [4, 'year', 'CSV_VALUE_CANNOT_BE_CLEARED'],
      [5, 'jan', 'CSV_NUMBER_CANNOT_BE_CLEARED'],
      [6, 'status', 'CSV_STATUS_DISABLED_DATE_CLEARED'],
    ]);
  });
}

async function testWithoutModeReplaces() {
  await withRollback(async (runner) => {
    const { tenantId, csv, ctx } = await seed(runner, 'replace');
    // Called without a mode, as before: a blank status enables, a blank description clears.
    const done = await csv.importCsv({ file: file([row('OFF', { name: 'Office' })]), dryRun: false }, ctx);
    assert.equal(done.ok, true, JSON.stringify(done.errors));
    const calendar = await stored(runner, tenantId);
    assert.deepEqual([calendar.description, calendar.status], [null, 'enabled']);
  });
}

// A file needs only the code (lot I4 of 26.11.9): an absent column is never written, in both
// modes; the year and the twelve months come together, when one of them is in the file.
async function testOnlyTheCodeIsRequired() {
  await withRollback(async (runner) => {
    const { tenantId, csv, ctx } = await seed(runner, 'columns');
    const csvOf = (header: string, lines: string[]) =>
      ({ buffer: Buffer.from(`${header}\n${lines.join('\n')}\n`, 'utf8'), originalname: 'c.csv' }) as Express.Multer.File;
    for (const mode of ['enrich', undefined] as const) {
      const check = await csv.importCsv({ file: csvOf('code;description', ['OFF;Office staff']), dryRun: true, mode }, ctx);
      assert.equal(check.ok, true, `${mode}: ${JSON.stringify(check.errors)}`);
      assert.deepEqual([check.inserted, check.updated, check.unchanged], [0, 0, 1], `${mode}: nothing changes`);
    }
    const done = await csv.importCsv({ file: csvOf('code;description', ['OFF;Back office']), dryRun: false }, ctx);
    assert.equal(done.ok, true, JSON.stringify(done.errors));
    const calendar = await stored(runner, tenantId);
    assert.deepEqual([calendar.name, calendar.description, calendar.status], ['Office', 'Back office', 'disabled'], 'absent name and status are kept');
    assert.deepEqual(Object.keys(calendar.days_by_year), ['2026']);
    // A new calendar from a file without the months: no year, as with a blank year.
    const created = await csv.importCsv({ file: csvOf('code;name', ['NEW;New calendar']), dryRun: true, mode: 'enrich' }, ctx);
    assert.deepEqual([created.ok, created.inserted], [true, 1], JSON.stringify(created.errors));
    // A month without the year and the other months is a header refusal.
    const partial = await csv.importCsv({ file: csvOf('code;jan', ['OFF;20']), dryRun: true, mode: 'enrich' }, ctx);
    assert.equal(partial.ok, false);
    assert.equal(partial.errors[0]?.row, 0);
    assert.match(partial.errors[0]?.message ?? '', /year/);
    // The code stays required.
    const keyless = await csv.importCsv({ file: csvOf('name;description', ['Office;x']), dryRun: true, mode: 'enrich' }, ctx);
    assert.equal(keyless.ok, false);
    assert.match(keyless.errors[0]?.message ?? '', /code/);
  });
}

async function testRouteAppliesTheRule() {
  const calls: any[] = [];
  const controller = Object.create(WorkingDayProfilesController.prototype) as any;
  controller.csv = { importCsv: async (args: any) => { calls.push(args); return { ok: true }; } };
  const manager = { query: async () => [] };
  await controller.import(file([row('OFF')]), 'true', 'en', undefined, undefined, { manager, tenantId: 't', user: { sub: null } });
  assert.equal(calls[0]?.mode, 'enrich');
}

runSpecs('working-day-profiles-csv-clear.integration.spec', [
  testBlankKeeps,
  testDashClears,
  testDashRefused,
  testWithoutModeReplaces,
  testRouteAppliesTheRule,
  testOnlyTheCodeIsRequired,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
