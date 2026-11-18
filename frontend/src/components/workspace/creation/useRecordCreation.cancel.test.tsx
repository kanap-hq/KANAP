import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import api from '../../../api';
import useRecordCreation from './useRecordCreation';
import { getCreation, creationKey, isRecordDeleted, noteCreationAddress, resetCreationStore } from './creationStore';

const mocks = vi.hoisted(() => ({ confirm: vi.fn() }));

vi.mock('react-i18next', async (importOriginal) => {
  const t = (key: string) => key;
  return { ...(await importOriginal<typeof import('react-i18next')>()), useTranslation: () => ({ t }) };
});
vi.mock('../../design', () => ({ useKanapDialogs: () => ({ confirm: mocks.confirm }) }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));

const ID = '0f8b2f0e-7d3a-4c1e-9a55-1c2d3e4f5a6b';

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
  );
  return renderHook(() => useRecordCreation({
    family: 'assets',
    apiBase: '/assets',
    recordId: ID,
    listPath: '/it/assets',
    recordLabel: 'The asset',
  }), { wrapper });
}

function start(view: ReturnType<typeof mount>) {
  act(() => view.result.current.startCreation({
    recordId: ID,
    token: 'creation-1',
    returnTo: '/it/assets',
    reference: 'AST-9',
  }));
}

describe('useRecordCreation cancelCreation', () => {
  afterEach(() => {
    resetCreationStore();
    vi.clearAllMocks();
  });

  it('marks the record when Cancel is confirmed with Delete, and the reference the editor uses', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { changes: { fields: 1, children: {} } } });
    vi.mocked(api.delete).mockResolvedValue({ data: null });
    mocks.confirm.mockResolvedValue(true);
    const view = mount();
    start(view);
    // The description editor of a project opened as PRJ-3 calls noteCreationAddress with that reference.
    noteCreationAddress('assets', 'AST-4');

    let deleted = false;
    await act(async () => {
      deleted = await view.result.current.cancelCreation();
    });

    expect(deleted).toBe(true);
    expect(api.delete).toHaveBeenCalledWith(`/assets/${ID}/creation`, { data: { token: 'creation-1' } });
    expect(isRecordDeleted(ID)).toBe(true);
    expect(isRecordDeleted('AST-4')).toBe(true);
    expect(isRecordDeleted('AST-9')).toBe(true);
    expect(getCreation(creationKey('assets', ID))).toBeUndefined();
  });

  it('marks nothing when Cancel is answered with Keep', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { changes: { fields: 1, children: { description: 1 } } } });
    mocks.confirm.mockResolvedValue(false);
    const view = mount();
    start(view);
    noteCreationAddress('assets', 'AST-4');

    let deleted = true;
    await act(async () => {
      deleted = await view.result.current.cancelCreation();
    });

    expect(deleted).toBe(false);
    expect(api.delete).not.toHaveBeenCalled();
    expect(isRecordDeleted(ID)).toBe(false);
    expect(isRecordDeleted('AST-4')).toBe(false);
    expect(isRecordDeleted('AST-9')).toBe(false);
    expect(getCreation(creationKey('assets', ID))?.token).toBe('creation-1');
  });

  it('marks nothing when the delete is refused', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { changes: { fields: 0, children: {} } } });
    vi.mocked(api.delete).mockRejectedValue({ response: { status: 409, data: { message: 'The application has interfaces' } } });
    const onError = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>
    );
    const view = renderHook(() => useRecordCreation({
      family: 'assets',
      apiBase: '/assets',
      recordId: ID,
      listPath: '/it/assets',
      recordLabel: 'The asset',
      onError,
    }), { wrapper });
    start(view);

    let deleted = true;
    await act(async () => {
      deleted = await view.result.current.cancelCreation();
    });

    expect(deleted).toBe(false);
    expect(onError).toHaveBeenCalled();
    expect(isRecordDeleted(ID)).toBe(false);
    expect(isRecordDeleted('AST-9')).toBe(false);
    expect(getCreation(creationKey('assets', ID))?.token).toBe('creation-1');
  });

  it('marks nothing when the creation has expired and the record stays', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: { changes: { fields: 0, children: {} } } });
    vi.mocked(api.delete).mockRejectedValue({ response: { status: 409, data: { code: 'CREATION_CANCEL_EXPIRED', message: 'over' } } });
    const view = mount();
    start(view);
    noteCreationAddress('assets', 'AST-4');

    let deleted = true;
    await act(async () => {
      deleted = await view.result.current.cancelCreation();
    });

    expect(deleted).toBe(false);
    expect(isRecordDeleted(ID)).toBe(false);
    expect(isRecordDeleted('AST-4')).toBe(false);
    expect(isRecordDeleted('AST-9')).toBe(false);
    expect(getCreation(creationKey('assets', ID))).toBeUndefined();
  });
});
