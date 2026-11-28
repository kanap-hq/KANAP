import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

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
  /** The "Book a discovery call" button of trial workspaces; empty values hide it (always on-premise). */
  discoveryCall: { url: string; fallbackEmail: string };
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
  discoveryCall: { url: '', fallbackEmail: '' },
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

export type FeaturesContextValue = {
  config: FeaturesConfig;
  /** True until the server has answered once; never true again afterwards. */
  isLoading: boolean;
  isSingleTenant: boolean;
  /**
   * Reads `/config/public` again and replaces the configuration. Resolves to true once replaced by
   * a read that started after the call (a call made after a save sees that save), to false when
   * that read failed: the configuration stays as it was. A call made while a read runs waits for
   * the next one, which starts when that read ends and answers every call made meanwhile: one
   * read running at most, one waiting at most. The same function for the life of the provider.
   */
  refresh: () => Promise<boolean>;
};

const FeaturesContext = createContext<FeaturesContextValue>({
  config: CLOUD_DEFAULTS,
  isLoading: true,
  isSingleTenant: CLOUD_DEFAULTS.deploymentMode === 'single-tenant',
  refresh: async () => false,
});

/** A read that does not answer within this delay is abandoned and retried. */
const REQUEST_TIMEOUT_MS = 5000;

function configUrl(): string {
  const apiBase = (import.meta.env.VITE_API_URL as string | undefined) || '/api';
  return `${apiBase.replace(/\/$/, '')}/config/public`;
}

/** One read of `/config/public`, abandoned after REQUEST_TIMEOUT_MS or when `controller` aborts. */
async function readPublicConfig(controller: AbortController): Promise<FeaturesConfig> {
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(configUrl(), { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data: FeaturesConfigResponse = await res.json();
    return normalizeFeaturesConfig(data);
  } finally {
    clearTimeout(timeout);
  }
}
/** Delay before the first retry, doubled after each failure up to RETRY_MAX_MS. */
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

export function FeaturesProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<FeaturesConfig>(CLOUD_DEFAULTS);
  // True until the server has answered once. A failed read is retried and never ends the loading:
  // the defaults would hide the menus and routes of every feature they switch off (a deep link
  // to one would fall to the catch-all), so nothing renders on them.
  const [isLoading, setIsLoading] = useState(true);
  // Set once a refresh has answered: the first load, if still trying, stops and never overwrites it.
  const refreshed = useRef(false);

  useEffect(() => {
    // An effect torn down before its read answers (unmount, or the development double run) leaves
    // the state to the next one: marking it loaded here would show the routes with the defaults.
    let cancelled = false;
    let loaded = false;
    let failures = 0;
    let inFlight: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const stopListening = () => {
      window.removeEventListener('focus', retryNow);
      window.removeEventListener('online', retryNow);
    };

    const load = async () => {
      if (cancelled || loaded || inFlight || refreshed.current) return;
      clearTimeout(retryTimer);
      retryTimer = undefined;
      const controller = new AbortController();
      inFlight = controller;
      try {
        const next = await readPublicConfig(controller);
        if (cancelled || refreshed.current) return;
        loaded = true;
        stopListening();
        setConfig(next);
        setIsLoading(false);
      } catch (err) {
        if (cancelled || refreshed.current) return;
        const delay = Math.min(RETRY_BASE_MS * 2 ** failures, RETRY_MAX_MS);
        failures += 1;
        console.warn(`[Features] Failed to fetch config, retrying in ${delay / 1000} s:`, (err as Error)?.message);
        retryTimer = setTimeout(() => void load(), delay);
      } finally {
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

  // At most one refresh read running, and one waiting for it to end. A call made while a read runs
  // gets the waiting one: the running read may have left before the caller's own save.
  const running = useRef<Promise<boolean> | null>(null);
  const waiting = useRef<{ promise: Promise<boolean>; start: () => void } | null>(null);
  const refresh = useCallback((): Promise<boolean> => {
    const startRead = (): Promise<boolean> => {
      const read = readPublicConfig(new AbortController())
        .then((next) => {
          refreshed.current = true;
          setConfig(next);
          setIsLoading(false);
          return true;
        }, (err) => {
          console.warn('[Features] Failed to refresh config:', (err as Error)?.message);
          return false;
        })
        .then((ok) => {
          // Hand over in the same step, so that no call slips a third read in between.
          running.current = null;
          const next = waiting.current;
          waiting.current = null;
          next?.start();
          return ok;
        });
      running.current = read;
      return read;
    };
    if (!running.current) return startRead();
    if (!waiting.current) {
      let start = () => undefined as void;
      const promise = new Promise<boolean>((resolve) => {
        start = () => resolve(startRead());
      });
      waiting.current = { promise, start };
    }
    return waiting.current.promise;
  }, []);

  const value = useMemo<FeaturesContextValue>(() => ({
    config,
    isLoading,
    isSingleTenant: config.deploymentMode === 'single-tenant',
    refresh,
  }), [config, isLoading, refresh]);

  return (
    <FeaturesContext.Provider value={value}>
      {children}
    </FeaturesContext.Provider>
  );
}

export function useFeatures() {
  return useContext(FeaturesContext);
}
