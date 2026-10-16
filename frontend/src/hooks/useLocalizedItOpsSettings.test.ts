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
});
