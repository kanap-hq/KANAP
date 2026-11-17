import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from '../../common/__tests__/backend-root';
import { AiChatController } from '../ai-chat.controller';
import { AiChatOrchestratorService } from '../ai-chat-orchestrator.service';
import { AiConversationsController } from '../ai-conversations.controller';
import { PrepareImportMappingAiMutationOperation } from '../mutation/operations/prepare-import-mapping.ai-mutation-operation';
import { IMPORT_LOAD_REFUSALS, importRefusalText } from '../ai-write-texts';
import { AI_IMPORT_TARGETS, importColumnTitle } from '../import/ai-import-targets';
import { BY_EDITOR } from '../import/ai-import-runner.service';

/**
 * The texts of Kad's import card (lot Q4 of 26.11.8). No cell of the file reaches the model
 * (`ai-import-mapping.spec.ts`), so the card says each refusal itself: every code an import, the
 * budget file or the attached spreadsheet refuses with has its sentence in the four languages of
 * the interface (`frontend/src/locales/<lang>/errors.json`, which the card and the import dialogs
 * translate). The model names lines and columns as the person sees them, never a code; and the card
 * and the model follow the language of the screen when the person's profile sets none.
 *
 * It reads files outside its own folder: `backendPath()`, never `__dirname`.
 */

const LANGUAGES = ['en', 'fr', 'de', 'es'] as const;
const CODE = /['"]((?:CSV|BUDGET_FILE|AI_IMPORT|AI_TABLE|XLSX)_[A-Z0-9_]+)['"]/g;
/** Quoted names of the family that are no refusal of a file the person sees. */
const NOT_A_REFUSAL: Record<string, string> = {
  CSV_QUOTE_NOT_CLOSED: 'an error code of the CSV parser, which the reader turns into its own refusal',
};

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

/** Every refusal code of a file the backend writes as a literal, with a file that names it. */
function refusalCodes(): Map<string, string> {
  const codes = new Map<string, string>();
  for (const file of sourceFiles(backendPath('src'))) {
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(CODE)) {
      if (NOT_A_REFUSAL[match[1]]) continue;
      if (!codes.has(match[1])) codes.set(match[1], path.relative(backendPath(), file));
    }
  }
  return codes;
}

function phrasesInEveryLanguage() {
  const codes = refusalCodes();
  // The scan itself: the budget file alone has 30 codes, the imports about a hundred more.
  assert.ok(codes.size > 120, `refusal codes found: ${codes.size}`);
  assert.ok(codes.has('BUDGET_FILE_DIMENSION_VALUE_TOO_LONG') && codes.has('CSV_VALUE_CANNOT_BE_CLEARED') && codes.has('XLSX_INVALID'));
  // The name rule of the imports (lot I3 of 26.11.9): a name that may designate several records, a stored value kept.
  assert.ok(codes.has('CSV_NAME_AMBIGUOUS_AMONG') && codes.has('CSV_REFERENCE_NOT_FOUND_KEPT'));
  const missing: string[] = [];
  for (const language of LANGUAGES) {
    const phrases = JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', language, 'errors.json'), 'utf8')) as Record<string, unknown>;
    const phrase = (key: string) => typeof phrases[key] === 'string' && (phrases[key] as string).trim() !== '';
    for (const [code, file] of codes) {
      // A sentence with a count has its plural forms (`_one`, `_other`).
      if (!phrase(code) && !phrase(`${code}_other`)) missing.push(`${language}: ${code} (${file})`);
    }
  }
  assert.deepEqual(missing, [], 'every refusal code has its sentence in errors.json, in the four languages');
  console.log(`  ${codes.size} refusal codes, each with its sentence in the four languages: OK`);
}

function instructionsNameLinesAndColumnsNeverCodes() {
  const operation = new PrepareImportMappingAiMutationOperation({} as any);
  const hint = operation.writePreview.prompt_hint;
  const texts = `${operation.description}\n${hint}`;
  // The card says each refusal in the person's language: the model never writes its code.
  assert.doesNotMatch(texts, /columns and codes/);
  assert.match(hint, /never write a code/);
  assert.match(hint, /by its title/);
  // Lines are those of the person's file, header counted, as the summary and the check number them.
  assert.match(texts, /line of the file/);
  const assumptions = (operation.inputSchema.shape.assumptions as any).description as string;
  assert.match(assumptions, /line of the file/);
  console.log('  the model names lines and columns as the person sees them, never a code: OK');
}

/**
 * Lot I3 of 26.11.9, second pass: for a column that names a record, Kad's `values` propose an existing
 * record's name only, never a case or accent variant (the check matches those itself), and Kad never
 * announces a match the card does not show.
 */
function instructionsProposeExistingRecordsOnly() {
  const operation = new PrepareImportMappingAiMutationOperation({} as any);
  const values = (operation.inputSchema.shape.columns as any).element.shape.values.description as string;
  const hint = operation.writePreview.prompt_hint;
  for (const text of [values, hint]) {
    assert.match(text, /names a record/);
    assert.match(text, /existing record/);
    assert.match(text, /search/);
    assert.match(text, /case or accents?/);
  }
  assert.match(hint, /never announce a match the card does not show/i);
  assert.doesNotMatch(hint, /are copied as written/, 'a name of a record is no longer copied as the model writes it');
  console.log('  the model proposes existing records only, and announces no match the card does not show: OK');
}

/**
 * Lot I3 of 26.11.9, correctifs K (recette by Kad, gap 2): with a "Vendor" column mapped to the publisher,
 * Kad wrote that the column fills no supplier while the card linked six by the publisher (T-I3k). The
 * hint the model reads with the tool says it, in one sentence.
 */
function instructionsPublisherLinksTheSupplier() {
  const hint = new PrepareImportMappingAiMutationOperation({} as any).writePreview.prompt_hint;
  assert.ok(hint.includes('An application row with a publisher (`editor`) and no supplier is linked to the existing supplier '
    + 'the publisher names (`on_approval` says so): never say the supplier stays empty.'), 'the publisher links the supplier');
  // Correctifs L: the sentence of the approval names such a match with the card's words, in the four languages.
  for (const language of LANGUAGES) {
    const ops = JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', language, 'ops.json'), 'utf8'));
    assert.equal(BY_EDITOR[language], ops.operations.budgetFile.matching.byEditor, `${language}: the card's words for a publisher's match`);
  }
  console.log('  the model reads that a publisher links the supplier it names, with the card\'s words: OK');
}

/**
 * Lot I4 of 26.11.9, correctifs 10 (browser pass 5): Kad put a column holding only `-` in `left_aside`
 * by itself, so the card cleared nothing; and its assumptions said a row created a supplier the check
 * updated. `left_aside` is only for a column the person's message asks to leave out, and the model
 * says nothing of a creation, an update or a record's content before the check does.
 */
function instructionsLeaveAsideOnlyOnRequest() {
  const operation = new PrepareImportMappingAiMutationOperation({} as any);
  const hint = operation.writePreview.prompt_hint;
  const field = (operation.inputSchema.shape.left_aside as any).description as string;
  for (const text of [hint, field, operation.inputSummary.left_aside]) {
    assert.match(text, /message asks to leave out/);
  }
  for (const text of [hint, field]) {
    assert.match(text, /holds only `-`/);
    assert.match(text, /empty column/);
  }
  assert.match(hint, /stays read and the card announces it/);
  assert.match(hint, /In `note` and `assumptions`, never say that a row creates or updates a record, nor what a record already holds/);
  console.log('  left_aside only on the person\'s request; no creation or update announced before the check: OK');
}

async function screenLanguageWhenTheProfileHasNone() {
  const req = { tenant: { id: 'tenant-1' }, user: { sub: 'user-1' }, headers: { 'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8' } };
  const chat = new AiChatController({} as any, {} as any, {} as any, {} as any);
  assert.equal((chat as any).buildContext(req).screenLanguage, 'fr');
  const conversations = new AiConversationsController({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  assert.equal((conversations as any).buildContext(req).screenLanguage, 'fr');
  assert.equal((chat as any).buildContext({ ...req, headers: {} }).screenLanguage, null);

  // The prompt tells the model the profile's language, else the screen's.
  const orchestrator = Object.create(AiChatOrchestratorService.prototype) as AiChatOrchestratorService;
  const managerWith = (locale: string | null) => ({
    query: async (sql: string) => (sql.includes('FROM users u') ? [{ email: 'yann@example.test', first_name: 'Yann', last_name: null, locale }] : []),
  });
  const userContext = (locale: string | null, screenLanguage: string | null) => (orchestrator as any).loadCurrentUserPromptContext({
    tenantId: 'tenant-1', userId: 'user-1', screenLanguage, manager: managerWith(locale),
  });
  assert.equal((await userContext(null, 'fr')).screenLanguage, 'fr');
  assert.equal((await userContext('de', 'fr')).screenLanguage, 'de');
  assert.equal((await userContext(null, null)).screenLanguage, null);
  console.log('  without a profile language, the screen language settles the card and the prompt: OK');
}

/** The refusals of a load the backend says itself after an approval (lot I2 of 26.11.9): the card's words. */
function loadRefusalsAreTheCardsWords() {
  for (const language of LANGUAGES) {
    const phrases = JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', language, 'errors.json'), 'utf8')) as Record<string, unknown>;
    for (const [code, texts] of Object.entries(IMPORT_LOAD_REFUSALS)) {
      assert.equal(texts[language], phrases[code], `${language}: ${code}`);
    }
  }
  console.log(`  ${Object.keys(IMPORT_LOAD_REFUSALS).length} refusals of a load, the card's words in the four languages: OK`);
}

/**
 * The load of an applications import refuses a row whose situation changed since the check (lot I3 of
 * 26.11.9, T-I3l): the failed card's summary says why, and names no column (correctifs I).
 */
function applicationLoadRefusalsSaid() {
  for (const code of ['CSV_LOOKALIKE_CHANGED', 'CSV_LOOKALIKE_GONE', 'CSV_LOOKALIKE_NAME_FOUND']) {
    assert.ok(IMPORT_LOAD_REFUSALS[code], `${code}: said after the approval`);
  }
  const text = importRefusalText(
    'fr',
    { report: { kind: 'rows', errors: [{ row: 2, code: 'CSV_LOOKALIKE_CHANGED', params: { ref: 'APP-52' } }] } },
    new Map([['name', 'Nom']]),
  );
  assert.equal(text, 'Ligne 2 : APP-52 a changé depuis la vérification.');
  console.log('  refusals of an applications load, said after the approval: OK');
}

/**
 * The card names the columns of a task or an incident as the import screen does (lot I3 of 26.11.9,
 * correctifs G): its title is the screen's label (`csv.fields.<import>.<column>` in `common.json`),
 * in the four languages.
 */
async function taskAndIncidentColumnsAsTheImportScreenNamesThem() {
  const gaps: string[] = [];
  let compared = 0;
  for (const language of LANGUAGES) {
    const common = JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', language, 'common.json'), 'utf8'));
    for (const key of ['tasks', 'incidents'] as const) {
      const screen = (common.csv?.fields?.[key] ?? {}) as Record<string, string>;
      // Their columns come from the import's settings alone: no database read.
      for (const spec of await AI_IMPORT_TARGETS[key].columns({} as any)) {
        compared += 1;
        const card = importColumnTitle(spec, language);
        if (card !== screen[spec.column]) gaps.push(`${language} ${key}.${spec.column}: card "${card}", screen "${screen[spec.column]}"`);
      }
    }
  }
  assert.ok(compared > 100, `columns compared: ${compared}`);
  assert.deepEqual(gaps, [], 'the card names the columns of tasks and incidents as the import screen does');
  console.log(`  ${compared} column titles of tasks and incidents, as the import screen names them: OK`);
}

async function main() {
  phrasesInEveryLanguage();
  loadRefusalsAreTheCardsWords();
  applicationLoadRefusalsSaid();
  await taskAndIncidentColumnsAsTheImportScreenNamesThem();
  instructionsNameLinesAndColumnsNeverCodes();
  instructionsProposeExistingRecordsOnly();
  instructionsPublisherLinksTheSupplier();
  instructionsLeaveAsideOnlyOnRequest();
  await screenLanguageWhenTheProfileHasNone();
  console.log('ai-import-card-texts.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
