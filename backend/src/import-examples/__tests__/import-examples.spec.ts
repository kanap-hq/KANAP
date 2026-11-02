/**
 * The example files of the main imports (`fixtures/import-examples`): every column of a fixture is
 * defined, every header of the first sheet is one the import reads, in each language, and the
 * Notes sheet explains every column.
 */
import * as assert from 'node:assert/strict';
import * as fs from 'fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { readSheet, type CsvLanguage } from '../../common/csv-sheet';
import { looseKey } from '../../common/csv-sheet/text';
import { readXlsxGrid } from '../../common/xlsx/read';
import { readMasterDataFile } from '../../common/csv-sheet/master-data';
import type { CsvEntityConfig } from '../../common/csv/csv-field.types';
import { applicationCsvConfig } from '../../applications/application-csv.config';
import { assetCsvConfig } from '../../assets/asset-csv.config';
import { portfolioProjectCsvConfig } from '../../portfolio/portfolio-project-csv.config';
import { SUPPLIER_CSV_COLUMNS, SUPPLIER_CSV_HEADERS } from '../../suppliers/supplier-csv-headers';
import { CONTRACT_CSV_COLUMNS, CONTRACT_CSV_HEADERS } from '../../contracts/contract-csv-headers';
import { detailColumns, FILE_COLUMNS } from '../../spend/budget-file/columns';
import { BUDGET_AMOUNT_COLUMNS } from '../../common/csv-sheet/types';
import { DEFAULT_CLASSIFICATION_CATALOG } from '../../it-ops-settings/classification-catalog';
import { buildImportExample, ImportExampleWorkspace, readImportExampleFixture, withYears } from '../import-example';
import { IMPORT_EXAMPLE_KEYS, IMPORT_EXAMPLES, ImportExampleKey } from '../import-example-definitions';
import { EXAMPLE_TEXTS } from '../import-example-texts';

const LANGUAGES: CsvLanguage[] = ['en', 'fr', 'de', 'es'];
const YEAR = 2027;

/** The shipped catalogs, as a new workspace has them. */
function shippedCatalogs(): ImportExampleWorkspace['catalogs'] {
  const shipped = JSON.parse(fs.readFileSync(backendPath('src/it-ops-settings/shipped-catalog-labels.json'), 'utf8'));
  const catalogs: Record<string, Array<{ code: string; label: string }>> = {};
  for (const [list, options] of Object.entries(shipped.catalog as Record<string, Record<string, { source: string }>>)) {
    catalogs[list] = Object.entries(options).map(([code, labels]) => ({ code, label: labels.source }));
  }
  return { ...catalogs, ...DEFAULT_CLASSIFICATION_CATALOG } as ImportExampleWorkspace['catalogs'];
}

const workspace: ImportExampleWorkspace = {
  catalogs: shippedCatalogs(),
  dimensions: [{ code: 'default', name: 'Cost pool' }, { code: 'it_tower', name: 'IT tower' }],
  amountLabels: { budget: 'Budget', revision: 'Revision', forecast: 'Forecast', actual: 'Actuals', landing: 'Expected landing' },
  year: YEAR,
};

const FIELD_ENGINE: Partial<Record<ImportExampleKey, CsvEntityConfig>> = {
  applications: applicationCsvConfig,
  assets: assetCsvConfig,
  'portfolio-projects': portfolioProjectCsvConfig,
};

/** The worksheets of a workbook. */
function sheets(content: Buffer): number {
  const AdmZip = require('adm-zip');
  return new AdmZip(content).getEntries().filter((entry: any) => /^xl\/worksheets\/sheet\d+\.xml$/.test(entry.entryName)).length;
}

function testFixturesMatchTheirDefinitions() {
  for (const key of IMPORT_EXAMPLE_KEYS) {
    const fixture = readImportExampleFixture(key);
    const columns = [...fixture.essential, ...fixture.advanced];
    assert.equal(new Set(columns).size, columns.length, `${key}: a column is listed twice`);
    assert.ok(fixture.rows.length >= 2, `${key}: at least two example rows`);
    for (const column of columns) {
      const amount = /^(budget|revision|forecast|actual|landing)_\{Y([+-]\d+)?\}$/.test(column);
      assert.ok(amount || IMPORT_EXAMPLES[key].columns[column], `${key}: column ${column} has no definition`);
    }
    for (const [index, row] of fixture.rows.entries()) {
      assert.deepEqual(Object.keys(row).sort(), [...columns].sort(), `${key}: row ${index + 1} names every column, and only them`);
      for (const column of columns) {
        const spec = IMPORT_EXAMPLES[key].columns[column];
        const value = row[column];
        if (spec?.required) assert.ok(value !== '' && value !== null, `${key}: row ${index + 1} fills the required ${column}`);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          for (const language of LANGUAGES) assert.ok((value as any)[language], `${key}: row ${index + 1} ${column} has a ${language} text`);
        }
        if (spec?.kind === 'catalog' && value) {
          for (const code of Array.isArray(value) ? value : [String(value)]) {
            assert.ok((workspace.catalogs[spec.list] ?? []).some((option) => option.code === code), `${key}: ${column} code ${code} is in ${spec.list}`);
          }
        }
        if (spec?.kind === 'codes' && value) assert.ok(spec.codes.includes(String(value)), `${key}: ${column} code ${value}`);
        if (spec?.kind === 'date' && value) assert.match(withYears(String(value), YEAR), /^\d{4}-\d{2}-\d{2}$/, `${key}: ${column} is a day`);
      }
    }
    // Every required column of the import is on the first sheet.
    for (const [column, spec] of Object.entries(IMPORT_EXAMPLES[key].columns)) {
      if (spec.required) assert.ok(fixture.essential.includes(column), `${key}: required ${column} is on the first sheet`);
    }
  }
}

/** A title names one column of a config only, in every language, and never another column's technical name. */
function testTitlesAreUnique() {
  const configs: Array<[string, Record<string, Partial<Record<CsvLanguage, string>>>, readonly string[]]> = [
    ...Object.entries(FIELD_ENGINE).map(([key, config]) => [key, config!.headerLabels ?? {}, config!.fields.map((field) => field.csvColumn)] as [string, any, string[]]),
    ['suppliers', SUPPLIER_CSV_HEADERS, SUPPLIER_CSV_COLUMNS],
    ['contracts', CONTRACT_CSV_HEADERS, CONTRACT_CSV_COLUMNS],
  ];
  for (const [key, labels, columns] of configs) {
    const owner = new Map<string, string>();
    for (const column of columns) owner.set(looseKey(column), column);
    for (const [column, byLanguage] of Object.entries(labels)) {
      for (const language of LANGUAGES) {
        const title = byLanguage[language];
        assert.ok(title, `${key}: ${column} has a ${language} title`);
        const previous = owner.get(looseKey(title!));
        assert.ok(!previous || previous === column, `${key}: "${title}" names ${column} and ${previous}`);
        owner.set(looseKey(title!), column);
      }
    }
  }
}

/** The headers of the first sheet resolve to columns the import reads; the master-data readers take the rows. */
async function testFirstSheetImports() {
  for (const key of IMPORT_EXAMPLE_KEYS) {
    const fixture = readImportExampleFixture(key);
    for (const language of LANGUAGES) {
      const file = buildImportExample(key, language, workspace);
      assert.equal(file.filename, `${IMPORT_EXAMPLES[key].fileNames[language]}-${EXAMPLE_TEXTS[language].file}.xlsx`);
      const grid = readXlsxGrid(file.content);
      assert.equal(grid.sheetName, EXAMPLE_TEXTS[language].sheets.examples, `${key} ${language}: the examples come first`);
      assert.equal(grid.sheetCount, fixture.advanced.length > 0 || key === 'budget-lines' ? 3 : 2, `${key} ${language}: sheets`);
      assert.equal(sheets(file.content), grid.sheetCount);
      const headers = grid.rows[0].map((cell) => (cell.kind === 'text' ? cell.value : ''));
      assert.equal(grid.rows.length, fixture.rows.length + 1, `${key} ${language}: one row per example`);

      const config = FIELD_ENGINE[key];
      if (config) {
        const importable = new Map<string, string>();
        for (const field of config.fields.filter((item) => item.importable !== false)) {
          importable.set(looseKey(field.csvColumn), field.csvColumn);
          for (const title of Object.values(config.headerLabels?.[field.csvColumn] ?? {})) if (title) importable.set(looseKey(title), field.csvColumn);
        }
        const read = headers.map((header) => importable.get(looseKey(header)));
        assert.deepEqual(read, fixture.essential, `${key} ${language}: the headers read as the essential columns`);
        if (language !== 'en') assert.ok(headers.some((header, index) => header !== fixture.essential[index]), `${key} ${language}: translated headers`);
        continue;
      }
      if (key === 'suppliers' || key === 'contracts') {
        const labels = key === 'suppliers' ? SUPPLIER_CSV_HEADERS : CONTRACT_CSV_HEADERS;
        const read = await readMasterDataFile({
          file: file.content,
          fields: key === 'suppliers' ? [...SUPPLIER_CSV_COLUMNS] : [...CONTRACT_CSV_COLUMNS],
          fieldLabels: labels,
          dateFields: key === 'suppliers' ? ['disabled_at'] : ['start_date'],
          language,
        });
        assert.equal(read.headerError, null, `${key} ${language}: ${JSON.stringify(read.headerError)}`);
        assert.equal(read.rows.length, fixture.rows.length, `${key} ${language}: rows`);
        assert.deepEqual(read.ignoredColumns, []);
        continue;
      }
      // The budget file: its own columns, the amount columns of the year, in any language.
      const read = await readSheet(file.content, {
        fields: detailColumns(workspace.dimensions.map((dimension) => dimension.code)).concat('kanap_token'),
        amounts: BUDGET_AMOUNT_COLUMNS,
        dimensions: workspace.dimensions.map((dimension) => dimension.code),
        dateFields: ['effective_start', 'end_of_validity'],
        language,
      });
      assert.deepEqual(read.headerErrors, [], `${key} ${language}`);
      assert.deepEqual(read.ignoredColumns, [], `${key} ${language}`);
      assert.ok(headers.includes(`budget_${YEAR}`), `${key}: the amount column of the year`);
      assert.ok(FILE_COLUMNS.includes('budget'));
    }
  }
}

/** The Notes sheet has one row per column of both sheets, and the catalogs are written in the file's language. */
function testNotesAndCatalogNames() {
  const AdmZip = require('adm-zip');
  for (const key of IMPORT_EXAMPLE_KEYS) {
    const fixture = readImportExampleFixture(key);
    const extra = key === 'budget-lines' ? workspace.dimensions.length : 0;
    for (const language of LANGUAGES) {
      const file = buildImportExample(key, language, workspace);
      const zip = new AdmZip(file.content);
      const notesIndex = fixture.advanced.length > 0 || key === 'budget-lines' ? 3 : 2;
      const notes: string = zip.readAsText(`xl/worksheets/sheet${notesIndex}.xml`);
      const rows = (notes.match(/<row /g) ?? []).length;
      const footer = key === 'budget-lines' ? 3 : 2;
      assert.equal(rows, 1 + fixture.essential.length + fixture.advanced.length + extra + footer, `${key} ${language}: notes rows`);
    }
  }
  const french = new (require('adm-zip'))(buildImportExample('applications', 'fr', workspace).content).readAsText('xl/worksheets/sheet1.xml');
  assert.ok(french.includes('Métier'), 'a catalog code is written as its French name');
  assert.ok(french.includes('>oui<') && french.includes('>non<'), 'yes or no in French, as the export writes it');
  assert.ok(french.includes('Description'), 'the French header');
}

(async () => {
  testFixturesMatchTheirDefinitions();
  testTitlesAreUnique();
  await testFirstSheetImports();
  testNotesAndCatalogNames();
  console.log('Import example tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
