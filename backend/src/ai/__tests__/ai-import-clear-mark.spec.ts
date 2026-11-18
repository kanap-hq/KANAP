import * as assert from 'node:assert/strict';
import { readTableAttachment, type TableGrid } from '../attachments/table-attachment';
import { columnReader } from '../import/ai-import-convert';
import { si, workbookParts, zipOf } from '../../common/xlsx/__tests__/fixtures/handmade';
import { buildImportMapping, type AiImportTemplateColumn } from '../import/ai-import-mapping';

// Lot I4 of 26.11.9 (D21): Kad's file carries the person's `-` to the imports that read it as the
// clearing mark, in every kind of column (a day, a fixed list, an e-mail), as the screen's file
// does: the import then clears the value or refuses the row. A blank cell stays blank (it keeps the
// stored value), and the model's value map turns a value into `-` only when it says so. The six
// imports of the shared import follow it since lot I6; the budget file reads `-` by its own reader.

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
  // The imports of lot I4 and, since lot I6, the six of the shared import read `-`.
  for (const key of ['suppliers', ...SHARED_IMPORTS]) {
    const mapped = buildImportMapping(grid, template, request(key), 'fr');
    assert.deepEqual(mapped.file.rows, [['Lactalis', '-']], `the ${key} import reads \`-\``);
  }
  // The budget file reads its cells by its own reader: `-` stays a value the day column does not read.
  const budget = buildImportMapping(grid, template, request('budget_lines'), 'fr');
  assert.deepEqual(budget.file.rows, [['Lactalis', { unread: '-' }]]);
}

/** The six imports of the shared import, under the clearing rule since lot I6 of 26.11.9. */
const SHARED_IMPORTS = ['applications', 'assets', 'portfolio_projects', 'portfolio_requests', 'tasks', 'incidents'];

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
    ['applications', 'supplier_name'],
    ['assets', 'cluster'],
    ['tasks', 'company_name'],
    ['incidents', 'owner'],
    ['portfolio_projects', 'company_name'],
    ['portfolio_requests', 'category_name'],
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

// An export writes a stored "-" as `'-`: Kad's file carries it as written, and the import reads it
// as the text "-" (an export re-imported changes nothing).
async function testTheGuardedDashStaysAValue() {
  const grid = await readTableAttachment(Buffer.from("name;notes\nAcme;'-\n", 'utf8'));
  assert.deepEqual(grid.rows[0][1], text("'-"));
  const reader = columnReader({ kind: 'text' }, [text("'-")], { clearMark: true }, 'en');
  assert.deepEqual(reader.read(text("'-")), { status: 'converted', value: "'-" });
  // `'-` typed in Excel: "-" in a cell whose style carries the apostrophe (`quotePrefix`).
  const parts = workbookParts({
    sharedStrings: [si('name'), si('notes'), si('Acme'), si('-')],
    cellXfs: [0, 0],
    sheetData: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s" s="1"><v>3</v></c></row>'
      + '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="s"><v>3</v></c></row>',
  });
  parts['xl/styles.xml'] = String(parts['xl/styles.xml']).replace(/(<cellXfs><xf [^>]*)\/>(<xf [^>]*)\/>/, '$1/>$2 quotePrefix="1"/>');
  const typed = await readTableAttachment(zipOf(parts));
  assert.deepEqual(typed.rows[0][1], text("'-"), 'the dash typed after an apostrophe stays a value');
  assert.deepEqual(typed.rows[1][1], text('-'), 'a dash typed alone clears');
}

testEveryKindCarriesTheMark();
testTheMappingSetsTheMarkByImport();
testTheValueMapNeverMovesTheMark();
testTheGuardedDashStaysAValue().then(() => console.log('ai-import-clear-mark.spec: ok'), (error) => {
  console.error(error);
  process.exit(1);
});
