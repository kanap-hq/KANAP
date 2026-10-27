import { describe, expect, it } from 'vitest';
import { markRecoveredToolFailures } from './PlaidActivity';

type Row = { kind: string; toolCall: { name: string; arguments?: Record<string, unknown> }; result: unknown; recovered?: boolean };
const tool = (name: string, result: unknown, args?: Record<string, unknown>): Row => ({ kind: 'tool', toolCall: { name, arguments: args }, result });

describe('markRecoveredToolFailures', () => {
  it('does not show as failed a call the same tool then made successfully', () => {
    const rows = markRecoveredToolFailures([
      tool('create_document', { error: 'Application APP-36 not found.' }, { title: 'Runbook', application: 'APP-36' }),
      tool('create_document', { preview_id: 'p-1' }, { title: 'Runbook', application: '6a1f0c2e-0000-4000-8000-000000000036' }),
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

  it('keeps the failure of one record when the same tool then succeeds on another', () => {
    const rows = markRecoveredToolFailures([
      tool('create_document', { error: 'You need the right to modify applications.' }, { title: 'Runbook APP-36', application: 'APP-36' }),
      tool('create_document', { preview_id: 'p-2' }, { title: 'Runbook APP-37', application: 'APP-37' }),
    ]);
    expect(rows[0].recovered).toBeUndefined();
  });

  it('follows a repair over several attempts', () => {
    const rows = markRecoveredToolFailures([
      tool('create_document', { error: 'Application APP-36 not found.' }, { title: 'Runbook', application: 'APP-36' }),
      tool('create_document', { error: 'Several applications match.' }, { title: 'Runbook', application: 'Billing' }),
      tool('create_document', { preview_id: 'p-3' }, { title: 'Runbook', application: '6a1f0c2e-0000-4000-8000-000000000036' }),
    ]);
    expect(rows.map((row) => row.recovered)).toEqual([true, true, undefined]);
  });

  it('waits for the later call to finish', () => {
    const rows = markRecoveredToolFailures([
      tool('create_document', { error: 'Refused.' }),
      tool('create_document', undefined),
    ]);
    expect(rows[0].recovered).toBeUndefined();
  });
});
