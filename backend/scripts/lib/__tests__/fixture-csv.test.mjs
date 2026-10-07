// Unit tests of the fixture CSV reader and its year shift (node --test).
//
//   node --test backend/scripts/lib/__tests__/fixture-csv.test.mjs
//
// Runs on the real Fromage & Co files: a shift of zero sends them byte for
// byte, and a shift of one year moves every date, every `year` value and the
// year columns of 01-companies.csv, and nothing else.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATASET_YEAR, parseCsv, shiftCsvText, shiftIsoDate } from '../fixture-csv.mjs';

const FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures/fromage-co');
const CSV_FILES = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith('.csv')).sort();
const read = (name) => readFileSync(path.join(FIXTURE_DIR, name), 'utf8');
const rowsOf = (name, years) => parseCsv(shiftCsvText(read(name), years));

const FULL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_IN_TEXT = /\d{4}-\d{2}-\d{2}/;

test('the dataset is the one the loader expects', () => {
  assert.equal(DATASET_YEAR, 2026);
  assert.equal(CSV_FILES.length, 29, `fixture files found in ${FIXTURE_DIR}`);
});

test('a shift of zero gives every fixture file byte for byte', () => {
  for (const name of CSV_FILES) {
    const bytes = readFileSync(path.join(FIXTURE_DIR, name));
    const loaded = Buffer.from(shiftCsvText(bytes.toString('utf8'), 0), 'utf8');
    assert.ok(loaded.equals(bytes), `${name} is sent unchanged`);
  }
});

test('shiftIsoDate moves the year and keeps the day', () => {
  assert.equal(shiftIsoDate('2026-03-31', 1), '2027-03-31');
  assert.equal(shiftIsoDate('2026-12-31', -1), '2025-12-31');
  assert.equal(shiftIsoDate('2028-02-29', 1), '2029-02-28', 'a 29 February in a common year becomes the 28th');
  assert.equal(shiftIsoDate('2027-02-28', 1), '2028-02-28');
  assert.equal(shiftIsoDate('2026-02-30', 1), null, 'not a date');
  assert.equal(shiftIsoDate('26-01-01', 1), null);
});

test('shiftCsvText keeps quotes, line ends and other cells', () => {
  const text = 'name;year;start;note\r\n"A ""quoted""; name";2026;2026-01-31;"ends 2026-06-30, code 2026"\r\nB;;;x\r\n';
  assert.equal(
    shiftCsvText(text, 2),
    'name;year;start;note\r\n"A ""quoted""; name";2028;2028-01-31;"ends 2028-06-30, code 2026"\r\nB;;;x\r\n',
  );
  assert.equal(shiftCsvText('a;headcount_2026;code_0042\n1;2;3\n', 1), 'a;headcount_2027;code_0042\n1;2;3\n');
  assert.throws(() => shiftCsvText(text, 0.5), /integer/);
});

/** Every cell of every file, compared one by one with a shift of one year. */
test('a shift of one year moves the dates, the year values and the company metric columns, nothing else', () => {
  const datedFiles = [];
  for (const name of CSV_FILES) {
    const before = parseCsv(read(name));
    const after = rowsOf(name, 1);
    assert.equal(after.length, before.length, `${name}: same rows`);
    let moved = 0;
    before.forEach((row, index) => {
      const shiftedRow = after[index];
      for (const [column, value] of Object.entries(row)) {
        const yearColumn = /^(.*_)(\d{4})$/.exec(column);
        const target = yearColumn ? `${yearColumn[1]}${Number(yearColumn[2]) + 1}` : column;
        assert.ok(target in shiftedRow, `${name}: column ${target}`);
        if (yearColumn) moved += 1;
        const got = shiftedRow[target];
        if (FULL_DATE.test(value)) {
          assert.equal(got, shiftIsoDate(value, 1), `${name} line ${index + 2} ${column}`);
          moved += 1;
        } else if (column === 'year' && /^\d{4}$/.test(value)) {
          assert.equal(got, String(Number(value) + 1), `${name} line ${index + 2} year`);
          moved += 1;
        } else if (DATE_IN_TEXT.test(value)) {
          assert.equal(got, value.replace(/\d{4}-\d{2}-\d{2}/g, (date) => shiftIsoDate(date, 1) ?? date), `${name} line ${index + 2} ${column}`);
          moved += 1;
        } else {
          assert.equal(got, value, `${name} line ${index + 2} ${column} unchanged`);
        }
      }
    });
    if (moved > 0) datedFiles.push(name);
  }
  assert.deepEqual(datedFiles, [
    '01-companies.csv', '12-applications.csv', '13-contracts.csv', '14-spend-items.csv', '15-capex-items.csv',
    '16-portfolio-projects.csv', '17-portfolio-requests.csv', '18-assets.csv', '19-tasks.csv',
    '28-working-day-calendars.csv', '29-budget-rows.csv', '30-costed-lines.csv',
  ], 'the files that carry dates');
});

/** A sample per dated file, written out, so the expected values can be read. */
test('a shift of one year, file by file', () => {
  const find = (name, predicate) => {
    const row = rowsOf(name, 1).find(predicate);
    assert.ok(row, `${name}: sample row`);
    return row;
  };
  const companies = find('01-companies.csv', (row) => row.name === 'Fromage & Co SA');
  assert.equal(companies.headcount_2026, '1150', 'the 2025 metrics are now the 2026 ones');
  assert.equal(companies.headcount_2028, '1250');
  assert.ok(!('headcount_2025' in companies));

  const microsoft365 = find('12-applications.csv', (row) => row.name === 'Microsoft 365');
  assert.equal(microsoft365.go_live_date, '2020-01-15');

  const ea = find('13-contracts.csv', (row) => row.name === 'Microsoft Enterprise Agreement');
  assert.equal(ea.start_date, '2025-01-01');

  const notes = find('14-spend-items.csv', (row) => row.product_name.startsWith('Lotus Notes'));
  assert.equal(notes.disabled_at, '2027-12-31');
  assert.equal(notes.notes, 'Fin de validité 2027-12-31', 'a date inside a text moves too');

  const sap = find('15-capex-items.csv', (row) => row.description.startsWith('SAP Cheddar Migration'));
  assert.deepEqual([sap.effective_start, sap.disabled_at], ['2026-07-01', '2028-12-31']);

  const crm = find('16-portfolio-projects.csv', (row) => row.name === 'Legacy CRM Decommission');
  assert.deepEqual([crm.planned_start, crm.planned_end, crm.actual_start, crm.actual_end], ['2025-01-15', '2026-03-31', '2025-02-01', '2026-04-15']);

  const grading = find('17-portfolio-requests.csv', (row) => row.name === 'AI Cheese Grading');
  assert.equal(grading.target_delivery_date, '2028-03-31');

  const esx = find('18-assets.csv', (row) => row.name === 'PAR-ESX-01');
  assert.equal(esx.go_live_date, '2024-06-01');

  const rfp = find('19-tasks.csv', (row) => row.title === 'Define SAP Cheddar scope and RFP');
  assert.deepEqual([rfp.start_date, rfp.due_date], ['2027-03-01', '2027-06-30']);

  const calendars = rowsOf('28-working-day-calendars.csv', 1).filter((row) => row.year);
  assert.ok(calendars.length > 0 && calendars.every((row) => Number(row.year) >= 2026), 'calendar years moved');

  const actual = find('29-budget-rows.csv', (row) => row.item_name.startsWith('Microsoft Enterprise') && row.measure === 'actual');
  assert.deepEqual([actual.year, actual.period_start, actual.period_end], ['2027', '2027-01-01', '2027-08-31']);

  const staffing = find('30-costed-lines.csv', (row) => row.label === 'Chef de projet EDI');
  assert.deepEqual([staffing.year, staffing.period_start, staffing.period_end], ['2027', '2027-01-01', '2027-12-31']);
});
