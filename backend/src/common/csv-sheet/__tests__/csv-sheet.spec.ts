import * as assert from 'node:assert/strict';
import { Decimal } from '../../decimal';
import { parseEndOfValidityInput } from '../../status';
import {
  BUDGET_AMOUNT_COLUMNS,
  CsvLanguage,
  CsvParsedAmount,
  CsvReadResult,
  CsvReadSchema,
  amountConventionNotice,
  csvLanguage,
  csvProfile,
  dateOrderNotice,
  formatCsvAmount,
  formatCsvDate,
  matchCode,
  parseCsvAmount,
  parseCsvDateCell,
  readCsv,
  resolveAmountConvention,
  resolveDateOrder,
  writeCsv,
  writeCsvHeader,
  writeCsvRows,
} from '../index';

// The shared reader and writer. Importers are not involved: this file never
// opens a database and never calls a service that writes one.

const FIELDS = ['item_number', 'name', 'end_of_validity', 'notes'] as const;

function schema(language: CsvLanguage, dateOrder?: CsvReadSchema['dateOrder']): CsvReadSchema {
  return {
    fields: FIELDS,
    amounts: BUDGET_AMOUNT_COLUMNS,
    dimensions: ['cost_nature'],
    dateFields: ['end_of_validity'],
    language,
    dateOrder,
  };
}

function valueOf(parsed: CsvParsedAmount): Decimal {
  assert.equal(parsed.kind, 'value');
  if (parsed.kind !== 'value') throw new Error('unreachable');
  return parsed.decimal;
}

function column(result: CsvReadResult, id: string) {
  const found = result.columns.find((item) => item.id === id);
  assert.ok(found, `missing column ${id}`);
  return found!;
}

function testLanguageProfiles() {
  assert.equal(csvLanguage(null), 'en');
  assert.equal(csvLanguage(''), 'en');
  assert.equal(csvLanguage('it'), 'en');
  assert.equal(csvLanguage('fr'), 'fr');
  assert.deepEqual(
    [csvProfile('en').separator, csvProfile('en').decimal, csvProfile('en').dateOrder],
    [',', '.', 'month-first'],
  );
  for (const language of ['fr', 'es', 'de'] as const) {
    assert.equal(csvProfile(language).separator, ';');
    assert.equal(csvProfile(language).decimal, ',');
    assert.equal(csvProfile(language).dateOrder, 'day-first');
  }
  assert.equal(dateOrderNotice('day-first'), 'Dates read day first: 01/03/2027 is March 1.');
  assert.equal(dateOrderNotice('month-first'), 'Dates read month first: 01/03/2027 is January 3.');
}

function testAmounts() {
  assertAmount('12280.50', '12280.50');
  assertAmount('12280,50', '12280.50');
  assertAmount('12 280,50', '12280.50');
  assertAmount('12  280.50', '12280.50');
  assertAmount('12\u00a0280,50', '12280.50');
  assertAmount('12\u202f280,50', '12280.50');
  assertAmount('12.280,50', '12280.50');
  assertAmount('12,280.50', '12280.50');
  assertAmount('12, 280.50', '12280.50');
  assertAmount('1.234.567,89', '1234567.89');
  // One or two digits after the mark settle it as the decimal mark.
  assertAmount('12,5', '12.5');
  assertAmount('0', '0');
  assertAmount('0,00', '0');
  assertAmount('-12280,50', '-12280.50');
  assertAmount('+12280.50', '12280.50');
  assert.equal(parseCsvAmount('').kind, 'blank');
  assert.equal(parseCsvAmount('   ').kind, 'blank');
  assert.equal(parseCsvAmount('-').kind, 'clear');
  assert.equal(parseCsvAmount(' - ').kind, 'clear');
  for (const bad of ['1,22,80.50', '12.280.50', '12,280,50', '12,,280', '€12280', '1.5e2', "12'280.50", '12_280', '(12280)', '−12280']) {
    assert.equal(parseCsvAmount(bad).kind, 'invalid', bad);
  }
  assert.equal(formatCsvAmount('12280.50', 'en'), '12280.50');
  assert.equal(formatCsvAmount('12280.50', 'fr'), '12280,50');
  assert.equal(formatCsvAmount('12280.50', 'es'), '12280,50');
  assert.equal(formatCsvAmount('12280.50', 'de'), '12280,50');
  assert.equal(formatCsvAmount(Decimal.from('12280.50'), 'en'), '12280.5');
  assert.equal(formatCsvAmount('-12280.50', 'fr'), '-12280,50');
  // Three digits after one mark is not a value until the convention is known.
  assert.equal(parseCsvAmount('12,280').kind, 'invalid');
  assertAmount('12,280', '12.280', ',');
  assertAmount('12,280', '12280', '.');
  assertAmount('12.280', '12.280', '.');
  assertAmount('12.280', '12280', ',');
  assertAmount('-12,280', '-12280', '.');
}

function assertAmount(text: string, expected: string, convention?: ',' | '.') {
  const parsed = parseCsvAmount(text, convention);
  assert.equal(parsed.kind, 'value', text);
  if (parsed.kind === 'value') assert.equal(parsed.decimal.cmp(expected), 0, `${text} -> ${parsed.decimal.toString()}`);
}

function testDates() {
  const march = parseCsvDateCell('2027-03-01', null);
  assert.equal(march.ok && march.value.kind === 'date' && march.value.isoDate, '2027-03-01');

  const french = parseCsvDateCell('01/03/2027', 'day-first');
  assert.equal(french.ok && french.value.kind === 'date' && french.value.isoDate, '2027-03-01');
  const english = parseCsvDateCell('01/03/2027', 'month-first');
  assert.equal(english.ok && english.value.kind === 'date' && english.value.isoDate, '2027-01-03');

  assert.equal(parseCsvDateCell('31/12/2027', 'day-first').ok, true);
  assert.equal(parseCsvDateCell('31/12/2027', 'month-first').ok, false);
  assert.equal(parseCsvDateCell('03.01.2027', 'day-first').ok && (parseCsvDateCell('03.01.2027', 'day-first') as { value: { isoDate: string } }).value.isoDate, '2027-01-03');
  const dashed = parseCsvDateCell('01-03-2027', 'day-first');
  assert.equal(dashed.ok && dashed.value.kind === 'date' && dashed.value.isoDate, '2027-03-01');
  const short = parseCsvDateCell('1/3/2027', 'day-first');
  assert.equal(short.ok && short.value.kind === 'date' && short.value.isoDate, '2027-03-01');

  const withTime = parseCsvDateCell('01/03/2027 00:00', 'day-first');
  assert.ok(withTime.ok && withTime.value.kind === 'date');
  if (withTime.ok && withTime.value.kind === 'date') {
    assert.equal(withTime.value.isoDate, '2027-03-01');
    assert.equal(withTime.value.time, '00:00:00');
  }
  const clock = parseCsvDateCell('2027-03-01 15:04:05', null);
  assert.ok(clock.ok && clock.value.kind === 'date' && clock.value.time === '15:04:05');

  const instant = parseCsvDateCell('2027-03-01T15:04:05.000Z', null);
  assert.ok(instant.ok && instant.value.kind === 'instant' && instant.value.iso === '2027-03-01T15:04:05.000Z');
  const offset = parseCsvDateCell('2027-03-01T15:04:05+02:00', null);
  assert.ok(offset.ok && offset.value.kind === 'instant' && offset.value.iso === '2027-03-01T13:04:05.000Z');

  for (const bad of ['31/04/2027', '29/02/2027', '2027-02-30', '2027-02-30T00:00:00.000Z', '01/03/27', '0000-01-01', '2027-03-01T24:00:00Z', 'not a date']) {
    const parsed = parseCsvDateCell(bad, 'day-first');
    assert.equal(parsed.ok, false, bad);
    if (!parsed.ok) assert.equal(parsed.blank, false, bad);
  }
  assert.equal(parseCsvDateCell('29/02/2028', 'day-first').ok, true);
  assert.equal(parseCsvDateCell('   ', 'day-first').blank, true);
  const cleared = parseCsvDateCell('-', 'day-first');
  assert.equal(cleared.ok, false);
  if (!cleared.ok) assert.equal('clear' in cleared && cleared.clear, true);

  assert.equal(formatCsvDate('2027-03-01', 'en'), '2027-03-01');
  assert.equal(formatCsvDate('2027-03-01', 'fr'), '01/03/2027');
  assert.equal(formatCsvDate('2027-03-01', 'es'), '01/03/2027');
  assert.equal(formatCsvDate('2027-03-01', 'de'), '01.03.2027');
  assert.equal(formatCsvDate('2027-03-01T15:04:05.000Z', 'fr'), '2027-03-01T15:04:05.000Z');
  assert.equal(formatCsvDate('2027-03-01T15:04:05+02:00', 'de'), '2027-03-01T13:04:05.000Z');
}

function testCodes() {
  assert.deepEqual(matchCode('007', ['7']), { kind: 'stripped', code: '7' });
  assert.deepEqual(matchCode('007', ['007']), { kind: 'exact', code: '007' });
  assert.deepEqual(matchCode('12', ['012', '12']), { kind: 'exact', code: '12' });
  assert.deepEqual(matchCode('0012', ['012', '12']), { kind: 'ambiguous' });
  assert.deepEqual(matchCode('AB', ['00AB']), { kind: 'none' });
  assert.deepEqual(matchCode('007', ['007A']), { kind: 'none' });
  assert.deepEqual(matchCode('0', ['000']), { kind: 'stripped', code: '000' });
  assert.deepEqual(matchCode('', ['1']), { kind: 'blank' });
  assert.deepEqual(matchCode('12', ['99']), { kind: 'none' });
}

function testApiParserIsUntouched() {
  // C0's strict helper is not on this branch. The API parser still misreads a
  // local date, and this module does not change that function.
  assert.throws(() => parseEndOfValidityInput('31/12/2027'));
  const parsed = parseEndOfValidityInput('01/03/2027');
  assert.ok(parsed);
  assert.notEqual(parsed!.toISOString().slice(0, 10), '2027-03-01');
}

async function testHeaders() {
  const text = [
    'Item Number;Name;end-of-validity;Budget 2027;planned_2027;budget_27;budjet_2028;actual_2026_13;analytics:Cost Nature;analytics:nope;My column',
    '1;Ada;2027-03-01;10;1;1;1;1;Run;x;extra',
  ].join('\n');
  const result = await readCsv(text, schema('fr'));
  assert.deepEqual(result.headerErrors.slice(0, 4), [
    "Column 'planned_2027' repeats 'Budget 2027'.",
    "Column 'budget_27' is not a valid amount column. A year has four digits, for example budget_2027.",
    "Column 'budjet_2028' is not a valid amount column.",
    "Column 'actual_2026_13' is not a valid amount column. A month is 01 to 12.",
  ]);
  assert.ok(result.headerErrors.includes("Unknown dimension 'nope'."));
  assert.equal(column(result, 'item_number').header, 'Item Number');
  assert.equal(column(result, 'end_of_validity').header, 'end-of-validity');
  const budget = column(result, 'budget_2027');
  assert.equal(budget.kind, 'amount');
  if (budget.kind === 'amount') {
    assert.equal(budget.measure, 'planned');
    assert.equal(budget.column, 'budget');
    assert.equal(budget.year, 2027);
    assert.equal(budget.month, null);
  }
  assert.equal(column(result, 'analytics:cost_nature').kind, 'analytics');
  assert.deepEqual(result.ignoredColumns, ['My column']);
  assert.equal(result.rows[0].cells.item_number, '1');
  assert.equal(result.rows[0].cells['budget_2027'] && valueOf(result.rows[0].amounts.budget_2027).cmp('10'), 0);

  const follow = await readCsv('follow_up_2027_03\n1.50\n', schema('fr'));
  const month = column(follow, 'actual_2027_03');
  assert.equal(month.kind, 'amount');
  if (month.kind === 'amount') assert.equal(month.month, 3);

  const both = await readCsv('budget_2027;budget_2027_01\n1;2\n', schema('fr'));
  assert.deepEqual(both.headerErrors, ['A yearly total and months are both present for budget 2027.']);

  const master = await readCsv('name;budget_2027;analytics:foo\nAda;10;x\n', {
    fields: ['name'],
    language: 'en',
  });
  assert.deepEqual(master.headerErrors, []);
  assert.deepEqual(master.ignoredColumns, ['budget_2027', 'analytics:foo']);
  assert.equal(master.rows[0].cells.name, 'Ada');
}

function amountFile(language: CsvLanguage, cells: readonly string[]) {
  // A semicolon keeps a comma inside an amount from being read as the separator.
  const body = cells.map((cell) => `${cell};x`).join('\n');
  return readCsv(`budget_2027;notes\n${body}\n`, schema(language));
}

async function testAmountConvention() {
  const dotNotice = amountConventionNotice('.');
  const commaNotice = amountConventionNotice(',');
  assert.equal(dotNotice, 'Amounts read with a decimal dot: 12,280 is twelve thousand two hundred eighty.');
  assert.equal(commaNotice, 'Amounts read with a decimal comma: 12.280 is twelve thousand two hundred eighty.');

  const englishComma = await amountFile('en', ['12,280']);
  assert.equal(valueOf(englishComma.rows[0].amounts.budget_2027).cmp('12280'), 0);
  assert.equal(englishComma.amounts?.settledByFile, false);
  assert.equal(englishComma.amounts?.notice, dotNotice);
  const englishDot = await amountFile('en', ['12.280']);
  assert.equal(valueOf(englishDot.rows[0].amounts.budget_2027).cmp('12.280'), 0);
  assert.equal(englishDot.amounts?.notice, dotNotice);

  for (const language of ['fr', 'de', 'es'] as const) {
    const withComma = await amountFile(language, ['12,280']);
    assert.equal(valueOf(withComma.rows[0].amounts.budget_2027).cmp('12.280'), 0, language);
    assert.equal(withComma.amounts?.notice, commaNotice, language);
    assert.equal(withComma.amounts?.settledByFile, false);
    const withDot = await amountFile(language, ['12.280']);
    assert.equal(valueOf(withDot.rows[0].amounts.budget_2027).cmp('12280'), 0, language);
    assert.equal(withDot.amounts?.notice, commaNotice, language);
  }

  // Another cell shows the comma is the decimal mark, so 12.280 is thousands. The language does not override that.
  const settled = await amountFile('en', ['12,50', '12.280']);
  assert.deepEqual(settled.fileErrors, []);
  assert.deepEqual(settled.amounts, { decimal: ',', settledByFile: true, notice: null });
  assert.equal(valueOf(settled.rows[0].amounts.budget_2027).cmp('12.50'), 0);
  assert.equal(valueOf(settled.rows[1].amounts.budget_2027).cmp('12280'), 0);

  const settledDot = await amountFile('fr', ['12.50', '12,280']);
  assert.deepEqual(settledDot.amounts, { decimal: '.', settledByFile: true, notice: null });
  assert.equal(valueOf(settledDot.rows[1].amounts.budget_2027).cmp('12280'), 0);

  const clash = await amountFile('de', ['12,5', '1,234.56']);
  assert.deepEqual(clash.fileErrors, ['This file uses both amount conventions (12,5 and 1,234.56).']);
  assert.equal(clash.amounts, null);
  assert.equal(clash.rows[0].errors.length, 0);

  // A mark followed by one digit is not the ambiguous form, and it does not ask.
  const plain = await amountFile('en', ['12,5']);
  assert.equal(plain.amounts, null);
  assert.deepEqual(plain.fileErrors, []);
  assert.equal(valueOf(plain.rows[0].amounts.budget_2027).cmp('12.5'), 0);
}

async function testDateOrderInAFile() {
  const settled = await readCsv('end_of_validity\n31/12/2027\n01/03/2027\n', schema('en'));
  assert.deepEqual(settled.fileErrors, []);
  assert.deepEqual(settled.dates, { order: 'day-first', settledByFile: true, notice: null });
  assert.equal(settled.rows[0].dates.end_of_validity.kind === 'date' && settled.rows[0].dates.end_of_validity.isoDate, '2027-12-31');
  assert.equal(settled.rows[1].dates.end_of_validity.kind === 'date' && settled.rows[1].dates.end_of_validity.isoDate, '2027-03-01');
  assert.equal(settled.rows[0].errors.length, 0);

  const english = await readCsv('end_of_validity\n01/03/2027\n', schema('en'));
  assert.equal(english.dates?.notice, dateOrderNotice('month-first'));
  assert.equal(english.dates?.settledByFile, false);
  assert.equal(english.rows[0].dates.end_of_validity.kind === 'date' && english.rows[0].dates.end_of_validity.isoDate, '2027-01-03');

  const switched = await readCsv('end_of_validity\n01/03/2027\n', schema('en', 'day-first'));
  assert.equal(switched.dates?.notice, dateOrderNotice('day-first'));
  assert.equal(switched.rows[0].dates.end_of_validity.kind === 'date' && switched.rows[0].dates.end_of_validity.isoDate, '2027-03-01');

  const blocked = await readCsv('end_of_validity\n15/01/2027\n', schema('en', 'month-first'));
  assert.deepEqual(blocked.fileErrors, ['This file shows dates day first (15/01/2027). The date order cannot be switched.']);
  assert.equal(blocked.dates, null);
  assert.equal(blocked.rows[0].dates.end_of_validity, undefined);
  assert.equal(blocked.rows[0].errors.length, 0);

  const both = await readCsv('end_of_validity\n13/01/2027\n01/13/2027\n', schema('fr'));
  assert.deepEqual(both.fileErrors, ['This file uses both date orders (13/01/2027 and 01/13/2027).']);

  const german = await readCsv('end_of_validity\n03.01.2027\n', schema('de'));
  assert.equal(german.dates?.order, 'day-first');
  assert.equal(german.rows[0].dates.end_of_validity.kind === 'date' && german.rows[0].dates.end_of_validity.isoDate, '2027-01-03');

  const bad = await readCsv('end_of_validity\n31/04/2027\n', schema('fr'));
  assert.deepEqual(bad.rows[0].errors, [{ column: 'end_of_validity', message: "Invalid date '31/04/2027'." }]);

  const iso = await readCsv('end_of_validity\n2027-03-01\n2027-03-01T15:04:05.000Z\n', schema('fr'));
  assert.equal(iso.dates, null);
  assert.equal(iso.rows[0].dates.end_of_validity.kind === 'date' && iso.rows[0].dates.end_of_validity.isoDate, '2027-03-01');
  assert.equal(iso.rows[1].dates.end_of_validity.kind === 'instant' && iso.rows[1].dates.end_of_validity.iso, '2027-03-01T15:04:05.000Z');
}

/** The hint field belongs to the caller, so csv-sheet does not parse a budget token. */
function hintSchema(language: CsvLanguage, dateOrder?: CsvReadSchema['dateOrder']): CsvReadSchema {
  return {
    ...schema(language, dateOrder),
    fields: [...FIELDS, 'export_language'],
    conventionHint: {
      field: 'export_language',
      languageOf: (cell) => ['en', 'fr', 'de', 'es'].includes(cell) ? cell as CsvLanguage : null,
    },
  };
}

async function testDateConventionHint() {
  const text = 'end_of_validity;export_language\n01/03/2027;fr\n05/11/2027;fr\n';
  const hinted = await readCsv(text, hintSchema('en'));
  assert.deepEqual(hinted.fileErrors, []);
  assert.deepEqual(hinted.dates, { order: 'day-first', settledByFile: false, notice: dateOrderNotice('day-first') });
  assert.deepEqual(hinted.rows.map((row) => row.dates.end_of_validity), [
    { kind: 'date', isoDate: '2027-03-01', time: null },
    { kind: 'date', isoDate: '2027-11-05', time: null },
  ]);
  assert.equal(resolveDateOrder(['01/03/2027', '05/11/2027'], 'en', undefined, 'fr').source, 'export');

  for (const hint of ['fr', 'en'] as const) {
    const evidence = await readCsv(`${text}13/01/2027;${hint}\n`.split(';fr').join(`;${hint}`), hintSchema('en'));
    assert.deepEqual(evidence.fileErrors, []);
    assert.ok(evidence.rows.every((row) => row.errors.length === 0));
    assert.deepEqual(evidence.dates, { order: 'day-first', settledByFile: true, notice: null });
    assert.deepEqual(evidence.rows[2].dates.end_of_validity, { kind: 'date', isoDate: '2027-01-13', time: null });
    assert.equal(resolveDateOrder(['01/03/2027', '13/01/2027'], 'en', undefined, hint).source, 'file');
  }

  const switched = await readCsv(text, hintSchema('en', 'month-first'));
  assert.deepEqual(switched.fileErrors, []);
  assert.equal(switched.dates?.order, 'month-first');
  assert.deepEqual(switched.rows[0].dates.end_of_validity, { kind: 'date', isoDate: '2027-01-03', time: null });
  assert.equal(resolveDateOrder(['01/03/2027'], 'en', 'month-first', 'fr').source, 'switch');
  assert.ok(resolveDateOrder(['13/01/2027'], 'en', 'month-first', 'fr').error);
  assert.equal(resolveDateOrder(['2027-03-01'], 'en', undefined, 'fr').source, null);
  assert.equal(resolveDateOrder(['01/03/2027'], 'en').source, 'language');
}

async function testAmountConventionHint() {
  for (const [language, hint, cell, decimal] of [
    ['en', 'de', '12.280', ','],
    ['fr', 'en', '12,280', '.'],
  ] as const) {
    const hinted = await readCsv(`budget_2027;export_language\n${cell};${hint}\n`, hintSchema(language));
    assert.deepEqual(hinted.fileErrors, []);
    assert.equal(valueOf(hinted.rows[0].amounts.budget_2027).cmp('12280'), 0);
    assert.deepEqual(hinted.amounts, { decimal, settledByFile: false, notice: amountConventionNotice(decimal) });
    assert.equal(resolveAmountConvention([cell], language, undefined, hint).source, 'export');
  }

  for (const hint of ['en', 'fr', 'de', 'es'] as const) {
    const evidence = await readCsv(`budget_2027;export_language\n12.280;${hint}\n12,50;${hint}\n`, hintSchema('en'));
    assert.deepEqual(evidence.fileErrors, []);
    assert.deepEqual(evidence.amounts, { decimal: ',', settledByFile: true, notice: null });
    assert.equal(valueOf(evidence.rows[0].amounts.budget_2027).cmp('12280'), 0);
    assert.equal(valueOf(evidence.rows[1].amounts.budget_2027).cmp('12.50'), 0);
    assert.equal(resolveAmountConvention(['12.280', '12,50'], 'en', undefined, hint).source, 'file');
  }
  assert.equal(resolveAmountConvention(['100'], 'en', undefined, 'de').source, null);
  assert.equal(resolveAmountConvention(['12.280'], 'en').source, 'language');
}

async function testAmountConventionSwitch() {
  const text = 'budget_2027;export_language\n12,280;de\n';
  const switched = await readCsv(text, { ...hintSchema('de'), decimalMark: '.' });
  assert.deepEqual(switched.fileErrors, []);
  assert.equal(valueOf(switched.rows[0].amounts.budget_2027).cmp('12280'), 0);
  assert.deepEqual(switched.amounts, { decimal: '.', settledByFile: false, notice: amountConventionNotice('.') });
  assert.equal(resolveAmountConvention(['12,280'], 'de', '.', 'de').source, 'switch');

  const unchangedHint = await readCsv(text, hintSchema('de'));
  assert.equal(valueOf(unchangedHint.rows[0].amounts.budget_2027).cmp('12.280'), 0);
  assert.equal(resolveAmountConvention(['12,280'], 'de', undefined, 'de').source, 'export');

  for (const [evidence, override, which] of [
    ['1,234.56', ',', 'dot'],
    ['12,5', '.', 'comma'],
  ] as const) {
    const blocked = await readCsv(`budget_2027;export_language\n12,280;de\n${evidence};de\n`, {
      ...hintSchema('de'), decimalMark: override,
    });
    assert.deepEqual(blocked.fileErrors, [
      `This file shows amounts with a decimal ${which} (${evidence}). The decimal mark cannot be switched.`,
    ]);
    assert.equal(blocked.amounts, null);
    assert.ok(blocked.rows.every((row) => row.errors.length === 0));
  }
  const agreeing = resolveAmountConvention(['12,5', '12,280'], 'en', ',', 'en');
  assert.equal(agreeing.source, 'file');
  assert.equal(agreeing.error, null);
}

async function testMixedAndMissingHints() {
  for (const language of ['en', 'fr'] as const) {
    const mixed = await readCsv('end_of_validity;budget_2027;export_language\n01/03/2027;12.280;fr\n01/03/2027;12.280;en\n', hintSchema(language));
    assert.deepEqual(mixed.fileErrors, []);
    assert.equal(mixed.dates?.order, csvProfile(language).dateOrder);
    assert.equal(mixed.dates?.notice, dateOrderNotice(csvProfile(language).dateOrder));
    assert.equal(mixed.amounts?.decimal, csvProfile(language).decimal);
    assert.equal(valueOf(mixed.rows[0].amounts.budget_2027).cmp(language === 'en' ? '12.280' : '12280'), 0);
  }

  for (const text of [
    'end_of_validity;export_language\n01/03/2027;\n01/03/2027;unknown\n',
    'end_of_validity\n01/03/2027\n',
  ]) {
    const missing = await readCsv(text, hintSchema('en'));
    assert.deepEqual(missing.fileErrors, []);
    assert.equal(missing.dates?.order, 'month-first');
  }
  const oneHint = await readCsv('end_of_validity;export_language\n01/03/2027;\n01/03/2027;fr\n01/03/2027;unknown\n', hintSchema('en'));
  assert.equal(oneHint.dates?.order, 'day-first', 'null hints do not cancel the one distinct language');
}

async function testReadingShape() {
  const text = 'name;note\r\n\r\n"hello\r\nthere";x\r\nplain;y\r\n';
  const result = await readCsv(text, { fields: ['name', 'note'], language: 'fr' });
  assert.equal(result.separator, ';');
  assert.equal(result.headerLine, 1);
  assert.equal(result.rows[0].line, 3);
  assert.equal(result.rows[0].cells.name, 'hello\nthere');
  assert.equal(result.rows[1].line, 5);
  assert.equal(result.rows[1].cells.name, 'plain');

  const trailing = await readCsv('name;note\nAda;hi;\n', { fields: ['name', 'note'], language: 'fr' });
  assert.equal(trailing.rows[0].errors.length, 0);
  const extra = await readCsv('name;note\nAda;hi;more\n', { fields: ['name', 'note'], language: 'fr' });
  assert.deepEqual(extra.rows[0].errors, [{ column: null, message: 'This row has more cells than the header.' }]);

  const quoted = await readCsv('"name;still",notes\n"a;b",c\n', { fields: ['name;still', 'notes'], language: 'en' });
  assert.equal(quoted.separator, ',');
  assert.equal(quoted.rows[0].cells['name;still'], 'a;b');

  const tie = await readCsv('a,b;c\n1,2\n', { fields: ['a'], language: 'en' });
  assert.deepEqual(tie.fileErrors, ['The separator could not be read from the header.']);
  assert.equal(tie.rows.length, 0);

  const empty = await readCsv('   \n', { fields: ['name'], language: 'en' });
  assert.deepEqual(empty.fileErrors, ['The file is empty.']);
  const headerOnly = await readCsv('name;notes\n', { fields: ['name', 'notes'], language: 'fr' });
  assert.deepEqual(headerOnly.fileErrors, []);
  assert.equal(headerOnly.rows.length, 0);
  assert.equal(headerOnly.columns.length, 2);

  const tab = await readCsv('name\tnotes\nAda\thi\n', { fields: ['name', 'notes'], language: 'en' });
  assert.equal(tab.separator, '\t');
  assert.equal(tab.rows[0].cells.notes, 'hi');

  const quote = await readCsv('name\n"unterminated\n', { fields: ['name'], language: 'en' });
  assert.deepEqual(quote.fileErrors, ['This file could not be read as CSV. A quoted cell is not closed.']);

  const blankHeader = await readCsv('name;;notes\nA;B;C\n', { fields: ['name', 'notes'], language: 'en' });
  assert.ok(blankHeader.headerErrors.includes('A column header is empty.'));

  const leadingBlank = await readCsv('\nname\nAda\n', { fields: ['name'], language: 'en' });
  assert.equal(leadingBlank.headerLine, 2);
  assert.equal(leadingBlank.rows[0].line, 3);

  const spaced = await readCsv(' \u00a0 \nname;notes\nAda;hi\n', { fields: ['name', 'notes'], language: 'fr' });
  assert.deepEqual(spaced.fileErrors, []);
  assert.equal(spaced.rows[0].cells.name, 'Ada');
  assert.equal(spaced.rows[0].cells.notes, 'hi');

  const trailingHeader = await readCsv('name;notes;\nAda;hi;\n', { fields: ['name', 'notes'], language: 'fr' });
  assert.deepEqual(trailingHeader.headerErrors, []);
  assert.deepEqual(trailingHeader.rawHeaders, ['name', 'notes']);
  assert.equal(trailingHeader.rows[0].errors.length, 0);
  assert.equal(trailingHeader.rows[0].cells.notes, 'hi');

  const oldYear = await readCsv('budget_1899\n1\n', schema('en'));
  assert.deepEqual(oldYear.headerErrors, ["Column 'budget_1899' is not a valid amount column. A year is 1900 to 2199."]);

  const swapped = await readCsv('bugdet_2027\n10\n', schema('en'));
  assert.deepEqual(swapped.headerErrors, ["Column 'bugdet_2027' is not a valid amount column."]);
  assert.deepEqual(swapped.ignoredColumns, []);

  const clearedDate = await readCsv('end_of_validity\n-\n', schema('fr'));
  assert.deepEqual(clearedDate.rows[0].errors, []);
  assert.equal(clearedDate.rows[0].dates.end_of_validity.kind, 'clear');
  assert.equal(clearedDate.rows[0].cells.end_of_validity, '-');
}

async function testEncodingAndDamage() {
  const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('name,notes\nCafé,ok\n', 'utf8')]);
  const utf8Read = await readCsv(utf8, { fields: ['name', 'notes'], language: 'en' });
  assert.equal(utf8Read.encoding, 'utf-8');
  assert.equal(utf8Read.rows[0].cells.name, 'Café');

  const win = Buffer.concat([
    Buffer.from('name;end_of_validity;budget_2027;Commentaire\nCaf', 'ascii'),
    Buffer.from([0xe9]),
    Buffer.from(';01/03/2027;12.280,50;note\n', 'ascii'),
  ]);
  const winRead = await readCsv(win, schema('fr'));
  assert.equal(winRead.encoding, 'windows-1252');
  assert.equal(winRead.rows[0].cells.name, 'Café');
  assert.equal(winRead.rows[0].dates.end_of_validity.kind === 'date' && winRead.rows[0].dates.end_of_validity.isoDate, '2027-03-01');
  assert.equal(valueOf(winRead.rows[0].amounts.budget_2027).cmp('12280.50'), 0);
  assert.deepEqual(winRead.ignoredColumns, ['Commentaire']);
  assert.equal(winRead.rows[0].cells.item_number, undefined);

  const utf16 = Buffer.from([0xff, 0xfe, 0x41, 0x00]);
  const refused = await readCsv(utf16, schema('en'));
  assert.deepEqual(refused.fileErrors, ['This file is not UTF-8 or Windows-1252.']);

  // LibreOffice in French: semicolon, nbsp thousands, decimal comma, day-first date, extra column.
  const nbsp = '\u00a0';
  const french = `item_number;name;end_of_validity;budget_2027;Commentaire\n007;Café;31/12/2027;12${nbsp}280,50;note\n`;
  const frenchRead = await readCsv(french, schema('en'));
  assert.equal(frenchRead.dates?.settledByFile, true);
  assert.equal(frenchRead.rows[0].cells.item_number, '007');
  assert.equal(frenchRead.rows[0].dates.end_of_validity.kind === 'date' && frenchRead.rows[0].dates.end_of_validity.isoDate, '2027-12-31');
  assert.equal(valueOf(frenchRead.rows[0].amounts.budget_2027).cmp('12280.50'), 0);

  // LibreOffice in English keeps an ISO date. A damaged English save uses a month-first date and a comma thousands separator.
  const english = await readCsv('item_number,name,end_of_validity,budget_2027,Comment\n7,Cafe,2027-03-01,12280.50,note\n', schema('en'));
  assert.equal(english.dates, null);
  assert.equal(english.rows[0].dates.end_of_validity.kind === 'date' && english.rows[0].dates.end_of_validity.isoDate, '2027-03-01');
  const damaged = await readCsv('end_of_validity,budget_2027\n3/1/2027,"12,280.50"\n', schema('en'));
  assert.equal(damaged.dates?.notice, dateOrderNotice('month-first'));
  assert.equal(damaged.rows[0].dates.end_of_validity.kind === 'date' && damaged.rows[0].dates.end_of_validity.isoDate, '2027-03-01');
  assert.equal(valueOf(damaged.rows[0].amounts.budget_2027).cmp('12280.50'), 0);
}

async function testRoundTrip() {
  const headers = ['item_number', 'name', 'end_of_validity', 'notes', 'budget_2027'];
  for (const language of ['en', 'fr', 'de', 'es'] as const) {
    const row = ['007', 'Café, "nord"', formatCsvDate('2027-03-01', language), '=SUM(A1)', formatCsvAmount('12280.50', language)];
    const csv = writeCsv({ language, headers, rows: [row] });
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.ok(csv.includes("'-") === false);
    assert.ok(csv.includes("'=SUM(A1)"));
    if (language === 'en') assert.ok(csv.includes('2027-03-01') && csv.includes('12280.50') && csv.includes(','));
    if (language === 'fr' || language === 'es') assert.ok(csv.includes('01/03/2027') && csv.includes('12280,50') && csv.includes(';'));
    if (language === 'de') assert.ok(csv.includes('01.03.2027') && csv.includes('12280,50'));
    const negative = formatCsvAmount('-12280.50', language);
    assert.equal(negative.startsWith('-'), true);
    assert.ok(!writeCsv({ language, headers: ['budget_2027'], rows: [[negative]] }).includes("'-"));

    const read = await readCsv(csv, schema(language));
    assert.deepEqual(read.fileErrors, []);
    assert.deepEqual(read.headerErrors, []);
    assert.equal(read.rows[0].cells.item_number, '007');
    assert.equal(read.rows[0].cells.name, 'Café, "nord"');
    assert.equal(read.rows[0].cells.notes, '=SUM(A1)');
    assert.equal(valueOf(read.rows[0].amounts.budget_2027).cmp('12280.50'), 0);
    const date = read.rows[0].dates.end_of_validity;
    assert.equal(date.kind === 'date' && date.isoDate, '2027-03-01');
    if (language === 'en') assert.equal(read.dates, null);
    else {
      assert.equal(read.dates?.order, 'day-first');
      assert.equal(read.dates?.notice, dateOrderNotice('day-first'));
      assert.equal(read.fileErrors.length, 0);
    }
  }

  const template = writeCsv({ language: 'en', headers: ['name'], rows: [] });
  const readTemplate = await readCsv(template, { fields: ['name'], language: 'en' });
  assert.equal(readTemplate.rows.length, 0);
  assert.equal(readTemplate.columns[0].id, 'name');
  assert.deepEqual(readTemplate.fileErrors, []);
}

function testHeaderWithoutBom() {
  const headers = ['name', 'notes'];
  // By default the header line starts with a BOM, like writeCsv.
  assert.equal(writeCsvHeader('en', headers), '\uFEFFname,notes\n');
  assert.equal(writeCsvHeader('fr', headers, {}), '\uFEFFname;notes\n');
  assert.equal(writeCsvHeader('en', headers, { bom: true }), '\uFEFFname,notes\n');
  // `bom: false` writes the same line without it; quoting and the formula guard are unchanged.
  assert.equal(writeCsvHeader('en', headers, { bom: false }), 'name,notes\n');
  assert.equal(writeCsvHeader('en', ['=name', 'a,b'], { bom: false }), `'=name,"a,b"\n`);
  const rows = writeCsvRows({ language: 'en', headers, rows: [['Café', '=SUM(A1)']] });
  assert.equal(writeCsvHeader('en', headers, { bom: false }) + rows, "name,notes\nCafé,'=SUM(A1)\n");
  assert.equal(writeCsvHeader('en', headers) + rows, writeCsv({ language: 'en', headers, rows: [['Café', '=SUM(A1)']] }));
}

async function testRowCap() {
  const ok = ['name', ...Array.from({ length: 20_000 }, (_, index) => `n${index}`)].join('\n');
  const accepted = await readCsv(ok, { fields: ['name'], language: 'en' });
  assert.equal(accepted.rows.length, 20_000);
  assert.deepEqual(accepted.fileErrors, []);

  const over = ['name', ...Array.from({ length: 20_001 }, (_, index) => `n${index}`)].join('\n');
  const refused = await readCsv(over, { fields: ['name'], language: 'en' });
  assert.equal(refused.rows.length, 0);
  assert.deepEqual(refused.fileErrors, ['This file has more than 20,000 rows.']);
}

async function main() {
  testLanguageProfiles();
  testAmounts();
  testDates();
  testCodes();
  testApiParserIsUntouched();
  await testHeaders();
  await testAmountConvention();
  await testDateOrderInAFile();
  await testDateConventionHint();
  await testAmountConventionHint();
  await testAmountConventionSwitch();
  await testMixedAndMissingHints();
  await testReadingShape();
  await testEncodingAndDamage();
  await testRoundTrip();
  testHeaderWithoutBom();
  await testRowCap();
  console.log('csv-sheet.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
