import { describe, expect, it } from 'vitest';
import { markRecoveredToolFailures, repairedToolCallIds } from './PlaidActivity';

type Row = { kind: string; toolCall: { id: string; name: string; arguments?: Record<string, unknown> }; result: unknown; recovered?: boolean };
const tool = (id: string, name: string, result: unknown, args?: Record<string, unknown>): Row => ({
  kind: 'tool',
  toolCall: { id, name, arguments: args },
  result,
});

// The server names the failed calls a later call repaired (`repairs` on the successful tool result);
// the activity hides those failures and keeps every other one.
describe('markRecoveredToolFailures', () => {
  it('hides a failure the server says a later call repaired, whatever the arguments changed', () => {
    // The essay of 2026-10-27, question 6: the second create_document changed two arguments.
    const rows = [
      tool('tc-1', 'create_document', { error: 'No application found matching "APP-36".' }, { title: 'Recovery runbook', applications: 'APP-36', assets: 'AST-3' }),
      tool('tc-2', 'create_document', { preview_id: 'p-1' }, { title: 'Recovery runbook', applications: 'CheeseTrack', assets: 'srv-cheese-01' }),
    ];
    const repaired = repairedToolCallIds([
      { id: 'tc-1', name: 'create_document', result: rows[0].result },
      { id: 'tc-2', name: 'create_document', result: rows[1].result, repairs: ['tc-1'] },
    ]);
    const marked = markRecoveredToolFailures(rows, repaired);
    expect(marked.map((row) => row.recovered)).toEqual([true, undefined]);
  });

  it('keeps a failure the server did not mark: the same tool on another record', () => {
    const rows = [
      tool('tc-1', 'create_document', { error: 'You need the right to modify applications.' }, { title: 'Runbook APP-36' }),
      tool('tc-2', 'create_document', { preview_id: 'p-2' }, { title: 'Runbook APP-37' }),
    ];
    const repaired = repairedToolCallIds([
      { id: 'tc-1', name: 'create_document', result: rows[0].result },
      { id: 'tc-2', name: 'create_document', result: rows[1].result },
    ]);
    expect(markRecoveredToolFailures(rows, repaired).map((row) => row.recovered)).toEqual([undefined, undefined]);
  });

  it('hides every failure a repair names, after several attempts', () => {
    const rows = [
      tool('tc-1', 'create_document', { error: 'No application found matching "APP-36".' }),
      tool('tc-2', 'create_document', { error: 'Several applications match "Cheese".' }),
      tool('tc-3', 'create_document', { preview_id: 'p-3' }),
    ];
    const repaired = repairedToolCallIds([
      { id: 'tc-3', name: 'create_document', result: rows[2].result, repairs: ['tc-1', 'tc-2'] },
    ]);
    expect(markRecoveredToolFailures(rows, repaired).map((row) => row.recovered)).toEqual([true, true, undefined]);
  });

  it('never marks a call that did not fail, nor a phase', () => {
    const rows: Array<Row | { kind: string; toolCall?: undefined; result?: undefined; recovered?: boolean }> = [
      { kind: 'phase' },
      tool('tc-1', 'query_entities', { items: [] }),
    ];
    const marked = markRecoveredToolFailures(rows, new Set(['tc-1']));
    expect(marked.map((row) => row.recovered)).toEqual([undefined, undefined]);
  });

  it('reads no repair from results without one', () => {
    expect(repairedToolCallIds(undefined).size).toBe(0);
    expect(repairedToolCallIds([{ id: 'tc-1', name: 'search_all', result: {} }]).size).toBe(0);
  });
});
