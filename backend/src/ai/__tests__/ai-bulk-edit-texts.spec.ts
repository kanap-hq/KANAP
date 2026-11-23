import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { BUDGET_LINE_BULK_REFUSALS } from '../../spend/budget-line-bulk-edit';
import { BULK_LIST_CHANGED_MESSAGE, bulkTooMany } from '../../common/bulk-edit/bulk-edit';
import { isFixedPreviewError, previewErrorText } from '../ai-write-texts';
import {
  APPLICATION_BULK_FIELD_LABELS,
  APPLICATION_FILTER_LABELS,
  APPLICATION_YES_NO_WORDS,
  BUDGET_LINE_BULK_FIELD_LABELS,
  BUDGET_LINE_FILTER_LABELS,
  BUDGET_LINE_VALUE_WORDS,
  BULK_EDIT_ALL_LEFT_OUT,
  BULK_EDIT_EMPTIED,
  BULK_EDIT_HIDDEN,
  bulkEditListGrewText,
  BULK_EDIT_REFUSAL_WORDS,
  bulkEditCardText,
  bulkEditTooLongNote,
} from '../ai-bulk-edit-texts';
import {
  AI_BULK_EDIT_LIST_MAX,
  bulkEditPreviewDto,
  bulkListApplied,
  bulkListLeftOut,
  effectiveBulkSelection,
  parseBulkExclusions,
} from '../mutation/ai-bulk-edit';
import { BUDGET_LINE_BULK_FILTER_FIELDS } from '../mutation/operations/bulk-update-budget-lines.ai-mutation-operation';
import { APPLICATION_BULK_FILTER_FIELDS } from '../mutation/operations/bulk-update-applications.ai-mutation-operation';
import { APPLICATION_BULK_REFUSALS } from '../../applications/application-bulk-edit';

/**
 * Kad's cards of a change in bulk (lot K1 of 26.11.9) say the filter, the field and the refusals
 * with the words of the budget lines and applications lists and of their "Change the selection" dialogs, in
 * the four languages of the interface: each server word equals its key in the frontend locales.
 *
 * It reads files outside its own folder (`frontend/src/locales`): `backendPath()`, and a rule of
 * `.github/scripts/ci-changes.sh`.
 */

const LANGUAGES = ['en', 'fr', 'de', 'es'] as const;

function locale(language: string, namespace: string): any {
  return JSON.parse(fs.readFileSync(backendPath('..', 'frontend', 'src', 'locales', language, `${namespace}.json`), 'utf8'));
}

function at(tree: any, key: string): unknown {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), tree);
}

/** The filter fields and the list's column keys (`BudgetListPage.tsx`). */
const FILTER_KEYS: Record<string, string> = {
  nature: 'budget.type',
  status: 'opex.metadata.status',
  product_name: 'opex.columns.productName',
  supplier: 'opex.columns.supplier',
  paying_company: 'opex.columns.payingCompany',
  account: 'opex.columns.account',
  cost_center: 'opex.columns.costCenter',
  contract: 'opex.columns.contract',
  owner_it: 'opex.columns.itOwner',
  owner_business: 'opex.columns.businessOwner',
  run_build: 'opex.columns.runBuild',
};

/** The fields of the dialog and their keys (`budgetLineBulkFields.tsx`). */
const FIELD_KEYS: Record<string, string> = {
  cost_center: 'opex.fields.costCenter',
  account: 'opex.fields.account',
  paying_company: 'opex.fields.payingCompany',
  supplier: 'opex.fields.supplier',
  owner_it: 'opex.metadata.itOwner',
  owner_business: 'opex.metadata.businessOwner',
  run_build: 'opex.fields.runBuild',
};

/** The applications filter fields and the list's column keys (`ApplicationsPage.tsx`, `it` namespace). */
const APPLICATION_FILTER_KEYS: Record<string, string> = {
  lifecycle: 'common.lifecycle',
  criticality: 'classification.business_criticality',
  cyber_criticality: 'classification.cyber_criticality',
  data_class: 'pages.applications.columns.dataClass',
  recovery_wave: 'classification.recovery_wave',
  category: 'pages.applications.columns.category',
  supplier: 'pages.applications.columns.supplier',
  editor: 'pages.applications.columns.publisher',
  it_owner: 'pages.applications.columns.itOwners',
  business_owner: 'pages.applications.columns.businessOwners',
  external_facing: 'pages.applications.columns.externalFacing',
  contains_pii: 'pages.interfaces.columns.containsPii',
};

/** The fields of the applications dialog and their keys (`applicationBulkFields.tsx`). */
const APPLICATION_FIELD_KEYS: Record<string, string> = {
  owners_business: 'pages.applications.columns.businessOwners',
  owners_it: 'pages.applications.columns.itOwners',
  lifecycle: 'common.lifecycle',
  criticality: 'classification.business_criticality',
};

function run() {
  assert.deepEqual(Object.keys(APPLICATION_FILTER_KEYS).sort(), [...APPLICATION_BULK_FILTER_FIELDS].sort(), 'one column label per applications filter field');
  // Every filter field but the default dimension (named by the tenant) has its column label.
  assert.deepEqual(
    Object.keys(FILTER_KEYS).sort(),
    BUDGET_LINE_BULK_FILTER_FIELDS.filter((field) => field !== 'analytics_category').sort(),
    'one column label per filter field',
  );
  for (const language of LANGUAGES) {
    const ops = locale(language, 'ops');
    const common = locale(language, 'common');
    for (const [field, key] of Object.entries(FILTER_KEYS)) {
      assert.equal(BUDGET_LINE_FILTER_LABELS[language][field], at(ops, key), `${language}: filter ${field} = ops:${key}`);
    }
    for (const [field, key] of Object.entries(FIELD_KEYS)) {
      assert.equal(BUDGET_LINE_BULK_FIELD_LABELS[language][field], at(ops, key), `${language}: field ${field} = ops:${key}`);
    }
    for (const value of ['enabled', 'disabled']) {
      assert.equal(BUDGET_LINE_VALUE_WORDS[language].status[value], at(ops, `opex.status.${value}`), `${language}: status ${value}`);
    }
    for (const value of ['run', 'build']) {
      assert.equal(BUDGET_LINE_VALUE_WORDS[language].run_build[value], at(ops, `opex.runBuild.${value}`), `${language}: ${value}`);
    }
    assert.equal(BULK_EDIT_EMPTIED[language], at(common, 'bulkEdit.emptied'), `${language}: emptied`);
    const it = locale(language, 'it');
    for (const [field, key] of Object.entries(APPLICATION_FILTER_KEYS)) {
      assert.equal(APPLICATION_FILTER_LABELS[language][field], at(it, key), `${language}: applications filter ${field} = it:${key}`);
    }
    for (const [field, key] of Object.entries(APPLICATION_FIELD_KEYS)) {
      assert.equal(APPLICATION_BULK_FIELD_LABELS[language][field], at(it, key), `${language}: applications field ${field} = it:${key}`);
    }
    assert.equal(APPLICATION_YES_NO_WORDS[language].true, at(it, 'enums.yesNo.yes'), `${language}: yes`);
    assert.equal(APPLICATION_YES_NO_WORDS[language].false, at(it, 'enums.yesNo.no'), `${language}: no`);
    for (const code of [...BUDGET_LINE_BULK_REFUSALS, ...APPLICATION_BULK_REFUSALS, 'other']) {
      assert.equal(BULK_EDIT_REFUSAL_WORDS[language][code], at(common, `bulkEdit.refusals.${code}`), `${language}: refusal ${code}`);
    }
  }
  testApprovalRefusals();
  console.log('ai-bulk-edit-texts.spec: ok');
}

/**
 * The refusals of a change in bulk that reach the approval are written by the backend itself: the
 * card says them in the person's language, as a sentence (not a technical detail).
 */
function testApprovalRefusals() {
  const cases: Array<[string, Record<'fr' | 'de' | 'es', string>]> = [
    [bulkTooMany(5002).message, {
      fr: 'Ces filtres atteignent 5\u202f002 lignes, plus de 5\u202f000 à la fois : demandez à Kad une nouvelle carte avec des filtres plus étroits.',
      de: 'Diese Filter erfassen 5.002 Zeilen, mehr als 5.000 auf einmal: Bitten Sie Kad um eine neue Karte mit engeren Filtern.',
      es: 'Estos filtros alcanzan 5002 filas, más de 5000 a la vez: pida a Kad una nueva tarjeta con filtros más acotados.',
    }],
    [bulkTooMany().message, {
      fr: 'Au plus 5\u202f000 lignes à la fois : demandez à Kad une nouvelle carte avec des filtres plus étroits.',
      de: 'Höchstens 5.000 Zeilen auf einmal: Bitten Sie Kad um eine neue Karte mit engeren Filtern.',
      es: 'Como máximo 5000 filas a la vez: pida a Kad una nueva tarjeta con filtros más acotados.',
    }],
    [BULK_LIST_CHANGED_MESSAGE, {
      fr: 'La liste a changé depuis le comptage : demandez une nouvelle carte à Kad.',
      de: 'Die Liste hat sich seit der Zählung geändert: Bitten Sie Kad um eine neue Karte.',
      es: 'La lista ha cambiado desde el recuento: pida a Kad una nueva tarjeta.',
    }],
  ];
  for (const [message, words] of cases) {
    assert.equal(previewErrorText('en', message), message);
    for (const language of ['fr', 'de', 'es'] as const) assert.equal(previewErrorText(language, message), words[language], `${language}: ${message}`);
    assert.equal(isFixedPreviewError(message), true, `a sentence of the backend, not a technical detail: ${message}`);
  }
}

/**
 * The card that lists its records (lot K2e of 26.12.1): the counts say the records left out, the
 * list replaces the first five, each value before in the person's language (empty and hidden
 * worded), the left out records listed unticked, the selection the write runs on less them.
 */
function testTheCardListsItsRecords() {
  const card = {
    family: 'budget_lines' as const,
    selection: { kind: 'rows' as const, refs: ['BL-1', 'BL-2', 'BL-3'] },
    field: 'Cost center',
    value: 'IT-01 · Informatique',
    rows: 2,
    changes: 2,
    unchanged: 0,
    refused: {},
    examples: [{ ref: 'BL-1', title: 'Line 1' }, { ref: 'BL-2', title: 'Line 2' }],
    excluded: 1,
    listed: true,
  };
  const counts = {
    en: 'Chosen lines: BL-1, BL-2, BL-3\n\nCost center → IT-01 · Informatique\n\n2 lines to change, 1 left out',
    fr: 'Lignes choisies : BL-1, BL-2, BL-3\n\nCentre de coûts → IT-01 · Informatique\n\n2 lignes à modifier, 1 écartée',
    de: 'Ausgewählte Zeilen: BL-1, BL-2, BL-3\n\nKostenstelle → IT-01 · Informatique\n\n2 Zeilen zu ändern, 1 ausgeschlossen',
    es: 'Líneas elegidas: BL-1, BL-2, BL-3\n\nCentro de coste → IT-01 · Informatique\n\n2 líneas por modificar, 1 excluida',
  };
  for (const language of LANGUAGES) {
    assert.equal(bulkEditCardText({ ...card, field: BUDGET_LINE_BULK_FIELD_LABELS[language].cost_center }, language), counts[language], `the card in ${language}`);
  }
  // Without the list (more than 200 records), the first five are named as before.
  assert.match(bulkEditCardText({ ...card, listed: false, excluded: 0 }, 'en'), /2 lines to change\n\n- BL-1 Line 1\n- BL-2 Line 2$/);
  assert.match(bulkEditCardText({ ...card, family: 'applications', excluded: 2 }, 'fr'), /2 applications à modifier, 2 écartées$/);
  // Approved, the card no longer says what it would change: its summary says what changed (browser pass of lot K2e).
  assert.equal(bulkEditCardText({ ...card, field: BUDGET_LINE_BULK_FIELD_LABELS.fr.cost_center, done: true }, 'fr'), 'Lignes choisies : BL-1, BL-2, BL-3\n\nCentre de coûts → IT-01 · Informatique');
  assert.equal(bulkEditCardText({ ...card, listed: false, done: true }, 'en').includes('to change'), false);
  assert.match(bulkEditTooLongNote('applications', 250, AI_BULK_EDIT_LIST_MAX), /^This card changes 250 applications: more than 200, so it counts them without listing them.*offer to narrow the selection/);

  // The list for the screen: each value before in words, empty and hidden worded, the kept counted.
  const list = {
    rows: [
      { id: 'a', ref: 'BL-1', title: 'Line 1', before: 'cc-fin', kept: true },
      { id: 'b', ref: 'BL-2', title: 'Line 2', before: null, kept: true },
      { id: 'c', ref: 'BL-3', title: 'Line 3', before: null, hidden: true as const, kept: false },
    ],
    words: { 'cc-fin': { en: 'FIN-02 · Finance', fr: 'FIN-02 · Finance', de: 'FIN-02 · Finance', es: 'FIN-02 · Finance' } },
  };
  for (const language of LANGUAGES) {
    const dto = bulkEditPreviewDto(list, 'Field', null, language);
    assert.deepEqual(dto.rows.map((row) => [row.before, row.before_state, row.kept]), [
      ['FIN-02 · Finance', 'value', true], [BULK_EDIT_EMPTIED[language], 'empty', true], [BULK_EDIT_HIDDEN[language], 'hidden', false],
    ]);
    assert.deepEqual([dto.after, dto.after_empty, dto.kept, dto.excluded], [BULK_EDIT_EMPTIED[language], true, 2, 1]);
    assert.ok(BULK_EDIT_ALL_LEFT_OUT[language].length > 20, `the refusal of a card with every record left out, in ${language}`);
  }
  assert.equal(new Set(LANGUAGES.map((language) => BULK_EDIT_HIDDEN[language])).size, 4);
  // A recount past the bound is refused in the person's language (review of lot K2e).
  assert.equal(bulkEditListGrewText('fr', 200), 'La sélection a dépassé 200 fiches depuis le comptage : demandez une nouvelle carte.');
  assert.equal(new Set(LANGUAGES.map((language) => bulkEditListGrewText(language, 200))).size, 4);
  // Once approved, each kept record marked changed or not; a left out one never.
  assert.deepEqual(bulkListApplied(list, ['A', 'c']).rows.map((row) => row.changed), [true, false, false]);
  // A recount, read again whole: the records left out unticked, the others kept.
  const next = bulkListLeftOut(list, ['a']);
  assert.deepEqual(next.rows.map((row) => [row.ref, row.kept]), [['BL-1', false], ['BL-2', true], ['BL-3', true]]);
  assert.deepEqual(next.words, list.words);

  // The selection the count and the write run on: the filter's exclude_ids, or the chosen ids less those left out.
  const [x, y] = ['0b0e5c3c-0000-4000-8000-000000000001', '0b0e5c3c-0000-4000-8000-000000000002'];
  assert.deepEqual(effectiveBulkSelection({ selection: { all: true, filters: { q: 1 } }, excluded: [x] }), { all: true, filters: { q: 1 }, exclude_ids: [x] });
  assert.deepEqual(effectiveBulkSelection({ selection: { ids: [x, y] }, excluded: [x] }), { ids: [y] });
  assert.deepEqual(effectiveBulkSelection({ selection: { ids: [x, y] } }), { ids: [x, y] });
  assert.equal(effectiveBulkSelection({ selection: { ids: [x] }, excluded: [x] }), null, 'every chosen record left out: nothing to count');
  // The route's list: ids, lower case, without repeats, sorted; at most 200.
  assert.deepEqual(parseBulkExclusions([y.toUpperCase(), x, y]), [x, y]);
  assert.throws(() => parseBulkExclusions('x'), /must be a list/);
  assert.throws(() => parseBulkExclusions(['APP-3']), /must be record ids/);
  assert.throws(() => parseBulkExclusions(Array.from({ length: 201 }, (_, i) => `0b0e5c3c-0000-4000-8000-${String(i).padStart(12, '0')}`)), /At most 200/);
  console.log('  the card lists its records, left out ones counted and kept unticked: OK');
}

testTheCardListsItsRecords();
run();
