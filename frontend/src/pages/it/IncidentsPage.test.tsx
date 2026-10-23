import { describe, expect, it } from 'vitest';
import { incidentRefValueGetter } from './IncidentsPage';

type Params = Parameters<typeof incidentRefValueGetter>[0];

describe('incidentRefValueGetter', () => {
  it('shows the incident reference on a normal row', () => {
    expect(incidentRefValueGetter({ node: { rowPinned: null }, data: { item_number: 7 } } as unknown as Params)).toBe('INC-7');
  });

  it('keeps the total label of the pinned row without the reference prefix', () => {
    expect(incidentRefValueGetter({ node: { rowPinned: 'bottom' }, data: { item_number: 'Total (10)' } } as unknown as Params)).toBe('Total (10)');
  });
});
