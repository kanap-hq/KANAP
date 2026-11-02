import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

const totals = vi.hoisted(() => ({ calls: [] as Array<Record<string, unknown>> }));
const grid = vi.hoisted(() => ({
  notify: null as null | ((state: Record<string, unknown>) => void),
  extraParams: null as null | Record<string, unknown>,
  refreshKey: undefined as unknown,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr', resolvedLanguage: 'fr' } }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'fr' }));
vi.mock('../lib/listContext', () => ({
  getWithListContext: vi.fn(async (_url: string, params: Record<string, unknown>) => {
    totals.calls.push(params);
    return { data: { headcount: 1, it_users: 0, turnover: 0 } };
  }),
}));
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: { onQueryStateChange?: (state: Record<string, unknown>) => void; extraParams?: Record<string, unknown>; refreshKey?: unknown }) => {
    grid.notify = props.onQueryStateChange ?? null;
    grid.extraParams = props.extraParams ?? null;
    grid.refreshKey = props.refreshKey;
    React.useEffect(() => {
      const state = { sort: 'headcount_year:DESC', q: '', filterModel: {}, statusScope: 'enabled' };
      props.onQueryStateChange?.(state);
      props.onQueryStateChange?.(state);
    }, []);
    return null;
  },
}));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));

import CompaniesPage from './CompaniesPage';

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="loc">{location.search}</div>;
}

function renderPage() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <CompaniesPage />
        <LocationProbe />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('CompaniesPage totals', () => {
  afterEach(() => cleanup());

  it('asks for totals once per real change of year, search, filters or status', async () => {
    totals.calls = [];
    renderPage();
    await waitFor(() => expect(totals.calls).toHaveLength(1));
    grid.notify?.({ sort: 'headcount_year:DESC', q: '', filterModel: {}, statusScope: 'enabled' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(totals.calls).toHaveLength(1);

    grid.notify?.({
      sort: 'name:ASC',
      q: 'forma',
      filterModel: { city: { filter: 'Lyon' } },
      statusScope: 'all',
    });
    await waitFor(() => expect(totals.calls).toHaveLength(2));
    expect(totals.calls[1]).toMatchObject({ q: 'forma', includeDisabled: '1' });
    expect(String(totals.calls[1].filters)).toContain('Lyon');

    fireEvent.change(document.querySelector('input') as HTMLInputElement, { target: { value: '2030' } });
    await waitFor(() => expect(totals.calls).toHaveLength(3));
    expect(totals.calls[2]).toMatchObject({ year: 2030, q: 'forma', includeDisabled: '1' });
  });

  it('keeps the previous year while the field is still a partial year', async () => {
    totals.calls = [];
    renderPage();
    await waitFor(() => expect(totals.calls).toHaveLength(1));
    const initial = Number(totals.calls[0].year);
    const refreshKey = grid.refreshKey;
    const complete = initial === 2999 ? 1900 : initial + 1;
    for (const partial of [String(complete).slice(0, 1), String(complete).slice(0, 2), String(complete).slice(0, 3)]) {
      const input = document.querySelector('input') as HTMLInputElement;
      fireEvent.change(input, { target: { value: partial } });
      expect(input).toHaveValue(Number(partial));
      expect(totals.calls).toHaveLength(1);
      expect(grid.extraParams).toMatchObject({ year: initial });
      expect(grid.refreshKey).toBe(refreshKey);
    }
    fireEvent.change(document.querySelector('input') as HTMLInputElement, { target: { value: String(complete) } });
    await waitFor(() => expect(totals.calls).toHaveLength(2));
    expect(totals.calls[1]).toMatchObject({ year: complete });
    expect(grid.extraParams).toMatchObject({ year: complete });
    expect(totals.calls.every((call) => String(call.year) !== '2' && call.year !== 2)).toBe(true);
  });

  it('steps the year from the arrows and writes it on the URL', async () => {
    totals.calls = [];
    renderPage();
    await waitFor(() => expect(totals.calls).toHaveLength(1));
    const initial = Number(totals.calls[0].year);

    fireEvent.click(screen.getByRole('button', { name: 'common:yearTabs.next' }));
    await waitFor(() => expect(totals.calls).toHaveLength(2));
    expect(totals.calls[1]).toMatchObject({ year: initial + 1 });
    expect(grid.extraParams).toMatchObject({ year: initial + 1 });
    expect(screen.getByTestId('loc').textContent).toContain(`year=${initial + 1}`);
    expect(screen.getByLabelText('shared.fields.year')).toHaveValue(initial + 1);

    fireEvent.change(screen.getByLabelText('shared.fields.year'), { target: { value: '20' } });
    expect(screen.getByLabelText('shared.fields.year')).toHaveValue(20);
    expect(totals.calls).toHaveLength(2);
    expect(grid.extraParams).toMatchObject({ year: initial + 1 });

    fireEvent.click(screen.getByRole('button', { name: 'common:yearTabs.previous' }));
    await waitFor(() => expect(totals.calls).toHaveLength(3));
    expect(totals.calls[2]).toMatchObject({ year: initial });
    expect(grid.extraParams).toMatchObject({ year: initial });
    expect(screen.getByTestId('loc').textContent).toContain(`year=${initial}`);
    expect(screen.getByLabelText('shared.fields.year')).toHaveValue(initial);
  });
});
