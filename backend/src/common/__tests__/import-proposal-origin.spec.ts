import * as assert from 'node:assert/strict';
import { findRecordByName, proposedRecord, takeProposal, type ImportMatchState } from '../name-matching';

// Lot I6b of 26.12.1: the server's own match comes first, for every import that reads its own list
// and checks Kad's proposals through `proposedRecord` (or `takeProposal`). Kad proposing the record
// the value finds alone (here accents aside) is no proposal: nothing is listed as Kad's, taken or
// refused, and the value follows its import's own rule, which finds that record (the server's match).
// Kad proposing another record, or a record the value does not find alone, stays Kad's. One entry per
// import and column that passes through it, with the arguments its call site gives.

type Row = { name: string; ref: string };

const ROWS: Row[] = [
  { name: 'Société Générale', ref: 'R-1' },
  { name: 'Cegid', ref: 'R-2' },
];

const FAMILIES: Array<{ family: string; column: string; caseBlind: boolean; take?: boolean }> = [
  { family: 'contacts', column: 'supplier_name', caseBlind: false },
  { family: 'cost_centers', column: 'company_name', caseBlind: false },
  { family: 'contracts', column: 'company_name', caseBlind: false },
  { family: 'contracts', column: 'supplier_name', caseBlind: false },
  { family: 'contracts', column: 'cost_center', caseBlind: false },
  { family: 'technology_asset_links', column: 'asset_name', caseBlind: false },
  { family: 'technology_application_links', column: 'application_name', caseBlind: false },
  { family: 'technology links', column: 'technology_name', caseBlind: false },
  { family: 'business_processes', column: 'parent_name', caseBlind: true, take: true },
  { family: 'tasks', column: 'phase_name', caseBlind: true, take: true },
];

/** What the call site gets back, and what the import lists. */
function propose(entry: (typeof FAMILIES)[number], value: string, proposal: string) {
  const state: ImportMatchState = { matches: new Map(), refused: new Map() };
  const args = {
    proposals: { [entry.column]: { [value]: proposal } }, unmatched: [], column: entry.column, value, line: 2,
    rows: ROWS, reads: true, caseBlind: entry.caseBlind, ref: (row: Row) => row.ref,
  };
  const taken = entry.take ? takeProposal(state, args) : proposedRecord(state, args);
  const row = taken && 'row' in taken ? taken.row : (taken as Row | undefined);
  return {
    taken: row?.name ?? null,
    matches: [...state.matches.values()].map((match) => [match.value, match.target, match.origin, match.reason]),
    refused: [...state.refused.values()].map((entry) => [entry.value, entry.target, entry.reason]),
    // The value's own rule at the call site: exactly, case aside, then accents aside for a person who reads the list.
    own: findRecordByName(ROWS, value, { beyondCase: true, caseBlind: entry.caseBlind }),
  };
}

function testEveryFamily() {
  for (const entry of FAMILIES) {
    const label = `${entry.family} ${entry.column}`;
    const same = propose(entry, 'Societe Generale', 'Société Générale');
    assert.deepEqual([same.taken, same.matches, same.refused], [null, [], []], `${label}: the server's record is no proposal of Kad's`);
    assert.ok(same.own.kind === 'one' && same.own.row.name === 'Société Générale' && same.own.how === 'accents', `${label}: the own rule finds it`);
    const other = propose(entry, 'Societe Generale', 'Cegid');
    assert.deepEqual([other.taken, other.matches], ['Cegid', [['Societe Generale', 'Cegid', 'model', 'model']]], `${label}: another record is Kad's`);
    const alone = propose(entry, 'SG', 'Société Générale');
    assert.deepEqual([alone.taken, alone.matches], ['Société Générale', [['SG', 'Société Générale', 'model', 'model']]], `${label}: nothing found alone, Kad's`);
  }
  console.log(`  ${FAMILIES.length} imports: Kad's proposal of the server's own record is the server's match: OK`);
}

testEveryFamily();
console.log('import-proposal-origin.spec: ok');
