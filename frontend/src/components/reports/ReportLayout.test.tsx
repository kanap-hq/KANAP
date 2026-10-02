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

import ReportLayout from './ReportLayout';

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

describe('ReportLayout breadcrumb', () => {
  it('defaults to the reporting hub, with its translated title', () => {
    renderLayout();
    const root = screen.getByRole('link', { name: 'reports.landing.title' });
    expect(root).toHaveAttribute('href', '/ops/reports');
    expect(screen.queryByText('Reporting')).toBeNull();
  });

  it('uses the root a page passes', () => {
    renderLayout({ rootTo: '/ops/operations', rootLabel: 'Administration' });
    expect(screen.getByRole('link', { name: 'Administration' })).toHaveAttribute('href', '/ops/operations');
  });
});

describe('ReportLayout busy', () => {
  it('dims the report but not its status line, and holds the exports and the print while the numbers load', () => {
    const { container, rerender } = render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <ReportLayout title="Top items" busy onExportTableCsv={() => undefined} onExportChartPng={() => undefined}>
            <div data-testid="report">chart</div>
            <p className="report-data-status">loading</p>
          </ReportLayout>
        </MemoryRouter>
      </ThemeProvider>,
    );
    for (const name of ['reports.shared.exportTableCsv', 'reports.shared.exportChartPng', 'reports.shared.printReport']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    const content = container.querySelector('[aria-busy="true"]') as HTMLElement;
    expect(within(content).getByTestId('report')).toHaveStyle({ opacity: '0.45' });
    expect(within(content).getByText('loading')).not.toHaveStyle({ opacity: '0.45' });

    rerender(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <ReportLayout title="Top items" onExportTableCsv={() => undefined} onExportChartPng={() => undefined}>
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
