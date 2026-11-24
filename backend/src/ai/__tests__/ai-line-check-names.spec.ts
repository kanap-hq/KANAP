import * as assert from 'node:assert/strict';
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';
import { BUDGET_LINE_CHECKS } from '../../spend/budget-line-checks';
import {
  BUDGET_LINE_CHECK_LABEL_KEYS,
  BUDGET_LINE_CHECK_LABELS,
  budgetLineCheckKeyName,
  budgetLineCheckName,
  budgetLineCheckNames,
} from '../query/ai-line-check-names';

/** The names Kad gives the budget line checks equal the "To check" column's (`ops.json`), for every check of the table. */

assert.deepEqual(Object.keys(BUDGET_LINE_CHECK_LABEL_KEYS).sort(), [...BUDGET_LINE_CHECKS].sort(), 'one name per check of the table');
assertLocaleLabels('ops', BUDGET_LINE_CHECK_LABEL_KEYS, BUDGET_LINE_CHECK_LABELS);

assert.equal(budgetLineCheckName('quantity_price', 'fr'), 'Quantité et prix', 'one check in the person\'s language');
assert.equal(budgetLineCheckName('coa_mismatch', null),
  'en: Account not in the company\'s chart; fr: Compte hors du plan de la société; de: Konto nicht im Kontenplan des Unternehmens; es: Cuenta fuera del plan de la empresa',
  'no language: the four names');
assert.deepEqual(budgetLineCheckNames(['quantity_price', 'coa_mismatch'], 'de'), ['Menge und Preis', 'Konto nicht im Kontenplan des Unternehmens'], 'a row: each name, in order');
assert.equal(budgetLineCheckNames(null, 'en'), null, 'a row that fails none: null');
assert.equal(budgetLineCheckNames([], 'en'), null, 'an empty list: null');
assert.equal(budgetLineCheckKeyName('quantity_price, coa_mismatch', 'es'), 'Cantidad y precio, Cuenta fuera del plan de la empresa', 'a group key: the names joined');
assert.equal(budgetLineCheckKeyName('quantity_price, coa_mismatch', null),
  'en: Quantity and price, Account not in the company\'s chart; fr: Quantité et prix, Compte hors du plan de la société; '
  + 'de: Menge und Preis, Konto nicht im Kontenplan des Unternehmens; es: Cantidad y precio, Cuenta fuera del plan de la empresa',
  'a group key without a language: per language');
assert.equal(budgetLineCheckKeyName(null, 'fr'), null, 'the lines that fail none: no name');

console.log('ai-line-check-names.spec: ok');
