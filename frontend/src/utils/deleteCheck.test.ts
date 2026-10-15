import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api', () => ({ default: { post: api.post } }));

import { recordsInUseCheck } from './deleteCheck';

describe('recordsInUseCheck', () => {
  beforeEach(() => api.post.mockReset());

  it('asks the delete check of the list and hands its refusals on', async () => {
    const refused = [{ id: 's-1', name: 'Acme', code: 'SUPPLIER_IN_USE', usages: [{ type: 'contracts', total: 2 }] }];
    api.post.mockResolvedValue({ data: { refused } });
    expect(await recordsInUseCheck('/suppliers', ['s-1', 's-2'])).toEqual({ refused });
    expect(api.post).toHaveBeenCalledWith('/suppliers/delete-check', { ids: ['s-1', 's-2'] });
  });

  it('reads an answer without refusals as none', async () => {
    api.post.mockResolvedValue({ data: {} });
    expect(await recordsInUseCheck('/companies', ['c-1'])).toEqual({ refused: [] });
  });
});
