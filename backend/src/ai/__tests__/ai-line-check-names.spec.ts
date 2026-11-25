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
import { AiCodeNamer, withCodeNames, withFilterCodes } from '../ai-code-names';

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

// Through the names of every code (`ai-code-names.ts`, #1815): a filter takes a check's name, the
// filter values and the groups name the checks, and a line's detail names the "To check" state.
const fr = new AiCodeNamer('fr');
const declaredChecks = () => ({ values: ['quantity_price', 'coa_mismatch', null] });
assert.deepEqual(withFilterCodes('budget_lines', { to_check: ['Quantité et prix', 'Account not in the company\'s chart'] }, fr, declaredChecks).filters,
  { to_check: ['quantity_price', 'coa_mismatch'] }, 'a filter on to_check takes the names, in the person\'s language or another');
assert.deepEqual((withCodeNames('get_filter_values', { entity_type: 'budget_lines' }, { values: { to_check: ['quantity_price', 'coa_mismatch', null] } }, fr) as any).names,
  { to_check: { quantity_price: 'Quantité et prix', coa_mismatch: 'Compte hors du plan de la société' } }, 'the filter values: each check named');
const groups = (withCodeNames('aggregate_entities', { entity_type: 'budget_lines', group_by: 'to_check' }, {
  groups: [{ key: 'quantity_price, coa_mismatch' }, { key: 'quantity_price', key_name: 'en: Quantity and price; fr: Quantité et prix' }, { key: null }],
}, fr) as any).groups;
assert.deepEqual(groups.map((group: any) => group.key_name ?? null),
  ['Quantité et prix, Compte hors du plan de la société', 'en: Quantity and price; fr: Quantité et prix', null],
  'a group: the checks named; a name the executor gave is kept; the lines that fail none: no name');
const detail = (withCodeNames('get_entity_detail', { entity_type: 'budget_lines' }, {
  entity: { type: 'budget_lines', id: 'line-1', ref: 'BL-1', label: 'Line', status: 'enabled', summary: null, updated_at: null, metadata: {} },
  data: { quantity_price_entry: { status: 'to_check' }, account_chart: { status: 'conforms' } },
}, fr) as any).data;
assert.deepEqual([detail.quantity_price_entry.status_name, detail.account_chart.status_name], ['À vérifier', undefined],
  'a line\'s detail: "To check" named as the column, the other states said by their explanation');

console.log('ai-line-check-names.spec: ok');
