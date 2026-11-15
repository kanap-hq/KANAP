import { describe, expect, it } from 'vitest';
import { buildEntityUrl, parseAtMentionQuery } from './entityUrls';

describe('budget line mentions', () => {
  it('accepts legacy prefixes and keeps their numbered references', () => {
    expect(parseAtMentionQuery('OPX')).toEqual({ entityType: 'budget_lines', entityTypes: ['budget_lines'], searchTerm: '' });
    expect(parseAtMentionQuery('opx-3')).toEqual({ entityType: null, entityTypes: ['budget_lines'], searchTerm: 'OPX-3' });
    expect(parseAtMentionQuery('CPX-12')).toEqual({ entityType: null, entityTypes: ['budget_lines'], searchTerm: 'CPX-12' });
  });

  it('searches the one budget lines family with the native BL prefix', () => {
    for (const query of ['BL', 'bl-', 'BL-12']) {
      expect(parseAtMentionQuery(query)).toEqual({ entityType: null, entityTypes: ['budget_lines'], searchTerm: query === 'BL-12' ? 'BL-12' : '' });
    }
  });

  it('links a mentioned line to its workspace', () => {
    expect(buildEntityUrl('budget_lines', 'abc')).toBe('/ops/budget/abc');
    expect(buildEntityUrl('spend_items', 'abc')).toBeNull();
    expect(buildEntityUrl('capex_items', 'abc')).toBeNull();
  });
});

describe('vulnerability mentions', () => {
  it('opens the vulnerabilities page searched on the CVE, every state and alert setting', () => {
    expect(buildEntityUrl('vulnerabilities', 'CVE-2024-3094')).toBe('/it/vulnerabilities?q=CVE-2024-3094&state=all&alerts=all');
  });
});

describe('mention words', () => {
  it('uses CTCT for contacts and CTR for contracts, and no longer CONT', () => {
    expect(parseAtMentionQuery('CTCT')).toEqual({ entityType: 'contacts', entityTypes: ['contacts'], searchTerm: '' });
    expect(parseAtMentionQuery('ctr')).toEqual({ entityType: 'contracts', entityTypes: ['contracts'], searchTerm: '' });
    expect(parseAtMentionQuery('CONT')).toEqual({ entityType: null, searchTerm: 'CONT' });
  });

  it('keeps CTCT and CTR apart while the word is typed', () => {
    expect(parseAtMentionQuery('CT').entityTypes?.slice().sort()).toEqual(['contacts', 'contracts']);
  });
});

describe('business reference mentions of the five families numbered in 26.11.9', () => {
  it.each([
    ['SUP', 'suppliers'],
    ['COMP', 'companies'],
    ['CTCT', 'contacts'],
    ['DEPT', 'departments'],
    ['CTR', 'contracts'],
  ])('narrows @%s-n to %s and searches the number', (prefix, entityType) => {
    expect(parseAtMentionQuery(`${prefix}-3`)).toEqual({ entityType, entityTypes: [entityType], searchTerm: '3' });
    expect(parseAtMentionQuery(prefix.toLowerCase())).toEqual({ entityType, entityTypes: [entityType], searchTerm: '' });
  });

  it.each([
    ['suppliers', '/master-data/suppliers'],
    ['companies', '/master-data/companies'],
    ['contacts', '/master-data/contacts'],
    ['departments', '/master-data/departments'],
    ['contracts', '/ops/contracts'],
  ])('links a mentioned record of %s by its id', (entityType, path) => {
    expect(buildEntityUrl(entityType, 'abc')).toBe(`${path}/abc`);
  });
});
