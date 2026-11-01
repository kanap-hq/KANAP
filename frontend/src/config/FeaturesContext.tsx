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
    /** The catalog of technologies is read from endoflife.date between two versions (TECHNOLOGY_CATALOG_SYNC_ENABLED). */
    technologyCatalogSync: boolean;
    /** IT › Vulnerabilities, its list column and sections (VULNERABILITY_FEED_ENABLED). */
    vulnerabilityFeed: boolean;
    /** Technologies › Overview, section CVE.org names (CVE_LIST_FEED_ENABLED, and the vulnerability feed). */
    cveNames: boolean;
    /** The data imports accept an Excel workbook (.xlsx) as well as a CSV file (IMPORT_XLSX). */
    importXlsx: boolean;
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
    // Off until the server says otherwise, as the sample data.
    technologyCatalogSync: false,
    vulnerabilityFeed: false,
    // Off until the server says otherwise, as the vulnerability feed.
    cveNames: false,
    // Off until the server says otherwise: the dialogs offer only what every server reads.
    importXlsx: false,
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

/** A read that does not answer within this delay is abandoned and retried. */
const REQUEST_TIMEOUT_MS = 5000;
/** Delay before the first retry, doubled after each failure up to RETRY_MAX_MS. */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<FeaturesConfig>(CLOUD_DEFAULTS);
  // True until the server has answered once. A failed read is retried and never ends the loading:
  // the defaults would hide the menus and routes of every feature they switch off (a deep link
  // to one would fall to the catch-all), so nothing renders on them.
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // An effect torn down before its read answers (unmount, or the development double run) leaves
    // the state to the next one: marking it loaded here would show the routes with the defaults.
    let cancelled = false;
    let loaded = false;
    let failures = 0;
    let inFlight: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const apiBase = (import.meta.env.VITE_API_URL as string | undefined) || '/api';
    const base = apiBase.replace(/\/$/, '');

    const stopListening = () => {
      window.removeEventListener('focus', retryNow);
      window.removeEventListener('online', retryNow);
    };

    const load = async () => {
      if (cancelled || loaded || inFlight) return;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      const controller = new AbortController();
      inFlight = controller;
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      try {
        const res = await fetch(`${base}/config/public`, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: FeaturesConfigResponse = await res.json();
        if (cancelled) return;
        loaded = true;
        stopListening();
        setConfig(normalizeFeaturesConfig(data));
        setIsLoading(false);
      } catch (err) {
        if (cancelled) return;
        const delay = Math.min(RETRY_BASE_MS * 2 ** failures, RETRY_MAX_MS);
        failures += 1;
        console.warn(`[Features] Failed to fetch config, retrying in ${delay / 1000} s:`, (err as Error)?.message);
        retryTimer = setTimeout(() => void load(), delay);
      } finally {
        clearTimeout(timeout);
        if (inFlight === controller) inFlight = null;
      }
    };

    // Back on the tab or the network: try again now instead of waiting for the next retry.
    function retryNow() {
      if (!loaded && !inFlight) void load();
    }

    window.addEventListener('focus', retryNow);
    window.addEventListener('online', retryNow);
    void load();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      inFlight?.abort();
      stopListening();
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
