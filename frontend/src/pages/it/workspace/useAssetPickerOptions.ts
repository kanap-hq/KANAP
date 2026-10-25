import React from 'react';
import api from '../../../api';
import type { ServerOption } from '../../../components/fields/serverOptionRender';

type Params = {
  /** Read the list and resolve the selection: false while the picker shows its entity mode. */
  enabled: boolean;
  assetId?: string | null;
  /** The asset the caller already holds (from the connection or the leg): shown at once, without a read. */
  initialAsset?: ServerOption | null;
};

/**
 * The asset search shared by the connection pickers: a debounced `GET /assets` for the options,
 * and the selected asset, taken from the caller's copy, the list or `GET /assets/:id` in that order.
 * It is what keeps a selected server on screen from the first render, even outside the first 50 rows.
 */
export default function useAssetPickerOptions({ enabled, assetId, initialAsset }: Params) {
  const [search, setSearch] = React.useState('');
  const [options, setOptions] = React.useState<ServerOption[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [listLoaded, setListLoaded] = React.useState(false);
  const [fetched, setFetched] = React.useState<ServerOption | null>(null);

  React.useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setListLoaded(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setListLoaded(false);
    const handle = setTimeout(async () => {
      try {
        const res = await api.get<{ items: ServerOption[] }>('/assets', {
          params: { q: search || undefined, limit: 50, sort: 'name:ASC', include: 'member_names' },
        });
        if (!cancelled) setOptions(res.data.items || []);
      } catch {
        if (!cancelled) setOptions([]);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setListLoaded(true);
        }
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [enabled, search]);

  const selected = React.useMemo(() => {
    if (!assetId) return null;
    if (initialAsset && initialAsset.id === assetId) return initialAsset;
    return options.find((option) => option.id === assetId)
      || (fetched && fetched.id === assetId ? fetched : null);
  }, [assetId, initialAsset, options, fetched]);

  React.useEffect(() => {
    if (!enabled || !assetId) {
      setFetched(null);
      return;
    }
    if (initialAsset && initialAsset.id === assetId) {
      setFetched(null);
      return;
    }
    // The list is read first: an asset it holds needs no second read.
    if (!listLoaded || loading) return;
    if (options.some((option) => option.id === assetId)) return;
    if (fetched && fetched.id === assetId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get<ServerOption>(`/assets/${assetId}`);
        if (!cancelled) setFetched(res.data as ServerOption);
      } catch {
        if (!cancelled) setFetched(null);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [assetId, enabled, initialAsset, listLoaded, loading, options, fetched]);

  // The chosen asset stays among the options, even when the search no longer returns it.
  const shownOptions = React.useMemo(
    () => (selected && !options.some((option) => option.id === selected.id) ? [selected, ...options] : options),
    [options, selected],
  );

  return { options: shownOptions, loading, setSearch, selected };
}
