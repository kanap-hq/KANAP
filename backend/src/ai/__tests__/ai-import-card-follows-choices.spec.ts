import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import type { AiImportRunDto } from '../ai.types';
import { TABLE_ATTACHMENT_KIND } from '../attachments/table-attachment';
import type { AiImportKey } from '../import/ai-import-access';
import { AI_IMPORT_MATCH_SOURCE_COLUMNS, AiImportMappingService } from '../import/ai-import-mapping.service';
import { AI_IMPORT_MATCHED_COLUMNS, AI_IMPORT_TARGETS, isImportMatchedColumn, type ImportCardChoice } from '../import/ai-import-targets';

// Lot I6a of 26.12.1: Kad's import card says the state of the moment. The note the model wrote for a
// column is its reason for the column's matches: once the person undoes one of them, the card shows no
// note on that column, and matched again the note is back (the mapping keeps it). The other columns
// keep theirs, and a choice that undoes no match (a row that looks like a record, the "Create missing
// suppliers" box) leaves every note. Driven by the table of the imports that match names
// (`AI_IMPORT_MATCHED_COLUMNS`) and the budget file: an import added to it enters this spec as it is.
// The file and the import's check are stubbed; the check gives back the choices it followed, as the
// row imports (`rowsCard`) and the budget file (`matching.choices`) do.

const FILE = '11111111-1111-4111-8111-111111111111';
const VALUE = 'Acme';

type Check = { key: string; choices: readonly ImportCardChoice[] };

function service(followed: (check: Check) => readonly ImportCardChoice[] = (check) => check.choices) {
  let csv = '';
  const attachments = {
    assertAndLoadAttachments: async (ids: string[]) => ids.map((id) => ({ id, kind: TABLE_ATTACHMENT_KIND, original_filename: 'file.csv' })),
    loadAttachmentBuffer: async (id: string) => ({ attachment: { id }, buffer: Buffer.from(csv, 'utf8') }),
  };
  const runner = {
    run: async (key: string, _file: Buffer, call: { dryRun: boolean; matching: { choices: readonly ImportCardChoice[] } }): Promise<AiImportRunDto> => {
      const choices = followed({ key, choices: call.matching.choices });
      const base = {
        ok: true, dry_run: call.dryRun, total: 1, inserted: 1, updated: 0, unchanged: 0, skipped: 0,
        error_count: 0, warning_count: 0, issues: [],
      };
      if (key === 'budget_lines') {
        return { ...base, report: { kind: 'budget_file', file: {} }, matching: { choices } } as unknown as AiImportRunDto;
      }
      const undone = choices.flatMap((choice) => (choice.kind === 'unmatch' ? [{ column: choice.column, value: choice.value }] : []));
      return { ...base, report: { kind: 'rows', errors: [], warnings: [], ...(undone.length > 0 ? { undone } : {}) } } as AiImportRunDto;
    },
  };
  const policy = { readableResources: async () => new Set<string>() };
  const mapping = new AiImportMappingService(attachments as any, { getSettings: async () => ({}) } as any, policy as any, runner as any);
  // The budget file's template reads the workspace's dimensions: one enabled dimension.
  const manager = {
    query: async (sql: string) => (/FROM analytics_axes/.test(sql)
      ? [{ id: 'axis-1', code: 'it_tower', name: 'IT tower', is_default: false, applies_to: null, required: false, open_values: false, status: 'enabled', disabled_at: null, sort_order: 1 }]
      : []),
  };
  const context = {
    tenantId: 'tenant-1', userId: 'user-1', isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const,
    conversationId: 'conv-1', manager: manager as any,
  };
  return { mapping, context, setFile: (text: string) => { csv = text; } };
}

/** The families whose card lists matches the person may undo: the budget file, then the table's imports. */
function families(): AiImportKey[] {
  return ['budget_lines', ...(Object.keys(AI_IMPORT_MATCHED_COLUMNS) as AiImportKey[])];
}

/**
 * A file of one row for the import `key`: one column of the file for each matched column of its
 * template, and one for a column it does not match, each with the model's note.
 */
async function cardOf(key: AiImportKey, s: ReturnType<typeof service>) {
  const { columns } = await s.mapping.templateColumns(s.context, AI_IMPORT_TARGETS[key], 'en');
  const matched = columns.filter((column) => isImportMatchedColumn(key, column.column)).map((column) => column.column);
  const plain = columns.find((column) => !isImportMatchedColumn(key, column.column) && column.kind === 'text')?.column;
  assert.ok(matched.length > 0, `${key}: the template holds a column the import matches`);
  assert.ok(plain, `${key}: the template holds a column the import does not match`);
  const mapped = [...matched, plain!];
  s.setFile([mapped.map((_, index) => `c${index + 1}`).join(','), mapped.map(() => VALUE).join(',')].join('\n'));
  const input = {
    attachment_id: FILE,
    entity_type: key,
    columns: mapped.map((column, index) => ({ column, source: index + 1, confidence: 'high' as const, note: `note of ${column}` })),
    assumptions: ['The amounts are in euros.'],
  };
  const notes = async (choices: ImportCardChoice[]) => {
    const { mapping } = await s.mapping.prepareMapping(s.context, { ...input, choices }, 'en');
    return Object.fromEntries(mapping.columns.map((column) => [column.column, column.note]));
  };
  return { matched, mapped, notes };
}

const everyNote = (mapped: string[]) => Object.fromEntries(mapped.map((column) => [column, `note of ${column}`]));

async function testUndoneMatchHidesTheColumnsNote() {
  const keys = families();
  assert.ok(keys.length >= 13, 'the budget file and the twelve imports that match names');
  for (const key of keys) {
    const s = service();
    const { matched, mapped, notes } = await cardOf(key, s);
    assert.deepEqual(await notes([]), everyNote(mapped), `${key}: the first card shows every note`);
    for (const column of matched) {
      // Undone: the column's note is gone; the other columns keep theirs.
      const undone = await notes([{ kind: 'unmatch', column, value: VALUE }]);
      assert.deepEqual(undone, { ...everyNote(mapped), [column]: null }, `${key}: ${column} undone`);
      // Matched again: the note is back.
      assert.deepEqual(await notes([]), everyNote(mapped), `${key}: ${column} matched again`);
    }
  }
  console.log(`  ${keys.length} imports: a match undone hides its column's note, matched again shows it: OK`);
}

/**
 * Passe 2 (browser pass C4a): a match listed under one column may take its value from another column of
 * the file (an application's supplier found by its publisher). Mapped without the column the match is
 * listed under, the column that made the match loses its note when it is undone; another value leaves it.
 * Driven by the table of those columns (`AI_IMPORT_MATCH_SOURCE_COLUMNS`).
 */
async function testUndoneMatchHidesTheNoteOfTheColumnThatMadeIt() {
  let cases = 0;
  for (const [key, byColumn] of Object.entries(AI_IMPORT_MATCH_SOURCE_COLUMNS) as Array<[AiImportKey, Record<string, readonly string[]>]>) {
    for (const [listed, sources] of Object.entries(byColumn)) {
      for (const source of sources) {
        const s = service();
        const { columns } = await s.mapping.templateColumns(s.context, AI_IMPORT_TARGETS[key], 'en');
        assert.ok(isImportMatchedColumn(key, listed), `${key}: ${listed} is a column the import matches`);
        assert.ok(columns.some((column) => column.column === source), `${key}: ${source} is a column of the template`);
        const plain = columns.find((column) => column.column !== source && column.column !== listed && column.kind === 'text')!.column;
        const mapped = [source, plain];
        s.setFile(['c1,c2', `${VALUE},Other`].join('\n'));
        const notes = async (choices: ImportCardChoice[]) => {
          const { mapping } = await s.mapping.prepareMapping(s.context, {
            attachment_id: FILE, entity_type: key, choices,
            columns: mapped.map((column, index) => ({ column, source: index + 1, confidence: 'high' as const, note: `note of ${column}` })),
          }, 'en');
          return Object.fromEntries(mapping.columns.map((column) => [column.column, column.note]));
        };
        assert.deepEqual(await notes([{ kind: 'unmatch', column: listed, value: VALUE.toUpperCase() }]), { ...everyNote(mapped), [source]: null }, `${key}: ${listed} undone from ${source}`);
        assert.deepEqual(await notes([{ kind: 'unmatch', column: listed, value: 'Not in the file' }]), everyNote(mapped), `${key}: another value of ${listed}`);
        assert.deepEqual(await notes([]), everyNote(mapped), `${key}: ${listed} matched again`);
        cases += 1;
      }
    }
  }
  assert.ok(AI_IMPORT_MATCH_SOURCE_COLUMNS.applications?.supplier_name?.includes('editor'), 'an application\'s supplier found by its publisher');
  console.log(`  ${cases} columns that make a match listed under another: the undone match hides their note: OK`);
}

async function testChoicesThatUndoNoMatchKeepTheNotes() {
  // An application row created anyway, the "Create missing suppliers" box unticked: every note stays.
  const apps = await cardOf('applications', service());
  assert.deepEqual(await apps.notes([{ kind: 'lookalike', line: 2, action: 'create' }]), everyNote(apps.mapped));
  const budget = await cardOf('budget_lines', service());
  assert.deepEqual(await budget.notes([{ kind: 'create_suppliers', value: false }]), everyNote(budget.mapped));
  console.log('  a choice that undoes no match leaves every note: OK');
}

async function testBudgetFileFollowsTheChoicesItKept() {
  // The budget file drops an undone match its file no longer makes: the column keeps its note.
  const s = service((check) => check.choices.filter((choice) => choice.kind !== 'unmatch'));
  const { matched, mapped, notes } = await cardOf('budget_lines', s);
  assert.deepEqual(await notes([{ kind: 'unmatch', column: matched[0], value: 'Not in the file' }]), everyNote(mapped));
  console.log('  a budget file\'s undone match the check no longer follows leaves the note: OK');
}

async function testTheModelsAssumptionsStayOnItsCard() {
  const s = service();
  const { mapped } = await cardOf('contacts', s);
  const { mapping } = await s.mapping.prepareMapping(s.context, {
    attachment_id: FILE, entity_type: 'contacts', assumptions: ['The amounts are in euros.'],
    columns: mapped.map((column, index) => ({ column, source: index + 1, confidence: 'high' as const })),
  }, 'en');
  assert.deepEqual(mapping.assumptions, ['The amounts are in euros.']);
  console.log('  the card the model prepares shows its assumptions: OK');
}

(async () => {
  await testUndoneMatchHidesTheColumnsNote();
  await testUndoneMatchHidesTheNoteOfTheColumnThatMadeIt();
  await testChoicesThatUndoNoMatchKeepTheNotes();
  await testBudgetFileFollowsTheChoicesItKept();
  await testTheModelsAssumptionsStayOnItsCard();
  console.log('ai-import-card-follows-choices.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
