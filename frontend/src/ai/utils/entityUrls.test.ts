import { describe, expect, it } from 'vitest';
import { buildEntityUrl, parseAtMentionQuery } from './entityUrls';

describe('budget line mentions', () => {
  it('accepts legacy prefixes and keeps their numbered references', () => {
    expect(parseAtMentionQuery('OPX')).toEqual({ entityType: 'spend_items', entityTypes: ['spend_items'], searchTerm: '' });
    expect(parseAtMentionQuery('opx-3')).toEqual({ entityType: null, entityTypes: ['spend_items', 'capex_items'], searchTerm: 'OPX-3' });
    expect(parseAtMentionQuery('CPX-12')).toEqual({ entityType: null, entityTypes: ['spend_items', 'capex_items'], searchTerm: 'CPX-12' });
  });

  it('searches both budget families with the native BL prefix', () => {
    for (const query of ['BL', 'bl-', 'BL-12']) {
      expect(parseAtMentionQuery(query)).toEqual({ entityType: null, entityTypes: ['spend_items', 'capex_items'], searchTerm: query === 'BL-12' ? 'BL-12' : '' });
    }
  });

  it('links a mentioned line to its workspace', () => {
    expect(buildEntityUrl('spend_items', 'abc')).toBe('/ops/budget/abc');
    expect(buildEntityUrl('capex_items', 'abc')).toBe('/ops/budget/abc');
  });
});

describe('vulnerability mentions', () => {
  it('opens the vulnerabilities page searched on the CVE, every state and alert setting', () => {
    expect(buildEntityUrl('vulnerabilities', 'CVE-2024-3094')).toBe('/it/vulnerabilities?q=CVE-2024-3094&state=all&alerts=all');
  });
});
