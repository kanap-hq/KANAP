import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { DASH } from './helpers';

const auth = vi.hoisted(() => ({ applications: false, infrastructure: false }));
const get = vi.hoisted(() => vi.fn());

vi.mock('../../../api', () => ({ default: { get } }));
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => (
      level === 'reader' && (
        (resource === 'applications' && auth.applications)
        || (resource === 'infrastructure' && auth.infrastructure)
      )
    ),
  }),
}));

import { useRelationLabels } from './labels';

const CATALOG_URL = '/applications/classification-catalog';

/** A tenant label that is not the shipped "High", so the display projection keeps it. */
const CATALOG = {
  businessCriticalityLevels: [
    { code: 'high', label: 'Shop floor', description: 'Renamed by the workspace.', rank: 3, maxMtdMinutes: 1440 },
  ],
  cyberCriticalityLevels: [],
  dataClasses: [],
  recoveryWaves: [],
};

function renderLabels() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useRelationLabels(), { wrapper }) };
}

describe('useRelationLabels classification catalog', () => {
  beforeEach(async () => {
    auth.applications = false;
    auth.infrastructure = false;
    get.mockReset();
    get.mockImplementation(async (url: string) => (
      url === CATALOG_URL ? { data: CATALOG } : { data: {} }
    ));
    await i18n.changeLanguage('en');
  });

  it('does not request the catalog without the applications or the infrastructure reader level, and names the level from the translation', async () => {
    const { result } = renderLabels();
    await waitFor(() => expect(get).toHaveBeenCalledWith('/it-ops/catalog-labels'));
    expect(get.mock.calls.some(([url]) => url === CATALOG_URL)).toBe(false);
    expect(result.current.criticality('high')).toBe('High');
    expect(result.current.criticality('business_critical')).toBe('Business critical');
    expect(result.current.criticality(null)).toBe(DASH);
  });

  it('requests the catalog with the applications reader level and uses its label', async () => {
    auth.applications = true;
    const { result } = renderLabels();
    await waitFor(() => expect(result.current.criticality('high')).toBe('Shop floor'));
    expect(get).toHaveBeenCalledWith(CATALOG_URL);
    expect(result.current.criticality('business_critical')).toBe('Business critical');
  });

  it('requests the catalog with the infrastructure reader level alone and uses its label', async () => {
    auth.infrastructure = true;
    const { result } = renderLabels();
    await waitFor(() => expect(result.current.criticality('high')).toBe('Shop floor'));
    expect(get).toHaveBeenCalledWith(CATALOG_URL);
  });
});
