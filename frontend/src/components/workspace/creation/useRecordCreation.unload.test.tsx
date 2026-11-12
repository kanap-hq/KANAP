import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import useRecordCreation from './useRecordCreation';
import { resetCreationStore } from './creationStore';
import { releaseLockKeepaliveUrl } from '../../../lib/releaseLockKeepalive';
import { setAccessToken } from '../../../auth/accessTokenStore';

vi.mock('react-i18next', async (importOriginal) => {
  const t = (key: string) => key;
  return { ...(await importOriginal<typeof import('react-i18next')>()), useTranslation: () => ({ t }) };
});
vi.mock('../../design', () => ({ useKanapDialogs: () => ({ confirm: vi.fn() }) }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const ID = '0f8b2f0e-7d3a-4c1e-9a55-1c2d3e4f5a6b';

function mount(recordId: string | null) {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  );
  return renderHook(() => useRecordCreation({
    family: 'assets',
    apiBase: '/assets',
    recordId,
    listPath: '/it/assets',
    recordLabel: 'The asset',
  }), { wrapper });
}

describe('useRecordCreation discardOnUnload', () => {
  afterEach(() => {
    resetCreationStore();
    setAccessToken(null);
    vi.unstubAllGlobals();
  });

  it('sends the cancel of this record, with its token, as a request that outlives the page', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('access-1', Date.now() + 60_000);
    const view = mount(ID);
    act(() => view.result.current.startCreation({ recordId: ID, token: 'creation-1', returnTo: '/it/assets' }));

    view.result.current.discardOnUnload();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(releaseLockKeepaliveUrl(`/assets/${ID}/creation`));
    expect(init).toMatchObject({
      method: 'DELETE',
      keepalive: true,
      credentials: 'include',
      headers: { Authorization: 'Bearer access-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'creation-1' }),
    });
  });

  it('sends nothing for a record that is not being created, or a page with no record', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const created = mount(ID);
    created.result.current.discardOnUnload();
    const none = mount(null);
    none.result.current.discardOnUnload();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing once the creation is finished', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    const view = mount(ID);
    act(() => view.result.current.startCreation({ recordId: ID, token: 'creation-1', returnTo: '/it/assets' }));
    act(() => view.result.current.finishCreation());
    view.result.current.discardOnUnload();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
