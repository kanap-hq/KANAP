import React, { createContext, useContext, useEffect, useState } from 'react';

export type FeaturesConfig = {
  deploymentMode: 'single-tenant' | 'multi-tenant';
  features: {
    billing: boolean;
    sso: boolean;
    email: boolean;
    aiChat: boolean;
    aiMcp: boolean;
    aiSettings: boolean;
    aiWebSearch: boolean;
    builtinAiProvider: boolean;
    /** Administration › Sample data and the home banner (cloud workspaces). */
    sampleData: boolean;
  };
  version: string;
  tenantSlug?: string;
};

type FeaturesConfigResponse = Omit<FeaturesConfig, 'features'> & {
  features?: Partial<FeaturesConfig['features']>;
};

const CLOUD_DEFAULTS: FeaturesConfig = {
  deploymentMode: 'multi-tenant',
  features: {
    billing: true,
    sso: true,
    email: true,
    aiChat: false,
    aiMcp: false,
    aiSettings: false,
    aiWebSearch: false,
    builtinAiProvider: false,
    // Off until the server says otherwise: a failed /config/public never shows it on-premise.
    sampleData: false,
  },
  version: 'unknown',
};

function normalizeFeaturesConfig(config: FeaturesConfigResponse | null | undefined): FeaturesConfig {
  return {
    ...CLOUD_DEFAULTS,
    ...config,
    features: {
      ...CLOUD_DEFAULTS.features,
      ...(config?.features || {}),
    },
  };
}

const FeaturesContext = createContext<{ config: FeaturesConfig; isLoading: boolean }>({
  config: CLOUD_DEFAULTS,
  isLoading: true,
});

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<FeaturesConfig>(CLOUD_DEFAULTS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const apiBase = (import.meta.env.VITE_API_URL as string | undefined) || '/api';
    const base = apiBase.replace(/\/$/, '');

    fetch(`${base}/config/public`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: FeaturesConfigResponse) => {
        setConfig(normalizeFeaturesConfig(data));
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.warn('[Features] Failed to fetch config, using cloud defaults:', err.message);
        }
        // fail-open: keep CLOUD_DEFAULTS
      })
      .finally(() => {
        clearTimeout(timeout);
        setIsLoading(false);
      });

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  return (
    <FeaturesContext.Provider value={{ config, isLoading }}>
      {children}
    </FeaturesContext.Provider>
  );
}

export function useFeatures() {
  return useContext(FeaturesContext);
}
