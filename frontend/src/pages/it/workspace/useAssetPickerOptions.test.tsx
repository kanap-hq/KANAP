import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useAssetPickerOptions from './useAssetPickerOptions';
import type { ServerOption } from '../../../components/fields/serverOptionRender';

const apiGet = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({ default: { get: apiGet } }));

const asset = (overrides: Partial<ServerOption> = {}): ServerOption => ({
  id: 'asset-1',
  name: 'PAR-SQL-01',
  environment: 'prod',
  kind: 'vm',
  provider: 'vmware',
  ...overrides,
});

describe('useAssetPickerOptions', () => {
  beforeEach(() => {
    apiGet.mockReset();
  });

  it('shows the caller copy at once and never reads the asset alone', async () => {
    const initial = asset();
    apiGet.mockResolvedValue({ data: { items: [] } });
    const { result } = renderHook(() => useAssetPickerOptions({ enabled: true, assetId: initial.id, initialAsset: initial }));
    expect(result.current.selected).toBe(initial);
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/assets', expect.objectContaining({
      params: { q: undefined, limit: 50, sort: 'name:ASC', include: 'member_names' },
    })));
    expect(apiGet.mock.calls.some(([url]) => url === `/assets/${initial.id}`)).toBe(false);
  });

  it('reads the asset once when the list does not hold it', async () => {
    apiGet.mockImplementation(async (url: string) => (
      url === '/assets/asset-1'
        ? { data: asset() }
        : { data: { items: [asset({ id: 'asset-2', name: 'PAR-SQL-02' })] } }
    ));
    const { result } = renderHook(() => useAssetPickerOptions({ enabled: true, assetId: 'asset-1' }));
    await waitFor(() => expect(result.current.selected?.name).toBe('PAR-SQL-01'));
    expect(apiGet.mock.calls.filter(([url]) => url === '/assets/asset-1')).toHaveLength(1);
  });

  it('takes the asset from the list without a second read', async () => {
    apiGet.mockResolvedValue({ data: { items: [asset()] } });
    const { result } = renderHook(() => useAssetPickerOptions({ enabled: true, assetId: 'asset-1' }));
    await waitFor(() => expect(result.current.selected?.name).toBe('PAR-SQL-01'));
    expect(apiGet.mock.calls.filter(([url]) => url === '/assets/asset-1')).toHaveLength(0);
  });

  it('asks nothing while disabled and keeps the caller copy selectable', () => {
    const initial = asset();
    renderHook(() => useAssetPickerOptions({ enabled: false, assetId: initial.id, initialAsset: initial }));
    expect(apiGet).not.toHaveBeenCalled();
  });
});
