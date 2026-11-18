import * as assert from 'node:assert/strict';
import type { TableGrid } from '../attachments/table-attachment';
import { buildImportMapping, type AiImportColumnMappingInput, type AiImportTemplateColumn } from '../import/ai-import-mapping';
import { AI_IMPORT_TARGETS, importColumnTitle } from '../import/ai-import-targets';

// Lot I4 of 26.11.9 (D21): in the imports that follow the clearing rule, a column of the file that the
// screen's import reads is read by Kad too: a header that names a template column (its key or one of its
// titles, as the screen's import recognises them) and that the model left unmapped is added to the
// mapping, unless the person asked to leave it aside (`left_aside`). Every row import follows the rule
// since lot I6; the budget file maps only what the model maps.

const text = (value: string) => ({ kind: 'text' as const, value });

function grid(headers: string[], rows: string[][]): TableGrid {
  return {
    format: 'csv', sheetName: null, sheetCount: 1,
    header: headers.map(text), headerLine: 1, width: headers.length,
    rows: rows.map((row) => row.map((cell) => (cell === '' ? undefined : text(cell)))), lines: rows.map((_, index) => index + 2),
  } as TableGrid;
}

/** The suppliers template as the service builds it: the titles the screen reads each column by. */
function suppliersTemplate(): AiImportTemplateColumn[] {
  const specs = AI_IMPORT_TARGETS.suppliers.columns({} as any) as any[];
  return specs.map((spec) => ({ ...spec, title: importColumnTitle(spec, 'fr'), required: spec.required === true }) as AiImportTemplateColumn);
}

const nameOnly: AiImportColumnMappingInput[] = [{ column: 'name', source: 1, confidence: 'high' }];

function request(importKey: string, columns: AiImportColumnMappingInput[], leftAside?: string[]) {
  return { importKey: importKey as any, filename: 'fournisseurs.csv', columns, assumptions: [], ...(leftAside ? { leftAside } : {}) };
}

function testANamedColumnIsAdded() {
  const file = grid(['name', 'notes'], [['Lactalis', '-'], ['Savencia', '']]);
  const mapped = buildImportMapping(file, suppliersTemplate(), request('suppliers', nameOnly), 'fr');
  const notes = mapped.preview.columns.find((column) => column.column === 'notes');
  assert.ok(notes, 'the notes column the screen reads is read');
  assert.deepEqual([notes!.source, notes!.confidence, notes!.note], [{ position: 2, header: 'notes' }, 'high', null]);
  assert.deepEqual(mapped.preview.unplaced, [], 'it is no longer an unused column');
  assert.deepEqual(mapped.file.columns.map((column) => column.column), ['name', 'notes']);
  assert.deepEqual(mapped.file.rows, [['Lactalis', '-'], ['Savencia', '']], 'its `-` reaches the import, a blank cell stays blank');
}

function testLeftAsideStaysOut() {
  const file = grid(['name', 'Notes'], [['Lactalis', '-']]);
  for (const aside of [['Notes'], ['notes'], [' NOTES ']]) {
    const mapped = buildImportMapping(file, suppliersTemplate(), request('suppliers', nameOnly, aside), 'fr');
    assert.deepEqual(mapped.preview.columns.map((column) => column.column), ['name'], JSON.stringify(aside));
    assert.deepEqual(mapped.preview.unplaced, [{ position: 2, header: 'Notes' }]);
    assert.deepEqual(mapped.file.rows, [['Lactalis']]);
  }
  // A column the file does not have is a refusal the model repairs.
  assert.throws(
    () => buildImportMapping(file, suppliersTemplate(), request('suppliers', nameOnly, ['Remarques']), 'fr'),
    /left_aside names Remarques, which is not a column of the file/,
  );
}

function testTranslatedTitlesAsTheScreen() {
  // Titles of other languages than the person's, as the screen's import reads them.
  const file = grid(['Nom', 'Notizen', 'ID fournisseur ERP', 'Commentaire'], [['Lactalis', '-', 'F-001', 'x']]);
  const mapped = buildImportMapping(file, suppliersTemplate(), request('suppliers', nameOnly), 'en');
  assert.deepEqual(
    mapped.preview.columns.map((column) => [column.column, column.source?.position]),
    [['name', 1], ['erp_supplier_id', 3], ['notes', 2]],
  );
  // A header no title names stays unused.
  assert.deepEqual(mapped.preview.unplaced, [{ position: 4, header: 'Commentaire' }]);
}

function testTheModelsMappingWins() {
  const template = suppliersTemplate();
  // The model read the notes from another column: the file's `notes` column is not added.
  const elsewhere = buildImportMapping(
    grid(['name', 'notes', 'Remarques'], [['Lactalis', 'a', 'b']]),
    template,
    request('suppliers', [...nameOnly, { column: 'notes', source: 3, confidence: 'medium' }]),
    'fr',
  );
  assert.deepEqual(elsewhere.preview.columns.map((column) => [column.column, column.source?.position]), [['name', 1], ['notes', 3]]);
  assert.deepEqual(elsewhere.preview.unplaced, [{ position: 2, header: 'notes' }]);
  // The model mapped the `notes` column onto another template column: it stays there.
  const moved = buildImportMapping(
    grid(['name', 'notes'], [['Lactalis', 'F-9']]),
    template,
    request('suppliers', [...nameOnly, { column: 'erp_supplier_id', source: 2, confidence: 'low' }]),
    'fr',
  );
  assert.deepEqual(moved.preview.columns.map((column) => column.column), ['name', 'erp_supplier_id']);
  // A value for every row fills the column: the file's column is not added.
  const valued = buildImportMapping(
    grid(['name', 'status'], [['Lactalis', '-']]),
    template,
    request('suppliers', [...nameOnly, { column: 'status', value: 'enabled', confidence: 'high' }]),
    'fr',
  );
  assert.deepEqual(valued.preview.columns.map((column) => [column.column, column.source?.position ?? null]), [['name', 1], ['status', null]]);
}

// The six imports of the shared import read a column the screen reads since lot I6 of 26.11.9.
function testTheSharedImportsReadNamedColumns() {
  const template: AiImportTemplateColumn[] = [
    { column: 'name', title: 'Nom', required: true, kind: 'text' },
    { column: 'description', title: 'Description', required: false, kind: 'text' },
  ];
  for (const key of ['applications', 'assets', 'portfolio_projects', 'portfolio_requests', 'tasks', 'incidents']) {
    const mapped = buildImportMapping(grid(['name', 'Description'], [['Kadratis', '-']]), template, request(key, nameOnly), 'fr');
    assert.deepEqual(mapped.preview.columns.map((column) => column.column), ['name', 'description'], key);
    assert.deepEqual(mapped.preview.unplaced, [], key);
    assert.deepEqual(mapped.file.rows, [['Kadratis', '-']], `${key}: its \`-\` reaches the import`);
  }
}

// The budget file maps only what the model maps.
function testTheBudgetFileUnchanged() {
  const template: AiImportTemplateColumn[] = [
    { column: 'name', title: 'Nom', required: true, kind: 'text' },
    { column: 'description', title: 'Description', required: false, kind: 'text' },
  ];
  const mapped = buildImportMapping(grid(['name', 'description'], [['Kadratis', '-']]), template, request('budget_lines', nameOnly), 'fr');
  assert.deepEqual(mapped.preview.columns.map((column) => column.column), ['name']);
  assert.deepEqual(mapped.preview.unplaced, [{ position: 2, header: 'description' }]);
}

testANamedColumnIsAdded();
testLeftAsideStaysOut();
testTranslatedTitlesAsTheScreen();
testTheModelsMappingWins();
testTheSharedImportsReadNamedColumns();
testTheBudgetFileUnchanged();
console.log('ai-import-screen-named-columns.spec: ok');
