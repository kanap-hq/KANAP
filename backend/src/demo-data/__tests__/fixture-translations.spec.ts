import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { backendPath } from '../../common/__tests__/backend-root';

// The French, German and Spanish sets of the sample data (fixtures/fromage-co/translations,
// generated into fr/, de/, es/ by tools/translate-dataset.mjs). No database:
// - the generator translates the listed columns only, cell by cell, and leaves every other byte;
//   Markdown is translated block by block, code blocks kept; a text without translation is
//   reported;
// - each committed set is what the generator writes from the English files today (the check CI
//   runs: an English file changed without regeneration fails here), with no text left untranslated;
// - each set has the rows of the English files, the same values in every column it does not
//   translate, and as many distinct names as English in every translated column.

const FIXTURES = backendPath('fixtures', 'fromage-co');

type Translator = { t: (text: string) => string; used: Set<string>; missing: Set<string> };
type Column = string | { column: string; markdown: true };
type TranslateModule = {
  DATASET_LANGUAGES: string[];
  resolveDatasetLanguage: (raw: unknown) => string;
  createTranslator: (memory: Record<string, string>) => Translator;
  translateCsv: (content: string, columns: Column[], t: (text: string) => string) => string;
  translateMarkdown: (text: string, t: (text: string) => string) => string;
  runnerTexts: (source: string) => string[];
  buildLanguageSet: (language: string, opts?: { root?: string; memory?: Record<string, string> }) => {
    files: Map<string, string>;
    missing: Set<string>;
  };
};
type FieldsModule = { TRANSLATED_LANGUAGES: string[]; TRANSLATED_COLUMNS: Record<string, Column[]>; TRANSLATED_DOCS: string[] };
type GeneratorModule = {
  planLanguage: (language: string, root?: string) => {
    changed: string[];
    stale: string[];
    missing: string[];
    memoryChanged: boolean;
  };
  run: (argv: string[]) => number;
};

// The spec compiles to CommonJS. require() cannot load these ESM modules, so the import stays
// inside a string and Node loads it.
const importer = new Function('specifier', 'return import(specifier)') as <T>(specifier: string) => Promise<T>;
const load = <T>(...parts: string[]) => importer<T>(pathToFileURL(path.join(FIXTURES, ...parts)).href);

/** Rows of a `;` CSV as arrays of cells (quotes and doubled quotes read). */
function csvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === '"') {
      if (quoted && content[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (!quoted && ch === ';') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && content[i + 1] === '\n') i += 1;
      row.push(cell);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((value) => value !== '')) rows.push(row);
  return rows;
}

async function testGenerator(mod: TranslateModule) {
  const memory = {
    'Cheese caves': 'Caves à fromage',
    'Line "B"; humid': 'Ligne « B » ; humide',
    '## Impact': '## Impact',
    'Readings were lost.\nNobody saw it.': 'Les relevés ont été perdus.\nPersonne ne l’a vu.',
  };
  const translator = mod.createTranslator(memory);
  const source = [
    'code;name;notes;review;amount',
    'CAVE-1;Cheese caves;"Line ""B""; humid";"## Impact\n\nReadings were lost.\nNobody saw it.\n\n```\nkeep me\n```";1200',
    'CAVE-2;Cheese caves;;;',
    'CAVE-3;Unknown name;Cheese caves;;7',
    '',
  ].join('\n');
  const out = mod.translateCsv(source, ['name', 'notes', { column: 'review', markdown: true }], translator.t);
  assert.deepEqual(out.split('\n'), [
    'code;name;notes;review;amount',
    'CAVE-1;Caves à fromage;"Ligne « B » ; humide";"## Impact\n\nLes relevés ont été perdus.\nPersonne ne l’a vu.\n\n```\nkeep me\n```";1200',
    'CAVE-2;Caves à fromage;;;',
    'CAVE-3;Unknown name;Caves à fromage;;7',
    '',
  ].join('\n').split('\n'), 'listed columns translated, codes, amounts, empty cells and code blocks kept, quotes where needed');
  assert.deepEqual([...translator.missing], ['Unknown name'], 'a text without translation is reported and kept');
  assert.throws(() => mod.translateCsv(source, ['title'], translator.t), /Column 'title' is not in the file/);

  assert.deepEqual(mod.runnerTexts(`t('Paris Data Center'); t("Don't"); t(name); x.t('No'); notes: t('A \\'quoted\\' word')`), [
    'Paris Data Center', "Don't", "A 'quoted' word",
  ], 'the literal texts of t() calls');
  assert.equal(mod.resolveDatasetLanguage('fr-FR'), 'fr');
  assert.equal(mod.resolveDatasetLanguage('it'), 'en');
  assert.deepEqual(mod.DATASET_LANGUAGES, ['en', 'fr', 'de', 'es']);

  // The generator on a copy of the data set: a changed English cell fails the check until the
  // memory has its translation and the set is written again.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fixture-translations-'));
  try {
    fs.cpSync(FIXTURES, tmp, { recursive: true });
    const generator = await load<GeneratorModule>('tools', 'translate-dataset.mjs');
    assert.deepEqual(generator.planLanguage('fr', tmp).changed, [], 'the copy is up to date');
    const file = path.join(tmp, '07-suppliers.csv');
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('Enterprise Agreement — Microsoft 365', 'Enterprise agreement for Microsoft 365'));
    const stale = generator.planLanguage('fr', tmp);
    assert.ok(stale.missing.some((text) => text.startsWith('Enterprise agreement for Microsoft 365')), 'the new text has no translation');
    const savedError = console.error;
    console.error = () => undefined;
    try {
      assert.equal(generator.run(['--check', '--root', tmp]), 1, 'the check fails');
    } finally {
      console.error = savedError;
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

async function testCommittedSetsAreFresh(fields: FieldsModule) {
  const generator = await load<GeneratorModule>('tools', 'translate-dataset.mjs');
  for (const language of fields.TRANSLATED_LANGUAGES) {
    const plan = generator.planLanguage(language);
    assert.deepEqual(plan.missing, [], `${language}: every text has a translation`);
    assert.deepEqual(plan.changed, [], `${language}: the set is up to date (run tools/translate-dataset.mjs)`);
    assert.deepEqual(plan.stale, [], `${language}: no file left from an older generation`);
    assert.equal(plan.memoryChanged, false, `${language}: the memory is sorted and holds no unused entry`);
  }
}

function testSetsKeepTheShape(fields: FieldsModule) {
  for (const language of fields.TRANSLATED_LANGUAGES) {
    for (const [name, columns] of Object.entries(fields.TRANSLATED_COLUMNS)) {
      const english = csvRows(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
      const translated = csvRows(fs.readFileSync(path.join(FIXTURES, language, name), 'utf8'));
      assert.equal(translated.length, english.length, `${language}/${name}: same rows`);
      const header = english[0];
      assert.deepEqual(translated[0], header, `${language}/${name}: same header`);
      const listed = new Set(columns.map((column) => (typeof column === 'string' ? column : column.column)));
      header.forEach((column, index) => {
        const before = english.slice(1).map((row) => row[index] ?? '');
        const after = translated.slice(1).map((row) => row[index] ?? '');
        if (!listed.has(column)) {
          assert.deepEqual(after, before, `${language}/${name}: ${column} is not translated`);
          return;
        }
        after.forEach((value, row) => assert.equal(value === '', before[row] === '', `${language}/${name}: ${column} row ${row + 1} keeps its emptiness`));
        assert.equal(new Set(after).size, new Set(before).size, `${language}/${name}: ${column} has as many distinct values as English`);
      });
    }
    for (const name of fields.TRANSLATED_DOCS) {
      const english = fs.readFileSync(path.join(FIXTURES, name), 'utf8');
      const translated = fs.readFileSync(path.join(FIXTURES, language, name), 'utf8');
      assert.equal(translated.split('\n').length, english.split('\n').length, `${language}/${name}: same lines`);
      assert.notEqual(translated, english, `${language}/${name}: translated`);
    }
  }
}

async function main() {
  const mod = await load<TranslateModule>('translations', 'translate.mjs');
  const fields = await load<FieldsModule>('translations', 'fields.mjs');
  await testGenerator(mod);
  await testCommittedSetsAreFresh(fields);
  testSetsKeepTheShape(fields);
  console.log('fixture-translations.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
