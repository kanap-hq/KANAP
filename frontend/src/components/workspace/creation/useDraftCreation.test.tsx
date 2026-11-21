import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KanapDialogProvider } from '../../design';
import { creationKey, getCreation, resetCreationStore, setCreation } from './creationStore';
import useDraftCreation from './useDraftCreation';

const stableT = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const RECORD_ID = '5f1d7a2e-0000-4000-8000-000000000007';
const RECORD_PATH = `/things/${RECORD_ID}/overview`;

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={queryClient}>
      <KanapDialogProvider>
        <MemoryRouter initialEntries={['/start', RECORD_PATH]} initialIndex={1}>{children}</MemoryRouter>
      </KanapDialogProvider>
    </QueryClientProvider>
  );
}

describe('useDraftCreation Done', () => {
  beforeEach(() => {
    resetCreationStore();
  });

  it('marks a required field the created record shows emptied and keeps the person on it, then closes it once filled', () => {
    setCreation(creationKey('things', RECORD_ID), { token: 'token-1', returnTo: '/start' });
    const values: Record<string, string> = { owner: '' };
    const post = vi.fn();
    const { result } = renderHook(() => ({
      creation: useDraftCreation({
        isCreate: false,
        family: 'things',
        apiBase: '/things',
        recordId: RECORD_ID,
        listPath: '/things',
        recordLabel: 'The thing',
        ready: () => true,
        post,
        missing: () => Object.keys(values).filter((key) => !values[key]),
        valueOf: (key) => values[key],
      }),
      path: useLocation().pathname,
    }), { wrapper });
    expect(result.current.creation.beingCreated).toBe(true);

    act(() => result.current.creation.create());
    expect([...result.current.creation.marked]).toEqual(['owner']);
    expect(result.current.path).toBe(RECORD_PATH);
    expect(getCreation(creationKey('things', RECORD_ID))).toBeTruthy();

    values.owner = 'Ana';
    act(() => result.current.creation.create());
    expect(result.current.path).toBe('/start');
    expect(getCreation(creationKey('things', RECORD_ID))).toBeUndefined();
    expect(post).not.toHaveBeenCalled();
  });
});
