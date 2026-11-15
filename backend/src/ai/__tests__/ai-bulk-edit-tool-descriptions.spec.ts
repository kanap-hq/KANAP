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

testTheModelInventsNoFilter();
