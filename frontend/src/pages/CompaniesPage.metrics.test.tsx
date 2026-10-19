import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'fr', resolvedLanguage: 'fr' } }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'fr' }));
vi.mock('../lib/listContext', () => ({
  getWithListContext: vi.fn(async () => ({ data: { headcount: 0, it_users: 0, turnover: 332.5 } })),
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
  const col = (grid.props?.columns as Array<{ field?: string; valueFormatter?: (p: { value: unknown }) => string }> | undefined)
    ?.find((item) => item.field === field);
  if (!col?.valueFormatter) throw new Error(`missing formatter for ${field}`);
  return col.valueFormatter;
}

describe('CompaniesPage metric cells', () => {
  it('formats decimals in the user language and shows a dash when the metric is absent', async () => {
    await i18n.changeLanguage('fr');
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <CompaniesPage />
        </MemoryRouter>
      </ThemeProvider>,
    );
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
});
