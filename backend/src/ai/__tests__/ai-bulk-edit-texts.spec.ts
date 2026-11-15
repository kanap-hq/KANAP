import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../common/__tests__/backend-root';
import { BUDGET_LINE_BULK_REFUSALS } from '../../spend/budget-line-bulk-edit';
import {
  BUDGET_LINE_BULK_FIELD_LABELS,
  BUDGET_LINE_FILTER_LABELS,
  BUDGET_LINE_VALUE_WORDS,
  BULK_EDIT_EMPTIED,
  BULK_EDIT_REFUSAL_WORDS,
} from '../ai-bulk-edit-texts';
import { BUDGET_LINE_BULK_FILTER_FIELDS } from '../mutation/operations/bulk-update-budget-lines.ai-mutation-operation';

/**
 * Kad's card of a change in bulk of budget lines (lot K1 of 26.11.9) says the filter, the field and
 * the refusals with the words of the budget lines list and of its "Change the selection" dialog, in
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

function run() {
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
    for (const code of [...BUDGET_LINE_BULK_REFUSALS, 'other']) {
      assert.equal(BULK_EDIT_REFUSAL_WORDS[language][code], at(common, `bulkEdit.refusals.${code}`), `${language}: refusal ${code}`);
    }
  }
  console.log('ai-bulk-edit-texts.spec: ok');
}

run();
