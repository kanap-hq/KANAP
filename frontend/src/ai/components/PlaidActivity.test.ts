import { describe, expect, it } from 'vitest';
import { markRecoveredToolFailures } from './PlaidActivity';

type Row = { kind: string; toolCall: { name: string }; result: unknown; recovered?: boolean };
const tool = (name: string, result: unknown): Row => ({ kind: 'tool', toolCall: { name }, result });

describe('markRecoveredToolFailures', () => {
  it('does not show as failed a call the same tool then made successfully', () => {
    const rows = markRecoveredToolFailures([
      tool('create_document', { error: 'Application APP-36 not found.' }),
      tool('create_document', { preview_id: 'p-1' }),
    ]);
    expect(rows[0].recovered).toBe(true);
    expect(rows[1].recovered).toBeUndefined();
  });

  it('keeps a failure that nothing repaired', () => {
    const rows = markRecoveredToolFailures([
      tool('create_document', { error: 'Refused.' }),
      tool('query_entities', { items: [] }),
      tool('create_document', { error: 'Refused again.' }),
    ]);
    expect(rows.map((row) => row.recovered)).toEqual([undefined, undefined, undefined]);
  });

  it('waits for the later call to finish', () => {
    const rows = markRecoveredToolFailures([
      tool('create_document', { error: 'Refused.' }),
      tool('create_document', undefined),
    ]);
    expect(rows[0].recovered).toBeUndefined();
  });
});
