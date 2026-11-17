import * as assert from 'node:assert/strict';
import { rowsApprovalFacts, rowsBilan } from '../import/ai-import-runner.service';

// Lot I3 of 26.11.9, correctifs L: on dev, Kad imported `applications-vendor.xlsx` and wrote that the
// "Vendor" column filled no supplier, while the card listed six suppliers matched by the publisher
// (T-I3k). The model repeats the sentence of the approval faithfully: it now names the check's
// matches as the card does (column title, value, reference and name), the first ones, and says that
// a publisher's match links the application to that supplier.

type Origin = 'server' | 'model' | 'editor';
const match = (value: string, ref: string, target: string, origin: Origin, lines: number[] = [2]) => ({
  column: 'supplier_name', name: null, value, target, ref, origin,
  reason: origin === 'editor' ? 'editor' as const : 'accents' as const, lines, count: lines.length, undoable: true,
});

const check = (matches: ReturnType<typeof match>[], matchesTotal = matches.length) => rowsBilan({
  ok: true, total: 12, inserted: 9, updated: 2, unchanged: 0, errors: [], warnings: [],
  ...(matches.length > 0 ? { matches, matchesTotal } : {}),
} as any, true, [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);

function testThePublishersMatchesAreSaid() {
  const run = check([match('Microsoft', 'SUP-1', 'Microsoft', 'editor', [2, 5]), match('SAP', 'SUP-2', 'SAP', 'editor', [4])]);
  assert.equal(rowsApprovalFacts(run, { titles: new Map([['supplier_name', 'Supplier']]), language: 'en' }),
    'On approval: 9 records created, 2 updated, 0 unchanged; 2 values of the file matched to existing records: '
    + 'Supplier (publisher): Microsoft → SUP-1 Microsoft, Supplier (publisher): SAP → SUP-2 SAP; '
    + 'each application whose publisher names an existing supplier is linked to that supplier.');
  assert.equal(rowsApprovalFacts(run, { titles: new Map([['supplier_name', 'Fournisseur']]), language: 'fr' }),
    'On approval: 9 records created, 2 updated, 0 unchanged; 2 values of the file matched to existing records: '
    + 'Fournisseur (éditeur): Microsoft → SUP-1 Microsoft, Fournisseur (éditeur): SAP → SUP-2 SAP; '
    + 'each application whose publisher names an existing supplier is linked to that supplier.', 'the card\'s title, in the person\'s language');
  console.log('  the approval names the publisher\'s matches as the card does, and the link to the supplier: OK');
}

function testTheFirstMatchesThenHowManyMore() {
  const names = ['Microsoft', 'Salesforce', 'SAP', 'Cegid', 'SERVICENOW', 'hubspot'];
  const run = check(names.map((name, index) => match(name, `SUP-${index + 1}`, name, index === 0 ? 'server' : 'editor')), 8);
  const facts = rowsApprovalFacts(run, { titles: new Map([['supplier_name', 'Supplier']]), language: 'en' });
  assert.equal(facts, 'On approval: 9 records created, 2 updated, 0 unchanged; 8 values of the file matched to existing records: '
    + 'Supplier: Microsoft → SUP-1 Microsoft, Supplier (publisher): Salesforce → SUP-2 Salesforce, Supplier (publisher): SAP → SUP-3 SAP, '
    + 'and 5 more; each application whose publisher names an existing supplier is linked to that supplier.');
  const server = rowsApprovalFacts(check([match('Societe Generale', 'SUP-4', 'Société Générale', 'server')]), {
    titles: new Map([['supplier_name', 'Supplier']]), language: 'en',
  });
  assert.equal(server, 'On approval: 9 records created, 2 updated, 0 unchanged; 1 values of the file matched to existing records: '
    + 'Supplier: Societe Generale → SUP-4 Société Générale.', 'no publisher, no link to say');
  console.log('  the first matches, then how many more; the link only for a publisher\'s match: OK');
}

function testACheckWithoutMatchesKeepsItsSentence() {
  assert.equal(rowsApprovalFacts(check([]), { titles: new Map(), language: 'fr' }), 'On approval: 9 records created, 2 updated, 0 unchanged.');
  assert.equal(rowsApprovalFacts(check([])), 'On approval: 9 records created, 2 updated, 0 unchanged.');
  console.log('  a check without matches keeps its sentence: OK');
}

// Lot I4 of 26.11.9 (D21): the stored values the rows clear with `-` are said, as the card counts them.
function testTheClearedValuesAreSaid() {
  const clearing = (cleared: number) => rowsBilan({ ok: true, total: 2, inserted: 0, updated: 2, unchanged: 0, cleared, errors: [], warnings: [] } as any, true, [2, 3]);
  assert.equal(clearing(3).cleared, 3, 'the card\'s count');
  assert.equal(rowsApprovalFacts(clearing(3)), 'On approval: 0 records created, 2 updated, 0 unchanged; 3 stored values cleared (cells holding "-").');
  assert.equal(rowsApprovalFacts(clearing(1)), 'On approval: 0 records created, 2 updated, 0 unchanged; 1 stored value cleared (cells holding "-").');
  assert.equal(rowsApprovalFacts(clearing(0)), 'On approval: 0 records created, 2 updated, 0 unchanged.');
  console.log('  the values cleared with `-`, only when there are some: OK');
}

testThePublishersMatchesAreSaid();
testTheFirstMatchesThenHowManyMore();
testACheckWithoutMatchesKeepsItsSentence();
testTheClearedValuesAreSaid();
