import * as assert from 'node:assert/strict';
import { recordHistoryEntry } from '../record-history.inventory';
import type { FamilyKey } from '../record-history/families';
import {
  presentItem,
  type AuditRow,
  type PageContext,
} from '../record-history/presenters';

// The history presenter of a budget line (issue 1150): a version is named by its year, and the
// dimensions of a creation carry no before. No database: the page context is given.

const LINE = 'aaaaaaaa-1111-4111-8111-111111111111';
const VERSION = 'bbbbbbbb-2222-4222-8222-222222222222';
const AXIS = 'cccccccc-3333-4333-8333-333333333333';
const CLOUD = 'dddddddd-4444-4444-8444-444444444444';
const ON_PREMISE = 'eeeeeeee-5555-4555-8555-555555555555';

function row(overrides: Partial<AuditRow>): AuditRow {
  return {
    id: 'audit-1',
    table_name: 'spend_versions',
    record_id: VERSION,
    action: 'create',
    before_json: null,
    after_json: null,
    user_id: null,
    source: 'system',
    created_at: '2026-10-15T12:34:00.000Z',
    created_at_text: '2026-10-15T12:34:00.000Z',
    ...overrides,
  };
}

function context(versions: PageContext['versions'] = new Map()): PageContext {
  return {
    entry: recordHistoryEntry('spend_items')!,
    recordId: LINE,
    users: new Map(),
    versions,
    references: new Map(),
    deleted: new Map(),
    readable: {} as Record<FamilyKey, boolean>,
    dimensions: new Map([[AXIS, 'Cost pool']]),
    categories: new Map([[CLOUD, 'Cloud'], [ON_PREMISE, 'On premise']]),
    entityLabels: new Map(),
  };
}

function testVersionYear() {
  const loaded = new Map([[VERSION, { name: 'Y2027', year: 2027 }]]);
  const created = presentItem(row({
    after_json: { version_name: 'Y2027', budget_year: 2027 },
  }), recordHistoryEntry('spend_items')!, context(loaded));
  assert.equal(created.subject.kind, 'version');
  assert.equal(created.subject.label, '2027', 'the stored name Y2027 is not the label');
  assert.deepEqual(created.changes, [], 'a creation stays a title');

  const updated = presentItem(row({
    action: 'update',
    before_json: { version_name: 'Custom name', input_grain: 'monthly' },
    after_json: { version_name: 'Custom name', input_grain: 'annual' },
  }), recordHistoryEntry('spend_items')!, context(loaded));
  assert.equal(updated.subject.label, '2027', 'an update uses the year loaded with the version');

  const deleted = presentItem(row({
    action: 'delete',
    before_json: { version_name: 'Y2027', budget_year: '2027' },
    after_json: null,
  }), recordHistoryEntry('spend_items')!, context());
  assert.equal(deleted.subject.label, '2027', 'a deleted version keeps the year from its payload');

  const unnamed = presentItem(row({
    after_json: { version_name: 'Y2027' },
  }), recordHistoryEntry('spend_items')!, context());
  assert.equal(unnamed.subject.label, undefined, 'without a year the stored name is not shown');
  console.log('  a version is named by its year: OK');
}

function testDimensionCreation() {
  const entry = recordHistoryEntry('spend_items')!;
  const created = presentItem(row({
    table_name: 'spend_items',
    record_id: LINE,
    action: 'create',
    after_json: { analytics_values: { [AXIS]: CLOUD }, product_name: 'Main line' },
  }), entry, context());
  const dimension = created.changes.find((change) => change.field === 'dimension');
  assert.ok(dimension, 'the creation names the dimension');
  assert.equal(Object.prototype.hasOwnProperty.call(dimension, 'before'), false, 'a creation has no before');
  assert.equal(dimension.dimension, 'Cost pool');
  assert.equal(dimension.after, 'Cloud');

  const updated = presentItem(row({
    table_name: 'spend_items',
    record_id: LINE,
    action: 'update',
    before_json: { analytics_values: { [AXIS]: CLOUD } },
    after_json: { analytics_values: { [AXIS]: ON_PREMISE } },
  }), entry, context());
  const changed = updated.changes.find((change) => change.field === 'dimension');
  assert.ok(changed, 'an update names the dimension');
  assert.equal(changed.before, 'Cloud');
  assert.equal(changed.after, 'On premise');
  console.log('  a creation names a dimension without a before: OK');
}

// H1 (26.12.1): a budget input names what changed in its costed lines, read from the JSON of the
// audit row at display time, so the entries written before the change read the same way.

const FRANCE = 'f1f1f1f1-1111-4111-8111-111111111111';
const GERMANY = 'f2f2f2f2-2222-4222-8222-222222222222';
const ROUND = 'a0a0a0a0-0000-4000-8000-000000000000';

/** A stored costed line as `readLines` returns it and the audit row carries it. */
function calcLine(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '00000000-0000-4000-8000-00000000000' + String(Math.floor(Math.random() * 10)),
    sort: 1,
    label: 'Consultant',
    quantity_unit: 'people',
    quantity: '1',
    unit_price: '400',
    price_basis: 'per_day',
    frequency: 'per_month',
    days_per_month: null,
    period_start: '2026-02-01',
    period_end: '2026-10-30',
    working_day_profile_id: FRANCE,
    working_day_profile_code: 'FR',
    working_day_profile_name: 'France',
    ...overrides,
  };
}

/** A line's calculation as `linesCalculation` stores it: the calendar's twelve days of the year. */
function calculatedLine(days: string[] | null, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { id: _id, sort: _sort, working_day_profile_code: _code, working_day_profile_name: _name, ...line } = calcLine();
  return {
    ...line,
    working_day_profile_code: 'FR',
    working_day_profile_name: 'France',
    active_months: [2, 3, 4, 5, 6, 7, 8, 9, 10],
    day_counts: days,
    total_days: null,
    month_amounts: [],
    fte_months: [],
    fte: '0.75',
    fte_period: '1',
    total: '60000.00',
    ...overrides,
  };
}

/** The stored round input row as `saveRoundInput` audits it (`RETURNING` of its columns). */
function storedRound(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: ROUND,
    tenant_id: 'eeeeeeee-0000-4000-8000-000000000000',
    version_id: VERSION,
    measure: 'planned',
    period_start: '2026-02-01',
    period_end: '2026-10-31',
    method: 'computed',
    spread_profile_name: null,
    last_calculation: { kind: 'computed', total: '60000.00', lines: [] },
    fte: '0.75',
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-01T10:00:00.000Z',
    updated_by: null,
    ...overrides,
  };
}

/** The audit row of a lines write, in the shape the writer uses today: `{ ...stored, lines }` on both sides. */
function linesRow(beforeLines: unknown[], afterLines: unknown[], overrides: Partial<AuditRow> = {}): AuditRow {
  return row({
    table_name: 'spend_round_inputs',
    record_id: ROUND,
    action: 'update',
    before_json: { ...storedRound(), lines: beforeLines },
    after_json: { ...storedRound({ updated_at: '2026-10-02T10:00:00.000Z' }), lines: afterLines },
    ...overrides,
  });
}

function calcChanges(item: ReturnType<typeof presentItem>) {
  return item.changes.filter((change) => change.field.startsWith('line_') || change.field === 'calendar_days');
}

function testCalcLineProperties() {
  const entry = recordHistoryEntry('spend_items')!;
  const calendar = presentItem(linesRow(
    [calcLine()],
    [calcLine({ working_day_profile_id: GERMANY, working_day_profile_code: 'DE', working_day_profile_name: 'Germany' })],
  ), entry, context());
  assert.equal(calendar.subject.kind, 'round_input');
  assert.deepEqual(calcChanges(calendar), [
    { field: 'line_calendar', line: 'Consultant', lineNumber: 1, before: 'France', after: 'Germany' },
  ], 'a calendar change names the line and both calendars');

  const none = presentItem(linesRow(
    [calcLine({ quantity_unit: 'pieces', price_basis: 'per_piece', working_day_profile_id: null, working_day_profile_code: null, working_day_profile_name: null })],
    [calcLine()],
  ), entry, context());
  const noneCalendar = calcChanges(none).find((change) => change.field === 'line_calendar');
  assert.ok(noneCalendar, 'a calendar set on a line without one is a change');
  assert.equal(noneCalendar.before, null, 'no calendar before is null, which the screen says in words');

  const every = presentItem(linesRow(
    [calcLine()],
    [calcLine({
      quantity: '2', unit_price: '450.5', price_basis: 'per_month', days_per_month: '5',
      period_start: '2026-03-01', period_end: '2026-12-31',
    })],
  ), entry, context());
  assert.deepEqual(calcChanges(every), [
    { field: 'line_quantity', line: 'Consultant', lineNumber: 1, before: '1', after: '2' },
    { field: 'line_unit_price', line: 'Consultant', lineNumber: 1, before: '400', after: '450.5' },
    { field: 'line_price_basis', line: 'Consultant', lineNumber: 1, before: 'per_day', after: 'per_month' },
    { field: 'line_days_per_month', line: 'Consultant', lineNumber: 1, before: null, after: '5' },
    {
      field: 'line_period', line: 'Consultant', lineNumber: 1,
      before: { start: '2026-02-01', end: '2026-10-30' }, after: { start: '2026-03-01', end: '2026-12-31' },
    },
  ], 'one change per property, in a fixed order');

  const units = presentItem(linesRow(
    [calcLine({ quantity_unit: 'pieces', price_basis: 'per_piece', frequency: 'per_month', working_day_profile_id: null })],
    [calcLine({ quantity_unit: 'pieces', price_basis: 'per_piece', frequency: 'once', working_day_profile_id: null })],
  ), entry, context());
  assert.deepEqual(calcChanges(units).map((change) => [change.field, change.before, change.after]), [
    ['line_frequency', 'per_month', 'once'],
  ]);
  const unit = presentItem(linesRow(
    [calcLine({ quantity_unit: 'days' })],
    [calcLine({ quantity_unit: 'people' })],
  ), entry, context());
  assert.deepEqual(calcChanges(unit).map((change) => [change.field, change.before, change.after]), [['line_unit', 'days', 'people']]);

  const equalDecimals = presentItem(linesRow([calcLine({ quantity: '1.000' })], [calcLine({ quantity: '1' })]), entry, context());
  assert.deepEqual(calcChanges(equalDecimals), [], 'the same decimal written two ways is no change');
  console.log('  a costed line change names each property that moved: OK');
}

function testCalcLinePairing() {
  const entry = recordHistoryEntry('spend_items')!;
  // By description: the lines swapped places, the one whose price moved is named by its new place.
  const swapped = presentItem(linesRow(
    [calcLine({ label: 'Architect' }), calcLine({ label: 'Developer', sort: 2 })],
    [calcLine({ label: 'Developer', unit_price: '500' }), calcLine({ label: 'Architect', sort: 2 })],
  ), entry, context());
  assert.deepEqual(calcChanges(swapped), [
    { field: 'line_unit_price', line: 'Developer', lineNumber: 1, before: '400', after: '500' },
  ], 'paired by description, never by place, when the description is unique');
  assert.ok(swapped.changes.some((change) => change.field === 'lines' && change.changed), 'the new order still reads as today');

  // By rank: two lines share a description, two have none.
  const twins = presentItem(linesRow(
    [calcLine({ label: 'Developer' }), calcLine({ label: 'Developer', sort: 2 })],
    [calcLine({ label: 'Developer' }), calcLine({ label: 'Developer', sort: 2, quantity: '3' })],
  ), entry, context());
  assert.deepEqual(calcChanges(twins), [
    { field: 'line_quantity', line: 'Developer', lineNumber: 2, before: '1', after: '3' },
  ], 'a shared description pairs the lines by their rank');
  const blank = presentItem(linesRow(
    [calcLine({ label: '' }), calcLine({ label: '', sort: 2 })],
    [calcLine({ label: '', working_day_profile_id: GERMANY, working_day_profile_name: 'Germany' }), calcLine({ label: '', sort: 2 })],
  ), entry, context());
  assert.deepEqual(calcChanges(blank), [
    { field: 'line_calendar', lineNumber: 1, before: 'France', after: 'Germany' },
  ], 'a line without a description is named by its place');

  // Added and removed lines read as today, with no property change.
  const added = presentItem(linesRow([calcLine({ label: 'A' })], [calcLine({ label: 'A' }), calcLine({ label: 'B', sort: 2 })]), entry, context());
  assert.deepEqual(added.changes, [{ field: 'line', event: 'added', after: 'B' }]);
  const removed = presentItem(linesRow([calcLine({ label: 'A' }), calcLine({ label: 'B', sort: 2 })], [calcLine({ label: 'A' })]), entry, context());
  assert.deepEqual(removed.changes, [{ field: 'line', event: 'removed', before: 'B' }]);
  console.log('  lines paired by unique description, else by rank; added and removed lines unchanged: OK');
}

function testCalendarDaysRecomputed() {
  const entry = recordHistoryEntry('spend_items')!;
  const before = ['18', '18', '20', '20', '15', '20', '15', '16', '20', '19', '18', '19'];
  const after = ['18', '18', '20', '20', '15', '20', '15', '16', '20', '19', '18', '18'];
  const pieces = calculatedLine(null, { label: 'Licences', quantity_unit: 'pieces', price_basis: 'per_piece', working_day_profile_id: null });
  // "Use the lines again" after a calendar edit: the lines are the same, so the row carries none;
  // the calculation carries the calendar's days of the year.
  const recomputed = presentItem(row({
    table_name: 'spend_round_inputs',
    record_id: ROUND,
    action: 'update',
    before_json: storedRound({ last_calculation: { kind: 'computed', total: '60000.00', lines: [calculatedLine(before), pieces] } }),
    after_json: storedRound({ last_calculation: { kind: 'computed', total: '59600.00', lines: [calculatedLine(after), pieces] } }),
  }), entry, context());
  assert.deepEqual(recomputed.changes, [
    { field: 'calendar_days', calendar: 'France', year: 2026, before: '218', after: '217' },
  ], 'the calendar\'s working days of the year, before and after');

  // A spread keeps the result of the lines: the same days read no change.
  const spread = presentItem(row({
    table_name: 'spend_round_inputs',
    record_id: ROUND,
    action: 'update',
    before_json: storedRound({ last_calculation: { kind: 'computed', total: '60000.00', lines: [calculatedLine(before)] } }),
    after_json: storedRound({
      method: 'spread', spread_profile_name: 'flat',
      last_calculation: { kind: 'annual', total: '60000.00', profile: 'flat', active_months: [], weights: [], lines_result: { lines: [calculatedLine(before)] } },
    }),
  }), entry, context());
  assert.deepEqual(spread.changes.map((change) => change.field), ['method', 'spread_profile_name'], 'a column made a spread reads as today');
  console.log('  lines used again after a calendar edit: the days of the year per calendar: OK');
}

function testColumnCopyCalendarIssues() {
  const entry = recordHistoryEntry('spend_items')!;
  const copied = presentItem(row({
    table_name: 'spend_items',
    record_id: LINE,
    action: 'update',
    before_json: { planned: 1000 },
    after_json: {
      planned: 1200, operation: 'budget_column_copy', sourceYear: 2026, sourceColumn: 'planned', destinationYear: 2027,
      destinationColumn: 'planned', percentageIncrease: '0', from_lines: true,
      calendar_issues: [
        { line: 'Consultant', lineNumber: 1, calendar: 'France', kind: 'fallback', fallback: 'France standard' },
        { line: 'Line 2', lineNumber: 2, calendar: 'Old', kind: 'disabled' },
      ],
    },
  }), entry, context());
  assert.deepEqual(copied.changes, [
    { field: 'planned', before: 1000, after: 1200, year: 2027, sourceYear: 2026, sourceColumn: 'planned', percentageIncrease: '0' },
    { field: 'line_calendar_replaced', line: 'Consultant', lineNumber: 1, year: 2027, before: 'France', after: 'France standard' },
    { field: 'line_calendar_disabled', lineNumber: 2, after: 'Old' },
  ], 'the copy says which calendar replaced which, the server\'s "Line 2" read as a place');
  const reference = presentItem(row({
    table_name: 'capex_items',
    record_id: LINE,
    action: 'update',
    before_json: { planned: 0 },
    after_json: {
      planned: 500, operation: 'budget_column_copy', sourceYear: 2026, sourceColumn: 'planned', destinationYear: 2027,
      destinationColumn: 'planned', percentageIncrease: '0',
      calendar_issues: [{ line: 'Consultant', lineNumber: 1, calendar: 'France', kind: 'missing' }],
    },
  }), entry, context());
  assert.deepEqual(reference.changes.slice(1), [
    { field: 'line_calendar_missing', line: 'Consultant', lineNumber: 1, year: 2027, before: 'France' },
  ], 'a CAPEX line copied the old way says which calendar had no days');
  console.log('  a column copy names the calendars it replaced: OK');
}

function testRestoreAndCapex() {
  const entry = recordHistoryEntry('spend_items')!;
  const restored = presentItem(linesRow([calcLine({ quantity: '2' })], [calcLine()], { action: 'restored' }), entry, context());
  assert.equal(restored.action, 'restored');
  assert.deepEqual(calcChanges(restored), [
    { field: 'line_quantity', line: 'Consultant', lineNumber: 1, before: '2', after: '1' },
  ], 'a restored column reads its lines the same way');
  const capex = presentItem(linesRow(
    [calcLine()],
    [calcLine({ working_day_profile_id: GERMANY, working_day_profile_name: 'Germany' })],
    { table_name: 'capex_round_inputs' },
  ), entry, context());
  assert.equal(capex.subject.kind, 'round_input');
  assert.deepEqual(calcChanges(capex).map((change) => [change.field, change.before, change.after]), [['line_calendar', 'France', 'Germany']]);
  console.log('  a restore and a CAPEX line read the same: OK');
}

function testEntryWrittenBeforeTheFix() {
  // The JSON of an audit row as `saveRoundInput` writes it on main before this change, verbatim.
  const entry = recordHistoryEntry('spend_items')!;
  const stored = {
    id: ROUND, tenant_id: 'eeeeeeee-0000-4000-8000-000000000000', version_id: VERSION, measure: 'planned',
    period_start: '2026-02-01', period_end: '2026-10-31', method: 'computed', spread_profile_name: null,
    last_calculation: { kind: 'computed', total: '60000.00', fte: '0.75', fte_period: '1', month_amounts: [], fte_months: [], active_months: [2, 3, 4, 5, 6, 7, 8, 9, 10], lines: [] },
    fte: '0.75', created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-01T10:00:00.000Z', updated_by: null,
  };
  const line = {
    id: '11111111-0000-4000-8000-000000000001', sort: 1, label: 'Consultant', quantity_unit: 'people', quantity: '1', unit_price: '400',
    price_basis: 'per_day', frequency: 'per_month', days_per_month: null, period_start: '2026-02-01', period_end: '2026-10-30',
    working_day_profile_id: FRANCE, working_day_profile_code: 'FR', working_day_profile_name: 'France',
  };
  const old = presentItem(row({
    table_name: 'spend_round_inputs', record_id: ROUND, action: 'update',
    before_json: { ...stored, lines: [line] },
    after_json: {
      ...stored, updated_at: '2026-10-02T10:00:00.000Z',
      lines: [{ ...line, id: '11111111-0000-4000-8000-000000000002', working_day_profile_id: GERMANY, working_day_profile_code: 'DE', working_day_profile_name: 'Germany' }],
    },
  }), entry, context());
  assert.deepEqual(old.changes, [
    { field: 'line_calendar', line: 'Consultant', lineNumber: 1, before: 'France', after: 'Germany' },
  ], 'an entry written before the change shows its cause');
  console.log('  an entry written before the change shows its cause: OK');
}

function run() {
  console.log('record history presenters');
  testVersionYear();
  testDimensionCreation();
  testCalcLineProperties();
  testCalcLinePairing();
  testCalendarDaysRecomputed();
  testColumnCopyCalendarIssues();
  testRestoreAndCapex();
  testEntryWrittenBeforeTheFix();
  console.log('record-history-presenters.spec: ok');
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exit(1);
}
