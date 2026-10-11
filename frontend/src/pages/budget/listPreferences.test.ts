import { beforeEach, describe, expect, it, vi } from 'vitest';
import { migrateBudgetGridLayout, natureScopeOf, readBudgetNature } from './listPreferences';
let values: Map<string, string>;
beforeEach(() => {
  values = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
});
describe('budget list preferences', () => {
  it('defaults to all and accepts only valid stored natures', () => {
    expect(readBudgetNature('key')).toBe('all');
    values.set('key', 'capex');
    expect(readBudgetNature('key')).toBe('capex');
    values.set('key', 'wrong');
    expect(readBudgetNature('key')).toBe('all');
  });
  it('retains an existing budget layout and scopes the copy per user', () => {
    values.set('grid-columns:t:u:budget-summary', 'new');
    values.set('grid-columns:t:u:opex-summary', 'old');
    values.set('grid-columns:t:other:opex-summary', 'another');
    migrateBudgetGridLayout('t', 'u');
    expect(values.get('grid-columns:t:u:budget-summary')).toBe('new');
    migrateBudgetGridLayout('t', 'other');
    expect(values.get('grid-columns:t:other:budget-summary')).toBe('another');
  });
  it('tolerates unavailable storage', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('disabled'); } });
    expect(readBudgetNature('key')).toBe('all');
    expect(() => migrateBudgetGridLayout('t', 'u')).not.toThrow();
  });
  it('matches include and exclude set filters to the nature toggle', () => {
    expect(natureScopeOf({ filterType: 'set', values: ['capex'] })).toBe('capex');
    expect(natureScopeOf({ filterType: 'set', values: ['opex'] })).toBe('opex');
    expect(natureScopeOf({ filterType: 'set', values: ['opex', 'capex'] })).toBe('all');
    expect(natureScopeOf(null)).toBe('all');
    expect(natureScopeOf({ filterType: 'set', mode: 'exclude', values: ['capex'] })).toBe('opex');
  });
});
