import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { budgetBilan, rowsApprovalFacts, rowsBilan } from '../import/ai-import-runner.service';
import { PrepareImportMappingAiMutationOperation } from '../mutation/operations/prepare-import-mapping.ai-mutation-operation';

/**
 * Kad names the choices of a row that looks like an existing line with the card's words (fixes of
 * lot I2 of 26.11.9): on dev it wrote « ignorer (choix par défaut) », a word the card never shows
 * (it reads « Écarter »), from the code of the choice, and said the person had to choose for every
 * row before the card could be approved, which is false. Lot I3 of 26.11.9 (pass 3a): the same words
 * for the applications that look like a stored one, « Mettre à jour APP-n ».
 */

const CARD_CHOICES = {
  en: { ignored: 'Leave out', created: 'Create anyway', updated: 'Update BL-n' },
  fr: { ignored: 'Écarter', created: 'Créer quand même', updated: 'Mettre à jour BL-n' },
  de: { ignored: 'Auslassen', created: 'Trotzdem anlegen', updated: 'BL-n aktualisieren' },
  es: { ignored: 'Descartar', created: 'Crear de todos modos', updated: 'Actualizar BL-n' },
} as const;

const lines = [2, 3, 4];
const target = (n: number) => ({ item: n, ref: `BL-${n}`, name: `Line ${n}`, state: '0123456789abcdef' });
const answer = (outcome: 'ignored' | 'updated', changes: { created: number; updated: number; unchanged: number }) => ({
  ok: true,
  changes,
  creates: { supplierCount: 0, dimensionValueCount: 0 },
  lookalikes: {
    lines: [{ line: 2, nature: 'opex' as const, name: 'Datadog Monitoring', target: target(9), reason: 'amounts' as const, outcome, updatable: true }],
    targets: { 2: { item: 9, state: '0123456789abcdef' } },
    count: 1,
    ignored: outcome === 'ignored' ? 1 : 0,
    created: 0,
    updated: outcome === 'updated' ? 1 : 0,
  },
  matching: {
    matches: [], refusedProposals: [], candidates: [], totals: { matches: 0, refusedProposals: 0, candidates: 0 },
    choices: [], createSuppliers: { allowed: true, value: true },
  },
});

function testTheModelReadsTheCardsWordsInEachLanguage() {
  for (const language of ['en', 'fr', 'de', 'es'] as const) {
    const bilan = budgetBilan(answer('ignored', { created: 2, updated: 0, unchanged: 0 }), true, lines, undefined, language);
    assert.deepEqual(bilan.similar_lines?.card_choices, CARD_CHOICES[language], `${language}: the card's words, by outcome`);
  }
  // Without a language, the English words.
  assert.deepEqual(budgetBilan(answer('ignored', { created: 2, updated: 0, unchanged: 0 }), true, lines).similar_lines?.card_choices, CARD_CHOICES.en);
  console.log('  the model reads the card\'s three choices in the person\'s language: OK');
}

function testTheModelNamesNoCodeAndAsksNoChoiceForEveryRow() {
  const operation = new PrepareImportMappingAiMutationOperation(null as any);
  const note = budgetBilan(answer('ignored', { created: 2, updated: 0, unchanged: 0 }), true, lines, undefined, 'fr').similar_lines?.note ?? '';
  for (const [where, text] of [['hint', operation.writePreview.prompt_hint], ['note', note]] as const) {
    assert.ok(
      text.includes('Name these choices only by the card\'s words (`similar_lines.card_choices`, BL-n or APP-n standing for the row\'s `looks_like`), never by a code (ignore, create, update, ignored, created, updated).'),
      `${where}: the card's words, never a code`,
    );
    assert.ok(
      text.includes('Never say the person must choose for each row: a row left out is simply not imported, and the card can be approved as soon as it has something to import.'),
      `${where}: no choice is owed for every row`,
    );
  }
  console.log('  the model names no code and asks no choice for every row: OK');
}

function testNothingToImportIsSaidInOneSentence() {
  const nothing = budgetBilan(answer('ignored', { created: 0, updated: 0, unchanged: 0 }), true, lines, undefined, 'fr');
  assert.equal(nothing.nothing_to_import, true);
  assert.match(nothing.on_approval ?? '', /^Nothing to import: /);
  assert.ok(
    (nothing.on_approval ?? '').endsWith('Say in one sentence that nothing is imported until a row left out is created anyway or updates the line it looks like, '
      + 'with the card\'s words (`similar_lines.card_choices`).'),
    'all left out: one sentence, with the card\'s words',
  );
  assert.doesNotMatch(nothing.on_approval ?? '', /unless the person chooses/, 'no choice owed for every row');
  // An update that changes nothing and no row left out: the card cannot be approved, said as before.
  const unchanged = budgetBilan(answer('updated', { created: 0, updated: 0, unchanged: 1 }), true, lines, undefined, 'fr');
  assert.match(unchanged.on_approval ?? '', /The card cannot be approved\.$/);
  console.log('  nothing to import, all left out: said in one sentence with the card\'s words: OK');
}

const APPLICATION_CHOICES = {
  en: { ignored: 'Leave out', created: 'Create anyway', updated: 'Update APP-n' },
  fr: { ignored: 'Écarter', created: 'Créer quand même', updated: 'Mettre à jour APP-n' },
  de: { ignored: 'Auslassen', created: 'Trotzdem anlegen', updated: 'APP-n aktualisieren' },
  es: { ignored: 'Descartar', created: 'Crear de todos modos', updated: 'Actualizar APP-n' },
} as const;

const ID = '00000000-0000-4000-8000-0000000000aa';
/** An applications check: the built file's line 3 is the person's line 4; the row that updates the application is on line 2. */
const appReport = (inserted: number) => ({
  ok: true, total: 2, inserted, updated: 0, unchanged: 0, skipped: 1, errors: [],
  warnings: [{ row: 3, message: 'Looks like APP-4, already updated by line 2. Left out.', code: 'CSV_LOOKALIKE_SAME_RECORD', params: { ref: 'APP-4', other: 2 } }],
  lookalikes: {
    lines: [{ line: 3, name: 'Comptabilite', target: { id: ID, ref: 'APP-4', name: 'Comptabilité', state: '0123456789abcdef' }, reason: 'name_accents' as const, outcome: 'ignored' as const, updatable: true }],
    targets: { 3: { id: ID, state: '0123456789abcdef' } },
    count: 1, ignored: 1, created: 0, updated: 0,
    choices: [{ kind: 'lookalikes' as const, action: 'ignore' as const, targets: { 3: { id: ID, state: '0123456789abcdef' } } }],
  },
});

function testApplicationsOnThePersonsLinesWithTheCardsWords() {
  const personLines = [2, 4];
  for (const language of ['en', 'fr', 'de', 'es'] as const) {
    const bilan = rowsBilan(appReport(1), true, personLines, language);
    assert.deepEqual(bilan.similar_lines?.card_choices, APPLICATION_CHOICES[language], `${language}: the card's words for an application`);
  }
  const bilan = rowsBilan(appReport(1), true, personLines, 'fr');
  assert.deepEqual(bilan.similar_lines?.first, [{ file_line: 4, looks_like: 'APP-4', reason: 'name_accents', outcome: 'ignored' }]);
  assert.ok((bilan.similar_lines?.note ?? '').includes('Never say the person must choose for each row'));
  const look = bilan.report.kind === 'rows' ? bilan.report.lookalikes : undefined;
  assert.deepEqual([look?.lines[0].line, Object.keys(look?.targets ?? {}), look?.choices], [
    4, ['4'], [{ kind: 'lookalikes', action: 'ignore', targets: { 4: { id: ID, state: '0123456789abcdef' } } }],
  ], 'the lookalikes, their targets and the choices followed on the person\'s lines');
  assert.deepEqual(bilan.report.kind === 'rows' ? bilan.report.warnings[0].params : null, { ref: 'APP-4', other: 2 }, 'the other row on the person\'s line');
  assert.equal(rowsApprovalFacts(bilan), 'On approval: 1 records created, 0 updated, 0 unchanged; 1 rows of the file look like existing applications: '
    + '1 left out, 0 created anyway, 0 updating the application they look like.');
  const nothing = rowsBilan(appReport(0), true, personLines, 'fr');
  assert.equal(nothing.nothing_to_import, true);
  assert.ok(rowsApprovalFacts(nothing).endsWith('Say in one sentence that nothing is imported until a row left out is created anyway or updates '
    + 'the application it looks like, with the card\'s words (`similar_lines.card_choices`).'));
  // A load reports no lookalike to the model.
  assert.equal(rowsBilan(appReport(1), false, personLines, 'fr').similar_lines, undefined);
  console.log('  the applications: on the person\'s lines, the card\'s words, one sentence when nothing is imported: OK');
}

testTheModelReadsTheCardsWordsInEachLanguage();
testApplicationsOnThePersonsLinesWithTheCardsWords();
testTheModelNamesNoCodeAndAsksNoChoiceForEveryRow();
testNothingToImportIsSaidInOneSentence();
