import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => false }) }));

import ReportLayout from './ReportLayout';

const TABLE_EXPORT = { url: '/portfolio/reports/time-logged/export', params: {}, fileBase: 'time-logged' };

function renderLayout(props: Partial<React.ComponentProps<typeof ReportLayout>> = {}) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        <ReportLayout title="Top items" {...props}>
          <div />
        </ReportLayout>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('ReportLayout header', () => {
  it('shows the title and the subtitle, with no breadcrumb', () => {
    const { container } = renderLayout({ subtitle: 'What the report shows' });
    expect(container.querySelector('nav[aria-label="breadcrumb"]')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('Top items')).toBeTruthy();
    expect(screen.getByText('What the report shows')).toBeTruthy();
  });
});

describe('ReportLayout busy', () => {
  it('dims the report but not its status line, and holds the exports and the print while the numbers load', () => {
    const { container, rerender } = render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <ReportLayout title="Top items" busy tableExport={TABLE_EXPORT} onExportChartPng={() => undefined}>
            <div data-testid="report">chart</div>
            <p className="report-data-status">loading</p>
          </ReportLayout>
        </MemoryRouter>
      </ThemeProvider>,
    );
    for (const name of ['reports.shared.exportTable', 'reports.shared.exportChartPng', 'reports.shared.printReport']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    const content = container.querySelector('[aria-busy="true"]') as HTMLElement;
    expect(within(content).getByTestId('report')).toHaveStyle({ opacity: '0.45' });
    expect(within(content).getByText('loading')).not.toHaveStyle({ opacity: '0.45' });

    rerender(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <ReportLayout title="Top items" tableExport={TABLE_EXPORT} onExportChartPng={() => undefined}>
            <div data-testid="report">chart</div>
          </ReportLayout>
        </MemoryRouter>
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'reports.shared.printReport' })).toBeEnabled();
    expect(container.querySelector('[aria-busy]')).toBeNull();
    expect(screen.getByTestId('report')).toHaveStyle({ opacity: '1' });
  });
});

describe('ReportLayout table export', () => {
  it('shows the server export, held while the numbers load', () => {
    renderLayout({ busy: true, tableExport: TABLE_EXPORT });
    expect(screen.getByRole('button', { name: 'reports.shared.exportTable' })).toBeDisabled();
  });

  it('holds the export the page disables (an operation that has run)', () => {
    renderLayout({ tableExport: { ...TABLE_EXPORT, disabled: true } });
    expect(screen.getByRole('button', { name: 'reports.shared.exportTable' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'reports.shared.printReport' })).toBeEnabled();
  });
});
