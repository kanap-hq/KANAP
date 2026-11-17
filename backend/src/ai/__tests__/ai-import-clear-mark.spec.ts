import * as assert from 'node:assert/strict';
import type { TableGrid } from '../attachments/table-attachment';
import { columnReader } from '../import/ai-import-convert';
import { buildImportMapping, type AiImportTemplateColumn } from '../import/ai-import-mapping';

// Lot I4 of 26.11.9 (D21): Kad's file carries the person's `-` to the imports that read it as the
// clearing mark, in every kind of column (a day, a fixed list, an e-mail), as the screen's file
// does: the import then clears the value or refuses the row. A blank cell stays blank (it keeps the
// stored value), and the model's value map turns a value into `-` only when it says so. The imports
// that do not follow the rule yet read `-` as before.

const text = (value: string) => ({ kind: 'text' as const, value });

function testEveryKindCarriesTheMark() {
  const kinds = [
    { kind: 'date' as const },
    { kind: 'number' as const },
    { kind: 'codes' as const, codes: ['enabled', 'disabled'] },
    { kind: 'email' as const },
    { kind: 'country' as const },
    { kind: 'text' as const },
  ];
  for (const rule of kinds) {
    const cells = [text('-'), text('__CLEAR__'), undefined];
    const reader = columnReader(rule, cells, { clearMark: true }, 'en');
    assert.equal(reader.error, null, rule.kind);
    assert.deepEqual(reader.read(text('-')), { status: 'converted', value: '-' }, rule.kind);
    assert.deepEqual(reader.read(text('__CLEAR__')), { status: 'converted', value: '-' }, `${rule.kind}: the older mark`);
    assert.deepEqual(reader.read(undefined), { status: 'blank' }, `${rule.kind}: a blank cell stays blank`);
  }
  // Without the rule, `-` in a day column is a value it does not read.
  assert.equal(columnReader({ kind: 'date' }, [text('-')], {}, 'en').read(text('-')).status, 'unread');
  // The model's value map: `-` when it says so, and a value mapped to '' stays blank.
  const mapped = columnReader({ kind: 'date' }, [text('n/a'), text('none')], { clearMark: true, values: { 'n/a': '-', none: '' } }, 'en');
  assert.deepEqual(mapped.read(text('n/a')), { status: 'converted', value: '-' });
  assert.deepEqual(mapped.read(text('none')), { status: 'blank' });
  // A day column whose other cells settle the date order still reads them.
  const days = columnReader({ kind: 'date' }, [text('-'), text('31/12/2027')], { clearMark: true }, 'fr');
  assert.deepEqual(days.read(text('31/12/2027')), { status: 'converted', value: '2027-12-31' });
}

function testTheMappingSetsTheMarkByImport() {
  const grid: TableGrid = {
    format: 'csv', sheetName: null, sheetCount: 1,
    header: [text('Fournisseur'), text('Fin de validité')], headerLine: 1,
    rows: [[text('Lactalis'), text('-')]], lines: [2],
  } as TableGrid;
  const template: AiImportTemplateColumn[] = [
    { column: 'name', title: 'Name', required: true, kind: 'text' },
    { column: 'disabled_at', title: 'Disabled on', required: false, kind: 'date' },
  ];
  const request = (importKey: string) => ({
    importKey: importKey as any,
    filename: 'fournisseurs.csv',
    columns: [
      { column: 'name', source: 1, confidence: 'high' as const },
      { column: 'disabled_at', source: 2, confidence: 'high' as const },
    ],
    assumptions: [],
  });
  const suppliers = buildImportMapping(grid, template, request('suppliers'), 'fr');
  assert.deepEqual(suppliers.file.rows, [['Lactalis', '-']], 'the suppliers import reads `-`');
  // Applications follow the rule with lot I6: `-` stays a value the day column does not read.
  const applications = buildImportMapping(grid, template, request('applications'), 'fr');
  assert.deepEqual(applications.file.rows, [['Lactalis', { unread: '-' }]]);
}

// The mark never goes through the model's value map: a `-` of the file reaches the import as it is,
// whatever the map says of it, and a value the map turns into `-` is a clearing, on a column the
// import matches by name too (never a record named "-" to propose).
function testTheValueMapNeverMovesTheMark() {
  for (const rule of [{ kind: 'text' as const }, { kind: 'date' as const }, { kind: 'codes' as const, codes: ['enabled', 'disabled'] }]) {
    for (const values of [{ '-': '' }, { '-': 'enabled' }, { '__clear__': '' }] as Array<Record<string, string>>) {
      const reader = columnReader(rule, [text('-'), text('__CLEAR__')], { clearMark: true, values }, 'en');
      assert.deepEqual(reader.read(text('-')), { status: 'converted', value: '-' }, `${rule.kind} ${JSON.stringify(values)}`);
      assert.deepEqual(reader.read(text('__CLEAR__')), { status: 'converted', value: '-' }, `${rule.kind} ${JSON.stringify(values)}`);
    }
  }
  const grid: TableGrid = {
    format: 'csv', sheetName: null, sheetCount: 1,
    header: [text('Email'), text('Fournisseur'), text('Notes')], headerLine: 1,
    rows: [[text('a@x.com'), text('aucun'), text('n/a')], [text('b@x.com'), text('-'), text('-')]], lines: [2, 3],
  } as TableGrid;
  const matched: Array<[string, string]> = [
    ['contacts', 'supplier_name'],
    ['contracts', 'cost_center'],
    ['cost_centers', 'company_name'],
    ['business_processes', 'parent_name'],
  ];
  for (const [importKey, column] of matched) {
    const template: AiImportTemplateColumn[] = [
      { column: 'email', title: 'Email', required: true, kind: 'text' },
      { column, title: 'Matched', required: false, kind: 'text' },
      { column: 'notes', title: 'Notes', required: false, kind: 'text' },
    ];
    const result = buildImportMapping(grid, template, {
      importKey: importKey as any,
      filename: 'f.csv',
      assumptions: [],
      columns: [
        { column: 'email', source: 1, confidence: 'high' as const },
        { column, source: 2, confidence: 'high' as const, values: { aucun: '-', '-': '' } },
        { column: 'notes', source: 3, confidence: 'high' as const, values: { 'n/a': '-', '-': '' } },
      ],
    }, 'fr');
    assert.deepEqual(result.file.rows, [['a@x.com', '-', '-'], ['b@x.com', '-', '-']], importKey);
    assert.equal(result.file.proposals, undefined, `${importKey}: "-" is never a record to propose`);
  }
}

testEveryKindCarriesTheMark();
testTheMappingSetsTheMarkByImport();
testTheValueMapNeverMovesTheMark();
console.log('ai-import-clear-mark.spec: ok');
