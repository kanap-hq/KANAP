import { useQuery } from '@tanstack/react-query';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import { useFeatures } from '../config/FeaturesContext';
import { useTenant } from '../tenant/TenantContext';

export type AiSurfaceCapability = {
  feature_enabled: boolean;
  tenant_enabled: boolean;
  permission_granted: boolean;
  provider_ready: boolean;
  available: boolean;
  reasons: string[];
};

export type AiSettingsCapability = {
  feature_enabled: boolean;
  permission_granted: boolean;
  available: boolean;
  reasons: string[];
};

export type AiCapabilities = {
  instance_features: {
    ai_chat: boolean;
    ai_mcp: boolean;
    ai_settings: boolean;
    ai_web_search: boolean;
  };
  surfaces: {
    chat: AiSurfaceCapability;
    mcp: AiSurfaceCapability;
    settings: AiSettingsCapability;
  };
  // The workspace's fallback model is the KANAP included model and no administrator
  // has confirmed it: agents without a model of their own are paused.
  builtin_confirmation_needed?: boolean;
};

export function useAiCapabilities() {
  const { token, isAuthenticating, profile, claims } = useAuth();
  const { isPlatformHost } = useTenant();
  const { config, isLoading: featuresLoading } = useFeatures();
  const userId = profile?.id ?? null;
  const aiFeatureEnabled =
    config.features.aiChat ||
    config.features.aiMcp ||
    config.features.aiSettings;

  return useQuery<AiCapabilities, any>({
    queryKey: ['ai-capabilities', userId],
    queryFn: async () => {
      const res = await api.get('/ai/capabilities');
      return res.data;
    },
    enabled:
      !!token &&
      !isAuthenticating &&
      !!claims &&
      !!userId &&
      !featuresLoading &&
      !isPlatformHost &&
      aiFeatureEnabled,
    staleTime: 30_000,
    retry: false,
  });
}
