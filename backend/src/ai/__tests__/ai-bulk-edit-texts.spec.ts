import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { BUDGET_LINE_BULK_REFUSALS } from '../../spend/budget-line-bulk-edit';
import {
  APPLICATION_BULK_FIELD_LABELS,
  APPLICATION_FILTER_LABELS,
  APPLICATION_YES_NO_WORDS,
  BUDGET_LINE_BULK_FIELD_LABELS,
  BUDGET_LINE_FILTER_LABELS,
  BUDGET_LINE_VALUE_WORDS,
  BULK_EDIT_EMPTIED,
  BULK_EDIT_REFUSAL_WORDS,
} from '../ai-bulk-edit-texts';
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
  console.log('ai-bulk-edit-texts.spec: ok');
}

run();
