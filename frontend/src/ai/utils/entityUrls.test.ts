import { describe, expect, it } from 'vitest';
import { buildEntityUrl, parseAtMentionQuery } from './entityUrls';

describe('budget line mentions', () => {
  it('narrows @OPX and @CPX to their line type and keeps the number', () => {
    expect(parseAtMentionQuery('OPX')).toEqual({ entityType: 'spend_items', entityTypes: ['spend_items'], searchTerm: '' });
    expect(parseAtMentionQuery('opx-3')).toEqual({ entityType: 'spend_items', entityTypes: ['spend_items'], searchTerm: '3' });
    expect(parseAtMentionQuery('CPX-12')).toEqual({ entityType: 'capex_items', entityTypes: ['capex_items'], searchTerm: '12' });
  });

  it('links a mentioned line to its workspace', () => {
    expect(buildEntityUrl('spend_items', 'abc')).toBe('/ops/opex/abc');
    expect(buildEntityUrl('capex_items', 'abc')).toBe('/ops/capex/abc');
  });
});
