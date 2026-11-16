import * as assert from 'node:assert/strict';
import { BulkUpdateApplicationsAiMutationOperation } from '../mutation/operations/bulk-update-applications.ai-mutation-operation';
import { BulkUpdateBudgetLinesAiMutationOperation } from '../mutation/operations/bulk-update-budget-lines.ai-mutation-operation';

/**
 * Kad's changes in bulk (lot K1 of 26.11.9) use only the criteria the person named: the tool's
 * description and its hint say so, and that a request on every line or every application with no
 * other criterion is answered by a question, with no card. On dev, "set every line to build" had
 * given a card of 88 lines through a filter Kad added itself (run or build = run).
 */
function testTheModelInventsNoFilter() {
  const operations = [
    { operation: new BulkUpdateBudgetLinesAiMutationOperation(null as any, null as any, null as any, null as any), rows: 'lines' },
    { operation: new BulkUpdateApplicationsAiMutationOperation(null as any, null as any, null as any, null as any), rows: 'applications' },
  ];
  for (const { operation, rows } of operations) {
    for (const [where, text] of [['description', operation.description], ['hint', operation.writePreview.prompt_hint]] as const) {
      assert.match(text, /Use only the criteria the person named: never add a filter they did not name\./, `${operation.toolName} ${where}: only the named criteria`);
      assert.ok(
        text.includes(`A request on all the ${rows}, with no other criterion, gets a question asking for one, and no card.`),
        `${operation.toolName} ${where}: all the ${rows} without a criterion is a question`,
      );
    }
  }
  console.log('  the bulk edit tools use only the criteria the person named: OK');
}

/**
 * A field the tool does not take is said, not hidden (lot K1 of 26.11.9): on dev, "set the 4 analytics
 * applications to infrastructure" then "do it in bulk" gave four cards of one application each, then a
 * plan of them, without a word that the category is not changed in bulk.
 */
function testAnotherFieldIsSaidNotChangedInBulk() {
  const operations = [
    {
      operation: new BulkUpdateBudgetLinesAiMutationOperation(null as any, null as any, null as any, null as any),
      row: 'line',
      fields: 'cost center, account, paying company, supplier, IT owner, business owner, run or build, the value of a dimension',
    },
    {
      operation: new BulkUpdateApplicationsAiMutationOperation(null as any, null as any, null as any, null as any),
      row: 'application',
      fields: 'business owners, IT owners, category, lifecycle, business criticality, cyber criticality',
    },
  ];
  for (const { operation, row, fields } of operations) {
    for (const [where, text] of [['description', operation.description], ['hint', operation.writePreview.prompt_hint]] as const) {
      assert.ok(
        text.includes(`Any other field is not changed in bulk: say so in the answer, with the fields that are (${fields}), then prepare one card per ${row} as usual.`),
        `${operation.toolName} ${where}: another field is said not changed in bulk, with the fields that are`,
      );
      assert.ok(
        text.includes(`Never present cards of one ${row} each, nor a prepare_mutation_plan of them, as a change in bulk.`),
        `${operation.toolName} ${where}: cards of one ${row} each are never a change in bulk`,
      );
    }
    // The tool replaces cards of one row each for its own fields only.
    assert.match(operation.writePreview.prompt_hint, new RegExp(`For one of these fields on more than a few ${row}s, use this tool`), `${operation.toolName}: its own fields only`);
  }
  console.log('  the bulk edit tools say when a field is not changed in bulk: OK');
}

testTheModelInventsNoFilter();
testAnotherFieldIsSaidNotChangedInBulk();
