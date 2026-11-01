import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../../api';

interface DashboardTileConfig {
  id: string;
  enabled: boolean;
  order: number;
  config: Record<string, unknown>;
}

/** As the server's defaults (`DEFAULT_BUDGET_DASHBOARD_CONFIG`): the overview, the top lines and the hygiene checks. */
export const DEFAULT_BUDGET_TILES: DashboardTileConfig[] = [
  'budget', 'top-lines', 'hygiene', 'my-budget', 'renewals',
  'top-increases', 'cost-centers', 'recent-updates', 'my-tasks',
].map((id, index) => ({ id, enabled: index < 3, order: index + 1, config: id === 'budget' ? { columns: null } : {} }));

export interface DashboardConfig {
  tiles: DashboardTileConfig[];
}

export function useBudgetDashboardConfig() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard', 'budget-config'],
    queryFn: async () => {
      const res = await api.get<DashboardConfig>('/dashboard/budget-config');
      return res.data;
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const updateMutation = useMutation({
    mutationFn: async (config: DashboardConfig) => {
      const res = await api.put<DashboardConfig>('/dashboard/budget-config', config);
      return res.data;
    },
    onSuccess: (newConfig) => {
      queryClient.setQueryData(['dashboard', 'budget-config'], newConfig);
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<DashboardConfig>('/dashboard/budget-config/reset');
      return res.data;
    },
    onSuccess: (newConfig) => {
      queryClient.setQueryData(['dashboard', 'budget-config'], newConfig);
    },
  });

  const updateConfig = (config: DashboardConfig) => {
    return updateMutation.mutateAsync(config);
  };

  const resetConfig = () => {
    return resetMutation.mutateAsync();
  };

  return {
    config: data?.tiles ? data : { tiles: DEFAULT_BUDGET_TILES },
    isLoading,
    error,
    refetch,
    updateConfig,
    resetConfig,
    isUpdating: updateMutation.isPending,
    isResetting: resetMutation.isPending,
  };
}
