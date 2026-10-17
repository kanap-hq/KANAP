import { describe, expect, it } from 'vitest';
import { getDocUrl } from './docUrls';

describe('getDocUrl', () => {
  it('opens the budget lines manual from the list and a line', () => {
    expect(getDocUrl('/ops/budget')).toBe('https://doc.kanap.net/budget-lines/');
    expect(getDocUrl('/ops/budget/BL-12/overview', 'fr')).toBe('https://doc.kanap.net/fr/budget-lines/');
  });

  it('opens the technologies manual, and the report its own page', () => {
    expect(getDocUrl('/it/technologies')).toBe('https://doc.kanap.net/technologies/');
    expect(getDocUrl('/it/technologies/TEC-4/overview', 'de')).toBe('https://doc.kanap.net/de/technologies/');
    expect(getDocUrl('/it/technologies/end-of-support')).toBe('https://doc.kanap.net/end-of-support/');
  });

  it('keeps the overview and falls back to the docs home', () => {
    expect(getDocUrl('/ops')).toBe('https://doc.kanap.net/operations-dashboard/');
    expect(getDocUrl('/ops/budgets')).toBe('https://doc.kanap.net/');
  });
});
