import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import i18n from '../i18n';

const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));

vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../lib/listContext', () => ({
  getWithListContext: vi.fn(async () => ({
    data: {
      headcount: 2,
      it_users: 1,
      turnover: 12.5,
      turnover_currency: 'EUR',
      turnover_fx_missing: [{ currency: 'ZAR', year: 2026, companies: 1 }],
    },
  })),
}));
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    return props.footer ?? null;
  },
}));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../components/DeleteSelectedButton', () => ({ default: () => null }));

import CompaniesPage from './CompaniesPage';

describe('CompaniesPage turnover without a rate', () => {
  it('shows the reporting total with a mark and a notice that links to the pair', async () => {
    await i18n.changeLanguage('fr');
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <CompaniesPage />
        </MemoryRouter>
      </ThemeProvider>,
    );

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent(
      "Chiffre d'affaires sans taux de change exclu du total : ZAR 2026 (1 société).",
    );
    expect(screen.getByRole('link', { name: 'Saisir un taux' })).toHaveAttribute(
      'href',
      '/ops/operations/currency?currency=ZAR&year=2026',
    );

    await waitFor(() => {
      const pinned = grid.props?.pinnedBottomRowData?.[0];
      expect(pinned?.turnover_fx_missing).toEqual([{ currency: 'ZAR', year: 2026, companies: 1 }]);
    });
    const props = grid.props;
    if (!props) throw new Error('missing grid');
    const column = (props.columns as Array<Record<string, any>>).find((col) => col.field === 'turnover_year');
    if (!column) throw new Error('missing turnover column');
    const pinned = props.pinnedBottomRowData[0];
    expect(column.valueFormatter({ value: pinned.turnover_year, node: { rowPinned: 'bottom' }, data: pinned })).toBe('12,5 M EUR');
    const selected = column.cellRendererSelector({ node: { rowPinned: 'bottom' }, data: pinned });
    const { container } = render(
      <MemoryRouter>
        <selected.component valueFormatted="12,5 M EUR" />
      </MemoryRouter>,
    );
    expect(container).toHaveTextContent('12,5 M EUR');
    expect(screen.getByRole('img', { name: 'Pas de taux de change ZAR pour 2026 : exclu des totaux.' })).toBeInTheDocument();
  });
});
