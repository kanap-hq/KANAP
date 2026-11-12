import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from '../../common/__tests__/backend-root';
import { AiChatController } from '../ai-chat.controller';
import { AiChatOrchestratorService } from '../ai-chat-orchestrator.service';
import { AiConversationsController } from '../ai-conversations.controller';
import { PrepareImportMappingAiMutationOperation } from '../mutation/operations/prepare-import-mapping.ai-mutation-operation';

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
  assert.ok(codes.has('BUDGET_FILE_DIMENSION_VALUE_TOO_LONG') && codes.has('AI_IMPORT_CLEARS_COLUMNS') && codes.has('XLSX_INVALID'));
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

async function main() {
  phrasesInEveryLanguage();
  instructionsNameLinesAndColumnsNeverCodes();
  await screenLanguageWhenTheProfileHasNone();
  console.log('ai-import-card-texts.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
