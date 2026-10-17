import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import { invalidateTechnologyLinks } from './technologyLinkQueries';

describe('invalidateTechnologyLinks', () => {
  it('marks stale both sides of a technology link and nothing else', async () => {
    const client = new QueryClient();
    const keys = [
      ['asset-technologies', 'a1'],
      ['asset-impact', 'a1', 0],
      ['application-relations', 'app-1'],
      ['application-workspace-relations-count', 'app-1'],
      ['technology-servers', 't1'],
      ['technology-workspace', 'TEC-3'],
      ['technologies', {}],
      ['asset-workspace-relations-count', 'a1'],
      ['contracts', {}],
    ];
    keys.forEach((key) => client.setQueryData(key, 1));
    await invalidateTechnologyLinks(client);
    const stale = keys.filter((key) => client.getQueryState(key)?.isInvalidated).map((key) => key[0]);
    expect(stale).toEqual([
      'asset-technologies', 'asset-impact', 'application-relations', 'application-workspace-relations-count',
      'technology-servers', 'technology-workspace', 'technologies',
    ]);
  });
});
