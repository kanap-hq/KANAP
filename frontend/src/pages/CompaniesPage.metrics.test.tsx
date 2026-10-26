import React from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const totalsPayload = vi.hoisted(() => ({
  current: {
    headcount: 0 as number | null,
    it_users: 0 as number | null,
    turnover: 332.5 as number | null,
    turnover_currency: null as string | null,
  },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr', resolvedLanguage: 'fr' } }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'fr' }));
vi.mock('../lib/listContext', () => ({
  getWithListContext: vi.fn(async () => ({ data: totalsPayload.current })),
}));
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    return null;
  },
}));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));

import CompaniesPage from './CompaniesPage';
import i18n from '../i18n';

function column(field: string) {
  const col = (grid.props?.columns as Array<{ field?: string; valueFormatter?: (p: any) => string }> | undefined)
    ?.find((item) => item.field === field);
  if (!col?.valueFormatter) throw new Error(`missing formatter for ${field}`);
  return col.valueFormatter;
}

function renderPage() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <CompaniesPage />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('CompaniesPage metric cells', () => {
  beforeEach(() => {
    totalsPayload.current = { headcount: 0, it_users: 0, turnover: 332.5, turnover_currency: null };
  });

  afterEach(() => {
    cleanup();
  });

  it('formats decimals in the user language and shows a dash when the metric is absent', async () => {
    await i18n.changeLanguage('fr');
    renderPage();
    expect(column('turnover_year')({ value: 12.5 })).toBe('12,5');
    expect(column('turnover_year')({ value: null })).toBe('—');
    expect(column('headcount_year')({ value: null })).toBe('—');
    expect(column('it_users_year')({ value: 0 })).toBe('0');
    expect(column('headcount_year')({ value: 1200 })).toContain('200');
    await waitFor(() => {
      const pinned = grid.props?.pinnedBottomRowData?.[0];
      expect(column('turnover_year')({ value: pinned?.turnover_year })).toBe('332,5');
    });
  });

  it('shows a dash on the pinned turnover total when the year has no turnover', async () => {
    await i18n.changeLanguage('fr');
    totalsPayload.current = { headcount: 4, it_users: 2, turnover: null, turnover_currency: 'EUR' };
    renderPage();
    await waitFor(() => {
      const pinned = grid.props?.pinnedBottomRowData?.[0];
      expect(pinned?.turnover_year).toBeNull();
      expect(pinned?.headcount_year).toBe(4);
      expect(pinned?.it_users_year).toBe(2);
    });
    const pinned = grid.props?.pinnedBottomRowData?.[0];
    expect(column('turnover_year')({
      value: pinned?.turnover_year,
      node: { rowPinned: 'bottom' },
      data: pinned,
    })).toBe('—');
  });

  it('shows a dash on every pinned total when the year has no metrics', async () => {
    await i18n.changeLanguage('fr');
    totalsPayload.current = { headcount: null, it_users: null, turnover: null, turnover_currency: 'EUR' };
    renderPage();
    await waitFor(() => {
      const pinned = grid.props?.pinnedBottomRowData?.[0];
      expect(pinned?.headcount_year).toBeNull();
      expect(pinned?.it_users_year).toBeNull();
      expect(pinned?.turnover_year).toBeNull();
    });
    const pinned = grid.props?.pinnedBottomRowData?.[0];
    expect(column('headcount_year')({ value: pinned?.headcount_year })).toBe('—');
    expect(column('it_users_year')({ value: pinned?.it_users_year })).toBe('—');
    expect(column('turnover_year')({
      value: pinned?.turnover_year,
      node: { rowPinned: 'bottom' },
      data: pinned,
    })).toBe('—');
  });

  it('keeps an entered zero on the pinned turnover total', async () => {
    await i18n.changeLanguage('fr');
    totalsPayload.current = { headcount: 4, it_users: 2, turnover: 0, turnover_currency: 'EUR' };
    renderPage();
    await waitFor(() => {
      expect(grid.props?.pinnedBottomRowData?.[0]?.turnover_year).toBe(0);
    });
    const pinned = grid.props?.pinnedBottomRowData?.[0];
    // The i18n mock returns the key. The point is the currency suffix, not a bare dash.
    expect(column('turnover_year')({
      value: pinned?.turnover_year,
      node: { rowPinned: 'bottom' },
      data: pinned,
    })).toBe('ops:shared.turnoverMillions');
  });
});
