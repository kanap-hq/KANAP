import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const settings = vi.hoisted(() => ({
  data: {
    lifecycleStates: [
      { code: 'proposed', label: 'Proposed' },
      { code: 'active', label: 'Active' },
      { code: 'deprecated', label: 'Deprecated' },
      { code: 'retired', label: 'Retired' },
      { code: 'pilot', label: 'Pilot' },
    ],
  },
}));
vi.mock('./useItOpsSettings', () => ({ useItOpsSettings: () => ({ data: settings.data }) }));
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  const translation = { t: (key: string) => key, i18n: { language: 'fr', resolvedLanguage: 'fr' } };
  return { ...actual, useTranslation: () => translation };
});

import { useLocalizedItOpsSettings } from './useLocalizedItOpsSettings';

describe('useLocalizedItOpsSettings', () => {
  it('shows the shipped lifecycle states in the user language and keeps their codes', () => {
    const { result } = renderHook(() => useLocalizedItOpsSettings());
    expect(result.current.data?.lifecycleStates).toEqual([
      { code: 'proposed', label: 'Proposé' },
      { code: 'active', label: 'Actif' },
      { code: 'deprecated', label: 'Obsolète' },
      { code: 'retired', label: 'Retiré' },
      // A state the tenant added keeps its own name.
      { code: 'pilot', label: 'Pilot' },
    ]);
  });

  it('keeps a shipped state the tenant renamed as it is', () => {
    settings.data = { lifecycleStates: [{ code: 'active', label: 'In service' }] };
    const { result } = renderHook(() => useLocalizedItOpsSettings());
    expect(result.current.data?.lifecycleStates).toEqual([{ code: 'active', label: 'In service' }]);
  });

  it('shows the shipped asset types and server roles in the user language until the tenant renames them', () => {
    settings.data = {
      serverKinds: [
        { code: 'physical_server', label: 'Physical Server', is_physical: true },
        { code: 'access_point', label: 'Access Point', is_physical: true },
        { code: 'virtual_machine', label: 'VM', is_physical: false },
        { code: 'cloud_instance', label: 'Cloud Instance', is_physical: false },
      ],
      serverRoles: [
        { code: 'app', label: 'Application server', graph_tier: 'upper' },
        { code: 'web', label: 'Frontal web', graph_tier: 'top' },
      ],
    } as any;
    const { result } = renderHook(() => useLocalizedItOpsSettings());
    expect(result.current.data?.serverKinds).toEqual([
      { code: 'physical_server', label: 'Serveur physique', is_physical: true },
      { code: 'access_point', label: "Point d'accès", is_physical: true },
      // Renamed by the tenant, or added by the tenant: kept as they are.
      { code: 'virtual_machine', label: 'VM', is_physical: false },
      { code: 'cloud_instance', label: 'Cloud Instance', is_physical: false },
    ]);
    expect(result.current.data?.serverRoles).toEqual([
      { code: 'app', label: "Serveur d'applications", graph_tier: 'upper' },
      { code: 'web', label: 'Frontal web', graph_tier: 'top' },
    ]);
  });
});
