import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

const grid = vi.hoisted(() => ({
  extraParams: null as null | Record<string, unknown>,
  refreshKey: undefined as unknown,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: { extraParams?: Record<string, unknown>; refreshKey?: unknown }) => {
    grid.extraParams = props.extraParams ?? null;
    grid.refreshKey = props.refreshKey;
    return null;
  },
}));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));

import DepartmentsPage from './DepartmentsPage';

function renderPage() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <DepartmentsPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

function yearField() {
  return screen.getByLabelText('shared.fields.year') as HTMLInputElement;
}

describe('DepartmentsPage year', () => {
  afterEach(() => cleanup());

  it('does not request year=2 while the field is still a partial year', () => {
    renderPage();
    const initial = Number(grid.extraParams?.year);
    const refreshKey = grid.refreshKey;
    expect(initial).toBeGreaterThan(999);

    const input = yearField();
    fireEvent.change(input, { target: { value: '2' } });
    expect(input).toHaveValue(2);
    expect(grid.extraParams).toMatchObject({ year: initial });
    expect(grid.refreshKey).toBe(refreshKey);
    expect(grid.extraParams?.year).not.toBe(2);

    for (const partial of ['20', '202']) {
      fireEvent.change(yearField(), { target: { value: partial } });
      expect(yearField()).toHaveValue(Number(partial));
      expect(grid.extraParams).toMatchObject({ year: initial });
      expect(grid.refreshKey).toBe(refreshKey);
    }

    const complete = initial === 2999 ? 1900 : initial + 1;
    fireEvent.change(yearField(), { target: { value: String(complete) } });
    expect(grid.extraParams).toMatchObject({ year: complete });
    expect(grid.refreshKey).not.toBe(refreshKey);
  });

  it('steps the year from the arrows and keeps a partial draft off the request', () => {
    renderPage();
    const initial = Number(grid.extraParams?.year);
    fireEvent.click(screen.getByRole('button', { name: 'common:yearTabs.next' }));
    expect(grid.extraParams).toMatchObject({ year: initial + 1 });
    expect(yearField()).toHaveValue(initial + 1);

    fireEvent.change(yearField(), { target: { value: '20' } });
    expect(grid.extraParams).toMatchObject({ year: initial + 1 });
    fireEvent.click(screen.getByRole('button', { name: 'common:yearTabs.previous' }));
    expect(grid.extraParams).toMatchObject({ year: initial });
    expect(yearField()).toHaveValue(initial);
  });
});
