import React from 'react';
import { render, screen } from '@testing-library/react';
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
