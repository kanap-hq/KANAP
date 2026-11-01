import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../api';
import type { SectionState } from '../sections';

export interface DashboardTileConfig {
  id: string;
  enabled: boolean;
  order: number;
  config: Record<string, unknown>;
}

export interface DashboardConfig {
  tiles: DashboardTileConfig[];
  /** Leave out the tiles with nothing to show; on unless the person turned it off. */
  hideEmptyTiles?: boolean;
  /** The sections in the person's order; null until they order them. */
  sections?: SectionState[] | null;
}

export function useDashboardConfig() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', 'config'],
    queryFn: async () => {
      const res = await api.get<DashboardConfig>('/dashboard/config');
      return res.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const updateMutation = useMutation({
    mutationFn: async (config: DashboardConfig) => {
      const res = await api.put<DashboardConfig>('/dashboard/config', config);
      return res.data;
    },
    onSuccess: (newConfig) => {
      queryClient.setQueryData(['dashboard', 'config'], newConfig);
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<DashboardConfig>('/dashboard/config/reset');
      return res.data;
    },
    onSuccess: (newConfig) => {
      queryClient.setQueryData(['dashboard', 'config'], newConfig);
    },
  });

  const updateConfig = (config: DashboardConfig) => {
    return updateMutation.mutateAsync(config);
  };

  const resetConfig = () => {
    return resetMutation.mutateAsync();
  };

  return {
    config: data ?? { tiles: [] },
    isLoading,
    error,
    refetch,
    updateConfig,
    resetConfig,
    isUpdating: updateMutation.isPending,
    isResetting: resetMutation.isPending,
  };
}
