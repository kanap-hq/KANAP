import * as fs from 'fs';
import * as path from 'path';
import { formatCsvBoolean, type CsvLanguage } from '../common/csv-sheet';
import { writeXlsx, XLSX_CONTENT_TYPE, type XlsxCell, type XlsxSheet } from '../common/xlsx/write';
import { assetEnvironmentLabel } from '../assets/asset-environments';
import { ENVIRONMENTS } from '../assets/services/assets-base.service';
import { shippedLabelIn } from '../it-ops-settings/catalog-shipped-labels';
import type { CatalogOptionLike } from '../it-ops-settings/catalog-resolve';
import { CatalogList, ExampleColumn, IMPORT_EXAMPLES, ImportExampleKey } from './import-example-definitions';
import { EXAMPLE_TEXTS } from './import-example-texts';

/** The fixtures of the example files, from the backend directory (`src/`, `dist/` and `ci-dist/` all sit below it). */
export const IMPORT_EXAMPLES_RELATIVE_PATH = path.join('fixtures', 'import-examples');

type Translated = Partial<Record<CsvLanguage, string>>;
type FixtureValue = string | number | boolean | string[] | Translated | null;

/**
 * One example file: the columns of the first sheet (`essential`), those of the Advanced sheet, and the
 * rows. A cell is the value as an English file holds it, a code for a catalog or a list of codes, or a
 * text per language. `{Y}`, `{Y+1}`, `{Y-2}` in a column name or a cell stand for the current year.
 */
export interface ImportExampleFixture {
  essential: string[];
  advanced: string[];
  rows: Array<Record<string, FixtureValue>>;
}

/** What an example takes from the workspace that downloads it. */
export interface ImportExampleWorkspace {
  /** The IT catalogs (`ItOpsSettings`), the codes of the fixture written as the workspace names them. */
  catalogs: Partial<Record<CatalogList, CatalogOptionLike[]>>;
  /** The enabled dimensions, for the `analytics:<code>` columns of the budget file. */
  dimensions: Array<{ code: string; name: string | null }>;
  /** The name of each budget column in the workspace (`budget` gives "Budget"). */
  amountLabels: Record<string, string>;
  /** The current year. */
  year: number;
}

export interface ImportExampleFile {
  filename: string;
  contentType: string;
  content: Buffer;
}

const AMOUNT_COLUMN = /^(budget|revision|forecast|actual|landing)_(\d{4})$/;

/** The directory of the fixtures, looked up from `from` up to the backend directory; null when it is not there. */
export function findImportExamplesDir(from: string = __dirname): string | null {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, IMPORT_EXAMPLES_RELATIVE_PATH);
    if (fs.existsSync(candidate)) return candidate;
    const backendRoot = fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'tsconfig.json'));
    if (backendRoot || path.dirname(dir) === dir) return null;
  }
}

export function readImportExampleFixture(key: ImportExampleKey, dir: string | null = findImportExamplesDir()): ImportExampleFixture {
  if (!dir) throw new Error(`Import examples not found (${IMPORT_EXAMPLES_RELATIVE_PATH} below the backend directory)`);
  return JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), 'utf8')) as ImportExampleFixture;
}

/** `{Y}`, `{Y+1}`, `{Y-2}` replaced by the year they stand for. */
export function withYears(value: string, year: number): string {
  return value.replace(/\{Y([+-]\d+)?\}/g, (_match, shift: string | undefined) => String(year + Number(shift ?? 0)));
}

function isTranslated(value: FixtureValue): value is Translated {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function catalogName(list: CatalogList, code: string, workspace: ImportExampleWorkspace, language: CsvLanguage): string {
  const option = (workspace.catalogs[list] ?? []).find((item) => item.code === code);
  if (!option) return code;
  return shippedLabelIn(list, option, language) ?? (option.label || code);
}

/** One cell of an example: the text or the typed cell the export writes for that value. */
function exampleCell(
  column: string,
  value: FixtureValue | undefined,
  spec: ExampleColumn | undefined,
  workspace: ImportExampleWorkspace,
  language: CsvLanguage,
): XlsxCell {
  if (value === undefined || value === null || value === '') return null;
  if (isTranslated(value)) return value[language] ?? value.en ?? null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    const names = spec?.kind === 'catalog' ? value.map((code) => catalogName(spec.list, code, workspace, language)) : value;
    return names.join(', ');
  }
  const amount = AMOUNT_COLUMN.test(column) || spec?.kind === 'amount';
  if (typeof value === 'number') return amount ? { kind: 'amount', value: String(value) } : { kind: 'number', value };
  if (typeof value === 'boolean') return formatCsvBoolean(value, language);
  const textValue = withYears(value, workspace.year);
  if (spec?.kind === 'date') return { kind: 'date', iso: textValue };
  if (spec?.kind === 'catalog') return catalogName(spec.list, textValue, workspace, language);
  if (spec?.kind === 'environment') return assetEnvironmentLabel(textValue, language);
  return textValue;
}

/** What the notes say a column holds. */
function whatToWrite(column: string, spec: ExampleColumn | undefined, workspace: ImportExampleWorkspace, language: CsvLanguage): string {
  const texts = EXAMPLE_TEXTS[language];
  const amount = AMOUNT_COLUMN.exec(column);
  if (amount) return texts.amountColumn(workspace.amountLabels[amount[1]] ?? amount[1], amount[2]);
  if (column.startsWith('analytics:')) {
    const code = column.slice('analytics:'.length);
    const dimension = workspace.dimensions.find((item) => item.code === code);
    return texts.dimension(dimension?.name || code);
  }
  if (!spec) return texts.text;
  switch (spec.kind) {
    case 'catalog': {
      const names = (workspace.catalogs[spec.list] ?? [])
        .filter((option) => !option.deprecated)
        .map((option) => catalogName(spec.list, option.code, workspace, language))
        .join(', ');
      return spec.multi ? texts.someOf(names) : texts.oneOf(names);
    }
    case 'codes':
      return texts.oneOf(spec.codes.join(', '));
    case 'environment':
      return texts.oneOf(ENVIRONMENTS.map((code) => assetEnvironmentLabel(code, language)).join(', '));
    case 'reference':
      return texts.reference[spec.thing];
    default:
      return spec.hint ? texts.hints[spec.hint] : texts[spec.kind];
  }
}

/**
 * The example workbook of an import, in `language`: the first sheet holds the essential columns and
 * imports as it is; the Advanced sheet the other columns, after the name of each row; the Notes sheet
 * what each column holds, with the values the workspace accepts.
 */
export function buildImportExample(
  key: ImportExampleKey,
  language: CsvLanguage,
  workspace: ImportExampleWorkspace,
  fixture: ImportExampleFixture = readImportExampleFixture(key),
): ImportExampleFile {
  const definition = IMPORT_EXAMPLES[key];
  const texts = EXAMPLE_TEXTS[language];
  const columnOf = (name: string) => withYears(name, workspace.year);
  const essential = fixture.essential;
  const advanced = [...fixture.advanced];
  // The budget file has one column per enabled dimension: they go to the Advanced sheet, empty.
  if (key === 'budget-lines') for (const dimension of workspace.dimensions) advanced.push(`analytics:${dimension.code}`);

  const header = (name: string) => definition.header(columnOf(name), language);
  const row = (columns: string[], values: Record<string, FixtureValue>) =>
    columns.map((name) => exampleCell(columnOf(name), values[name], definition.columns[name], workspace, language));

  const sheets: XlsxSheet[] = [
    { name: texts.sheets.examples, headers: essential.map(header), rows: fixture.rows.map((values) => row(essential, values)) },
  ];
  if (advanced.length > 0) {
    // The name first, so each row reads against the first sheet.
    const columns = ['name', ...advanced];
    sheets.push({ name: texts.sheets.advanced, headers: columns.map(header), rows: fixture.rows.map((values) => row(columns, values)) });
  }

  const notes = (columns: string[], sheet: string): XlsxCell[][] => columns.map((name) => [
    header(name),
    sheet,
    definition.columns[name]?.required ? texts.required : null,
    whatToWrite(columnOf(name), definition.columns[name], workspace, language),
  ]);
  const footer: XlsxCell[][] = [
    [advanced.length > 0 ? texts.firstSheetWithAdvanced : texts.firstSheet, null, null, null],
    [texts.references, null, null, null],
  ];
  if (key === 'budget-lines') footer.push([texts.budgetAmounts, null, null, null]);
  sheets.push({
    name: texts.sheets.notes,
    headers: texts.notesHeaders,
    rows: [...notes(essential, texts.sheets.examples), ...notes(advanced, texts.sheets.advanced)],
    footer,
  });

  return {
    filename: `${definition.fileNames[language]}-${texts.file}.xlsx`,
    contentType: XLSX_CONTENT_TYPE,
    content: writeXlsx({ language, sheets }),
  };
}
