import { describe, expect, it } from 'vitest';
import { displayedCompanyCity } from './companyCity';

describe('displayedCompanyCity', () => {
  it('hides the starting-company placeholder and keeps a real city', () => {
    expect(displayedCompanyCity('Unknown')).toBe('');
    expect(displayedCompanyCity(' Unknown ')).toBe('');
    expect(displayedCompanyCity(null)).toBe('');
    expect(displayedCompanyCity(undefined)).toBe('');
    expect(displayedCompanyCity('')).toBe('');
    expect(displayedCompanyCity('Paris')).toBe('Paris');
    expect(displayedCompanyCity('Unknown City')).toBe('Unknown City');
  });
});
