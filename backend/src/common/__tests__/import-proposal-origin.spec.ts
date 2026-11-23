import * as assert from 'node:assert/strict';
import { proposedRecord, takeProposal, type ImportMatchState } from '../name-matching';

// Lot I6b of 26.12.1: the two shared functions that check Kad's proposal for a value of a file
// (`proposedRecord`, and `takeProposal` for the imports that keep the first record of a name). Kad
// proposing the record the value finds alone (exactly, case or accents aside) is no proposal: nothing
// is taken, listed or refused, and the value follows its import's own rule. Kad proposing another
// record, or a record the value does not find alone, is Kad's match; a proposal that names nothing,
// or a list the person does not read, is refused; a match the person undid takes no proposal. The
// imports' real paths are covered by their own specs (`ai-import-run.integration.spec.ts`, the
// technology links, the servers, the incidents, the budget file).

type Row = { name: string; ref: string };

const ROWS: Row[] = [
  { name: 'Société Générale', ref: 'R-1' },
  { name: 'Cegid', ref: 'R-2' },
];

function propose(value: string, proposal: string, options: { caseBlind?: boolean; take?: boolean; reads?: boolean; undone?: boolean } = {}) {
  const state: ImportMatchState = { matches: new Map(), refused: new Map() };
  const args = {
    proposals: { column: { [value]: proposal } }, unmatched: options.undone ? [{ column: 'column', value }] : [], column: 'column', value, line: 2,
    rows: ROWS, reads: options.reads ?? true, caseBlind: options.caseBlind ?? false, ref: (row: Row) => row.ref,
  };
  const taken = options.take ? takeProposal(state, args) : proposedRecord(state, args);
  const row = taken && 'row' in taken ? taken.row : (taken as Row | undefined);
  return {
    taken: row?.name ?? null,
    matches: [...state.matches.values()].map((match) => [match.value, match.target, match.origin, match.reason]),
    refused: [...state.refused.values()].map((entry) => [entry.value, entry.target, entry.reason]),
  };
}

const NOTHING = { taken: null, matches: [], refused: [] };

const CASES: Array<{ label: string; value: string; proposal: string; options?: Parameters<typeof propose>[2]; expected: ReturnType<typeof propose> }> = [
  { label: 'the record the value finds exactly', value: 'Société Générale', proposal: 'Société Générale', expected: NOTHING },
  { label: 'the record the value finds case aside', value: 'société générale', proposal: 'Société Générale', expected: NOTHING },
  { label: 'the record the value finds accents aside', value: 'Societe Generale', proposal: 'Société Générale', expected: NOTHING },
  { label: 'the same, named by Kad in another case', value: 'Societe Generale', proposal: 'SOCIÉTÉ GÉNÉRALE', expected: NOTHING },
  {
    label: 'another record than the value finds', value: 'Societe Generale', proposal: 'Cegid',
    expected: { taken: 'Cegid', matches: [['Societe Generale', 'Cegid', 'model', 'model']], refused: [] },
  },
  {
    label: 'a record the value does not find alone', value: 'SG', proposal: 'Société Générale',
    expected: { taken: 'Société Générale', matches: [['SG', 'Société Générale', 'model', 'model']], refused: [] },
  },
  {
    label: 'a record that does not exist', value: 'SG', proposal: 'Banque Absente',
    expected: { taken: null, matches: [], refused: [['SG', 'Banque Absente', 'missing']] },
  },
  {
    label: 'a list the person does not read', value: 'Societe Generale', proposal: 'Société Générale', options: { reads: false },
    expected: { taken: null, matches: [], refused: [['Societe Generale', 'Société Générale', 'missing']] },
  },
  { label: 'a match the person undid', value: 'SG', proposal: 'Société Générale', options: { undone: true }, expected: NOTHING },
];

function testEveryCase() {
  for (const variant of [{}, { caseBlind: true, take: true }]) {
    for (const entry of CASES) {
      const label = `${entry.label}${variant.take ? ' (takeProposal)' : ''}`;
      assert.deepEqual(propose(entry.value, entry.proposal, { ...entry.options, ...variant }), entry.expected, label);
    }
  }
  console.log(`  ${CASES.length} cases, through both functions: OK`);
}

testEveryCase();
console.log('import-proposal-origin.spec: ok');
