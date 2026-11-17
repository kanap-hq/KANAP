import * as assert from 'node:assert/strict';
import { findRecordByName, proposedRecord, type ImportMatchState } from '../name-matching';

// Lot I3 of 26.11.9, fixes after the adversarial review (finding 3). An import that refuses a name
// of several records exactly or case aside (`caseBlind: false`: the links of the technologies, the
// contracts, the cost centers) refuses it at every step: two records of the very same name are two
// records, accents aside and for Kad's proposal too, named by their references. An import that
// keeps the first record of a name (`caseBlind: true`) keeps it exactly and case aside, as before;
// accents aside, every record counts there too (T-I3a, fixes E): several refuse the row, named.

type Row = { id: string; name: string; ref: string };
const rows: Row[] = [
  { id: 'a', name: 'Serveur-É', ref: 'AST-1' },
  { id: 'b', name: 'Serveur-É', ref: 'AST-2' },
  { id: 'c', name: 'Autre', ref: 'AST-3' },
];
const label = (row: Row) => row.ref;

function testSameNameRefusedWhenNotCaseBlind() {
  for (const cell of ['Serveur-É', 'serveur-é', 'Serveur-E']) {
    const found = findRecordByName(rows, cell, { beyondCase: true, caseBlind: false, label });
    assert.equal(found.kind, 'many', cell);
    assert.deepEqual(found.kind === 'many' && found.names, ['AST-1', 'AST-2'], cell);
  }
  const accents = findRecordByName(rows, 'Serveur-E', { beyondCase: true, caseBlind: false, label });
  assert.equal(accents.kind === 'many' && accents.level, 'accents');
  const exact = findRecordByName(rows, 'Serveur-É', { beyondCase: false, caseBlind: false, label });
  assert.equal(exact.kind === 'many' && exact.level, 'case', 'exactly: the refusal of today');
  const one = findRecordByName(rows, 'autre', { beyondCase: true, caseBlind: false, label });
  assert.deepEqual(one.kind === 'one' && [one.row.id, one.how], ['c', 'case']);
}

function testFirstRecordKeptWhenCaseBlind() {
  const found = findRecordByName(rows, 'Serveur-É', { beyondCase: true, caseBlind: true, label });
  assert.deepEqual(found.kind === 'one' && [found.row.id, found.how], ['a', 'exact'], 'the first record, as before');
  const folded = findRecordByName(rows, 'serveur-é', { beyondCase: true, caseBlind: true, label });
  assert.deepEqual(folded.kind === 'one' && [folded.row.id, folded.how], ['a', 'case'], 'case aside: the first record, as before');
}

function testSameNameRefusedAccentsAsideWhenCaseBlind() {
  const found = findRecordByName(rows, 'Serveur-E', { beyondCase: true, caseBlind: true, label });
  assert.equal(found.kind, 'many', 'accents aside, two records of one name are two');
  assert.deepEqual(found.kind === 'many' && [found.level, found.names], ['accents', ['AST-1', 'AST-2']]);
  const named = findRecordByName(rows, 'Serveur-E', { beyondCase: true, caseBlind: true });
  assert.deepEqual(named.kind === 'many' && named.names, ['Serveur-É', 'Serveur-É'], 'named by their names without a label');
  const one = findRecordByName(rows, 'Àutre', { beyondCase: true, caseBlind: true, label });
  assert.deepEqual(one.kind === 'one' && [one.row.id, one.how], ['c', 'accents']);
  assert.equal(findRecordByName(rows, 'Serveur-E', { beyondCase: false, caseBlind: true, label }).kind, 'none', 'no accent step');
}

function testProposalOfSeveralRecords() {
  const state: ImportMatchState = { matches: new Map(), refused: new Map() };
  const args = { proposals: { asset_name: { web: 'Serveur-É' } }, unmatched: [], column: 'asset_name', value: 'web', line: 2, rows, reads: true, ref: label };
  const many = proposedRecord(state, { ...args, caseBlind: false });
  assert.deepEqual(many, { kind: 'many', names: ['AST-1', 'AST-2'] });
  assert.equal(state.matches.size, 0, 'not taken');
  assert.equal(state.refused.size, 0, 'the row is refused instead, naming the records');
  const one = proposedRecord(state, { ...args, caseBlind: true });
  assert.deepEqual(one?.kind === 'one' && one.row.id, 'a');
  assert.equal(proposedRecord(state, { ...args, value: 'Serveur-É', caseBlind: false }), undefined, 'no proposal: the value itself');
}

function run() {
  testSameNameRefusedWhenNotCaseBlind();
  testFirstRecordKeptWhenCaseBlind();
  testSameNameRefusedAccentsAsideWhenCaseBlind();
  testProposalOfSeveralRecords();
  console.log('name-matching.spec: ok');
}

run();
