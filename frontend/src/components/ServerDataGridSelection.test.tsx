import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real AG Grid: the grid's own box column exists only on a list that asks for row selection.
vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', getResourceBundle: () => ({}) },
  };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' } }) }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'test' }) }));
vi.mock('../config/ThemeContext', () => ({ useThemeMode: () => ({ resolvedMode: 'light' }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

import api from '../api';
import ServerDataGrid from './ServerDataGrid';
import { flushAgGridTimers } from '../test/agGridTimers';
import { stubOffsetParent } from '../test/jsdomOffsetParent';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn> };
const CONTROLS = '[col-id="ag-Grid-ControlsColumn"]';
const names = (container: HTMLElement) => Array.from(container.querySelectorAll('.ag-row [col-id="name"]')).map((cell) => cell.textContent).sort();

function Grid({ selection, onSelectionChanged }: { selection?: boolean; onSelectionChanged?: (rows: any[]) => void }) {
  return (
    <MemoryRouter initialEntries={['/things']}>
      <ServerDataGrid<{ id: string; name: string }>
        columns={[{ field: 'name', headerName: 'Name' }]}
        endpoint="/things"
        queryKey="things"
        defaultSort={{ field: 'name', direction: 'ASC' }}
        enableRowSelection={selection}
        onSelectionChanged={onSelectionChanged}
      />
    </MemoryRouter>
  );
}

describe('ServerDataGrid row selection', () => {
  beforeEach(() => {
    stubOffsetParent();
    mocked.get.mockReset();
    mocked.get.mockResolvedValue({ data: { items: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }], total: 2, page: 1, limit: 50 } });
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
  });
  afterEach(async () => {
    cleanup();
    await flushAgGridTimers();
    vi.unstubAllGlobals();
  });

  it('draws no box column on a list without row selection', async () => {
    const { container } = render(<Grid />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1000)); });
    // jsdom has no height: the grid draws its first row only.
    expect(names(container)).toEqual(['A']);
    expect(container.querySelector(CONTROLS)).toBeNull();
    expect(container.querySelector('.ag-row input[type="checkbox"]')).toBeNull();
  });

  it('keeps its box column on a list that asks for row selection', async () => {
    const onSelectionChanged = vi.fn();
    const { container } = render(<Grid selection onSelectionChanged={onSelectionChanged} />);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1000)); });
    // jsdom has no height: the grid draws its first row only.
    expect(names(container)).toEqual(['A']);
    expect(container.querySelectorAll(`.ag-row ${CONTROLS} input`).length).toBe(1);
    const first = container.querySelector(`.ag-row ${CONTROLS} input`) as HTMLInputElement;
    await act(async () => { fireEvent.click(first); });
    await waitFor(() => expect(onSelectionChanged).toHaveBeenLastCalledWith([{ id: 'a', name: 'A' }]));
  });
});
