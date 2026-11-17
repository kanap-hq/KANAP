import * as assert from 'node:assert/strict';
import { rowsBilan, rowsCard } from '../import/ai-import-runner.service';

// Lot I3 of 26.11.9, fifth pass: the card of a row import sends the whole list of the matches the
// person undid with the next one, as the budget file's card sends its choices. Its report gives that
// list back (`undone`), and says a match is undoable only in a column its choice route takes.

const match = (column: string, value: string, target: string) => ({
  column, name: null, value, target, ref: null, origin: 'server' as const, reason: 'accents' as const, lines: [2], count: 1, undoable: true,
});

function testTheCardGivesBackTheUndoneMatches() {
  const run = rowsBilan({
    ok: true, total: 1, inserted: 1, updated: 0, errors: [], warnings: [],
    matches: [match('supplier_name', 'Societe Generale', 'Société Générale'), match('location_code', 'Lyon', 'Lyon Nord')],
    matchesTotal: 2,
  } as any, true, [2]);
  const card = rowsCard('contracts', run, [
    { kind: 'unmatch', column: 'company_name', value: 'Fromage SA' },
    { kind: 'create_suppliers', value: true },
  ]);
  assert.ok(card.report.kind === 'rows');
  assert.deepEqual(card.report.undone, [{ column: 'company_name', value: 'Fromage SA' }], 'the matches undone, and nothing else');
  assert.deepEqual(card.report.matches?.map((entry) => [entry.column, entry.undoable]), [
    ['supplier_name', true],
    ['location_code', false],
  ], 'a column the choice route of the import does not take cannot be undone from the card');
  const none = rowsCard('contracts', run, []);
  assert.ok(none.report.kind === 'rows');
  assert.equal(none.report.undone, undefined, 'no list when nothing was undone');
  console.log('  a row import\'s card gives back the matches undone and marks those its route takes: OK');
}

testTheCardGivesBackTheUndoneMatches();
