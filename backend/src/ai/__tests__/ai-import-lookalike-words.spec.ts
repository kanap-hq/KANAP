import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { budgetBilan } from '../import/ai-import-runner.service';
import { PrepareImportMappingAiMutationOperation } from '../mutation/operations/prepare-import-mapping.ai-mutation-operation';

/**
 * Kad names the choices of a row that looks like an existing line with the card's words (fixes of
 * lot I2 of 26.11.9): on dev it wrote « ignorer (choix par défaut) », a word the card never shows
 * (it reads « Écarter »), from the code of the choice, and said the person had to choose for every
 * row before the card could be approved, which is false.
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
      text.includes('Name these choices only by the card\'s words (`similar_lines.card_choices`, BL-n being the row\'s `looks_like`), never by a code (ignore, create, update, ignored, created, updated).'),
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

testTheModelReadsTheCardsWordsInEachLanguage();
testTheModelNamesNoCodeAndAsksNoChoiceForEveryRow();
testNothingToImportIsSaidInOneSentence();
