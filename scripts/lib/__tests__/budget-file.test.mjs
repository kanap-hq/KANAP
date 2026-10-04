// Unit tests of the budget file conversion (node --test).
//
//   node --test scripts/lib/__tests__/budget-file.test.mjs
//
// The expected column orders are the ones `backend/src/spend/budget-file/columns.ts`
// writes: detail columns, then `analytics:<code>`, then the amount columns, then
// `kanap_token`. Contract: planning/sfr/briefs/csv-c6-brief.md.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLinesFile, buildMonthlyFile, dimensionColumns, endOfValidityOf } from '../budget-file.mjs';

/** A tiny CSV reader (comma, double quotes), enough for the generated files. */
function parse(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i += 1) {
    const ch = csv[i];
    if (ch === '"') {
      if (quoted && csv[i + 1] === '"') { field += '"'; i += 1; } else quoted = !quoted;
      continue;
    }
    if (!quoted && ch === ',') { row.push(field); field = ''; continue; }
    if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && csv[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift();
  return { header, rows: rows.map((values) => Object.fromEntries(header.map((h, i) => [h, values[i] ?? '']))) };
}

const OPEX_ROW = {
  product_name: 'Microsoft Enterprise',
  description: 'M365 E3',
  supplier_name: 'Microsoft',
  company_name: 'Fromage & Co SA',
  account_number: '612100',
  currency: 'EUR',
  effective_start: '2024-01-01',
  status: 'enabled',
  disabled_at: '',
  owner_it_email: 'pierre.martin@fromage-co.com',
  owner_business_email: 'thomas.berger@fromage-co.com',
  analytics_category: 'Productivity',
  'analytics:nature': 'Licences',
  'analytics:reference': 'REF-SAP',
  cost_center_code: 'FR-TRV-500',
  run_build: 'run',
  notes: 'Group-wide EA',
  y_minus1_budget: '620000',
  y_minus1_landing: '625000',
  y_budget: '650000',
  y_follow_up: '',
  y_landing: '659500',
  y_revision: '',
  y_plus1_budget: '',
  y_plus1_revision: '',
};

const CAPEX_ROW = {
  item_number: '',
  description: 'SAP Cheddar Migration',
  ppe_type: 'software',
  investment_type: 'replacement',
  priority: 'mandatory',
  currency: 'EUR',
  effective_start: '2025-07-01',
  status: 'enabled',
  disabled_at: '2027-12-31',
  notes: 'Migration',
  company_name: 'Fromage & Co SA',
  owner_it_email: 'lucas.bernard@fromage-co.com',
  owner_business_email: 'isabelle.moreau@fromage-co.com',
  analytics_category: 'Centre de compétences',
  'analytics:nature': 'Conseil',
  cost_center_code: 'FR-DIS-200',
  run_build: 'build',
  y_minus1_budget: '50000',
  y_minus1_landing: '45000',
  y_budget: '350000',
  y_follow_up: '',
  y_landing: '382000',
  y_revision: '357000',
  y_plus1_budget: '',
  y_plus1_revision: '',
  y_plus2_budget: '',
};

const OPEX_HEADER = 'item_number,name,description,company_name,supplier_name,supplier_erp_id,account_number,cost_center_code,run_build,analytics:default,analytics:nature,analytics:reference,owner_it_email,owner_business_email,project,currency,effective_start,end_of_validity,notes,budget_2025,landing_2025,budget_2026,revision_2026,actual_2026,landing_2026,budget_2027,revision_2027,kanap_token';
const CAPEX_HEADER = 'item_number,name,ppe_type,investment_type,priority,company_name,supplier_name,supplier_erp_id,account_number,cost_center_code,run_build,analytics:default,analytics:nature,owner_it_email,owner_business_email,project,currency,effective_start,end_of_validity,notes,budget_2025,landing_2025,budget_2026,revision_2026,actual_2026,landing_2026,budget_2027,revision_2027,budget_2028,kanap_token';

test('OPEX lines file: column order, dimension column, token last', () => {
  const csv = buildLinesFile('opex', [OPEX_ROW], { year: 2026, defaultDimensionCode: 'default', existingNumbers: new Map() });
  const { header } = parse(csv);
  assert.equal(header.join(','), OPEX_HEADER);
  assert.equal(header.at(-1), 'kanap_token');
});

test('CAPEX lines file: column order, CAPEX has no description column', () => {
  const csv = buildLinesFile('capex', [CAPEX_ROW], { year: 2026, defaultDimensionCode: 'default', existingNumbers: new Map() });
  const { header } = parse(csv);
  assert.equal(header.join(','), CAPEX_HEADER);
  assert.ok(!header.includes('description'));
});

test('relative amount columns land on the year Y passed in', () => {
  const csv = buildLinesFile('opex', [OPEX_ROW], { year: 2030, defaultDimensionCode: 'expense', existingNumbers: new Map() });
  const { header, rows } = parse(csv);
  assert.deepEqual(
    header.filter((column) => /^(budget|revision|forecast|actual|landing)_\d/.test(column)),
    ['budget_2029', 'landing_2029', 'budget_2030', 'revision_2030', 'actual_2030', 'landing_2030', 'budget_2031', 'revision_2031'],
  );
  assert.equal(rows[0].budget_2030, '650000');
  assert.equal(rows[0].actual_2030, '');
  assert.equal(rows[0].landing_2031, undefined);
});

test('analytics_category feeds the tenant default dimension, other dimensions keep their code', () => {
  const csv = buildLinesFile('opex', [OPEX_ROW], { year: 2026, defaultDimensionCode: 'expense', existingNumbers: new Map() });
  const { header, rows } = parse(csv);
  assert.ok(header.includes('analytics:expense'));
  assert.ok(!header.includes('analytics:default'));
  assert.ok(!header.includes('analytics_category'));
  assert.equal(rows[0]['analytics:expense'], 'Productivity');
  assert.equal(rows[0]['analytics:nature'], 'Licences');
  assert.equal(rows[0]['analytics:reference'], 'REF-SAP');
});

test('analytics_category without a default dimension code is a programming error', () => {
  assert.throws(() => buildLinesFile('opex', [OPEX_ROW], { year: 2026 }), /defaultDimensionCode is required/);
  assert.deepEqual(dimensionColumns(['analytics:nature'], undefined), ['analytics:nature']);
});

test('disabled_at becomes end_of_validity, and the status column is dropped', () => {
  const csv = buildLinesFile('capex', [CAPEX_ROW], { year: 2026, defaultDimensionCode: 'default', existingNumbers: new Map() });
  const { header, rows } = parse(csv);
  assert.equal(rows[0].end_of_validity, '2027-12-31');
  assert.ok(!header.includes('status'));
  assert.ok(!header.includes('disabled_at'));
});

test('a disabled row without a date ends on 31 December of Y-1', () => {
  const row = { ...OPEX_ROW, status: 'disabled', disabled_at: '' };
  const { rows } = parse(buildLinesFile('opex', [row], { year: 2026, defaultDimensionCode: 'default', existingNumbers: new Map() }));
  assert.equal(rows[0].end_of_validity, '2025-12-31');
  assert.equal(endOfValidityOf({ status: 'DISABLED' }, 2027), '2026-12-31');
  assert.equal(endOfValidityOf({ status: 'disabled', disabled_at: '2026-06-30' }, 2027), '2026-06-30');
  assert.equal(endOfValidityOf({ status: 'enabled' }, 2027), '');
});

test('cells holding a comma or a quote are quoted, inner quotes doubled', () => {
  const row = { ...OPEX_ROW, description: 'M365 E3, plus "GitHub" seats' };
  const csv = buildLinesFile('opex', [row], { year: 2026, defaultDimensionCode: 'default', existingNumbers: new Map() });
  assert.ok(csv.includes('"M365 E3, plus ""GitHub"" seats"'));
  const { rows } = parse(csv);
  assert.equal(rows[0].description, 'M365 E3, plus "GitHub" seats');
});

test('a line whose name already exists gets its item_number, a new one stays blank', () => {
  const existing = new Map([['Microsoft Enterprise', 'OPX-7']]);
  const { rows } = parse(buildLinesFile('opex', [OPEX_ROW, { ...OPEX_ROW, product_name: 'New line' }], {
    year: 2026, defaultDimensionCode: 'default', existingNumbers: existing,
  }));
  assert.equal(rows[0].item_number, 'OPX-7');
  assert.equal(rows[1].item_number, '');
});

test('the CAPEX item_number of the source is ignored', () => {
  const { rows } = parse(buildLinesFile('capex', [{ ...CAPEX_ROW, item_number: 'CPX-3' }], {
    year: 2026, defaultDimensionCode: 'default', existingNumbers: new Map(),
  }));
  assert.equal(rows[0].item_number, '');
});

test('monthly file: one row per item, measures mapped to file columns', () => {
  const names = new Map([['Licences', 'OPX-1'], ['Support', 'OPX-2']]);
  const rows = [
    { item_type: 'opex', item_name: 'Licences', year: '2026', measure: 'planned', period_start: '2026-01-01', period_end: '2026-12-31', jan: '100', feb: '0', mar: '', apr: '', may: '', jun: '', jul: '', aug: '', sep: '', oct: '', nov: '', dec: '' },
    { item_type: 'opex', item_name: 'Support', year: '2026', measure: 'expected_landing', period_start: '2026-01-01', period_end: '2026-06-30', jan: '1', feb: '2', mar: '3', apr: '4', may: '5', jun: '6', jul: '0', aug: '0', sep: '0', oct: '0', nov: '0', dec: '0' },
    { item_type: 'capex', item_name: 'Ignored', year: '2026', measure: 'planned', jan: '9', feb: '', mar: '', apr: '', may: '', jun: '', jul: '', aug: '', sep: '', oct: '', nov: '', dec: '' },
    { item_type: 'opex', item_name: 'Unknown item', year: '2026', measure: 'planned', jan: '1', feb: '', mar: '', apr: '', may: '', jun: '', jul: '', aug: '', sep: '', oct: '', nov: '', dec: '' },
  ];
  const { header, rows: out } = parse(buildMonthlyFile('opex', rows, { numbersByName: names }));
  assert.equal(out.length, 2);
  assert.deepEqual(header.slice(0, 1), ['item_number']);
  assert.equal(out[0].item_number, 'OPX-1');
  assert.equal(out[1].item_number, 'OPX-2');
  assert.equal(out[0].budget_2026_01, '100');
  assert.equal(out[0].budget_2026_02, '0');
  assert.equal(out[0].budget_2026_03, '');
  assert.equal(out[1].landing_2026_06, '6');
  assert.equal(out[1].landing_2026_07, '0');
});

test('monthly file: storage keys and file names are both accepted', () => {
  const names = new Map([['A', 'OPX-1']]);
  const row = (measure) => ({ item_type: 'opex', item_name: 'A', year: '2026', measure, jan: '1', feb: '', mar: '', apr: '', may: '', jun: '', jul: '', aug: '', sep: '', oct: '', nov: '', dec: '' });
  for (const [measure, column] of [['committed', 'revision'], ['forecast', 'forecast'], ['actual', 'actual'], ['budget', 'budget'], ['revision', 'revision'], ['landing', 'landing'], ['follow_up', 'actual']]) {
    const { rows } = parse(buildMonthlyFile('opex', [row(measure)], { numbersByName: names }));
    assert.equal(rows[0][`${column}_2026_01`], '1', `${measure} -> ${column}`);
  }
  assert.throws(() => buildMonthlyFile('opex', [row('nonsense')], { numbersByName: names }), /Unknown measure/);
});

test('monthly file: twelve month headers per column and year, never a yearly header', () => {
  const names = new Map([['A', 'OPX-1']]);
  const row = { item_type: 'opex', item_name: 'A', year: '2026', measure: 'planned', jan: '1', feb: '', mar: '', apr: '', may: '', jun: '', jul: '', aug: '', sep: '', oct: '', nov: '', dec: '' };
  const { header } = parse(buildMonthlyFile('opex', [row], { numbersByName: names }));
  assert.equal(header.length, 13);
  assert.deepEqual(header.slice(1), Array.from({ length: 12 }, (_, i) => `budget_2026_${String(i + 1).padStart(2, '0')}`));
  assert.ok(!header.some((column) => /^(budget|revision|forecast|actual|landing)_\d{4}$/.test(column)));
  assert.ok(!header.includes('name'));
  assert.ok(!header.includes('measure'));
  assert.ok(!header.includes('period_start'));
});

test('monthly file: several years and measures group per year then per file column order', () => {
  const names = new Map([['A', 'OPX-1']]);
  const row = (year, measure) => ({ item_type: 'opex', item_name: 'A', year, measure, jan: '1', feb: '1', mar: '1', apr: '1', may: '1', jun: '1', jul: '1', aug: '1', sep: '1', oct: '1', nov: '1', dec: '1' });
  const { header } = parse(buildMonthlyFile('opex', [
    row('2027', 'committed'), row('2026', 'planned'), row('2026', 'actual'),
  ], { numbersByName: names }));
  assert.deepEqual(
    header.filter((column) => column.endsWith('_01')),
    ['budget_2026_01', 'actual_2026_01', 'revision_2027_01'],
  );
});
