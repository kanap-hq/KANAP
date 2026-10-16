import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('../api', () => ({ default: { post: api.post } }));

import { recordRefusal, recordsInUseCheck } from './deleteCheck';

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

  it('reads the refusal of one record, none when the check fails', async () => {
    const refusal = { id: 'a-1', name: 'srv-01', code: 'ASSET_IN_USE', usages: [{ type: 'connections', total: 1 }] };
    api.post.mockResolvedValueOnce({ data: { refused: [refusal] } });
    expect(await recordRefusal('/assets', 'a-1')).toEqual(refusal);
    expect(api.post).toHaveBeenCalledWith('/assets/delete-check', { ids: ['a-1'] });
    api.post.mockResolvedValueOnce({ data: { refused: [] } });
    expect(await recordRefusal('/assets', 'a-2')).toBeNull();
    api.post.mockRejectedValueOnce(new Error('offline'));
    expect(await recordRefusal('/users', 'u-1')).toBeNull();
  });
});
