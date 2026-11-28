import { describe, expect, it } from 'vitest';
import { SAMPLE_DATA_BLOCKING_LISTS } from './blockingLists';

describe('sample data blocking lists', () => {
  it('opens the portfolio classification lists on their tab', () => {
    for (const table of ['portfolio_categories', 'portfolio_sources', 'portfolio_streams']) {
      expect(SAMPLE_DATA_BLOCKING_LISTS[table].to, table).toBe('/portfolio/settings/classification');
    }
  });
});
