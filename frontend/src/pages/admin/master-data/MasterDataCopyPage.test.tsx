import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('ag-grid-react', () => ({ AgGridReact: () => null }));
vi.mock('../../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../../hooks/useFreezeState', () => ({ useFreezeState: () => ({ data: undefined, isLoading: false }) }));
vi.mock('../../../services/masterDataOperations', () => ({ copyMasterData: vi.fn() }));
vi.mock('../../../components/AgGridBox', () => ({ default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../../components/reports/ReportLayout', () => ({
  default: ({ children, rootTo, rootLabel }: { children: React.ReactNode; rootTo?: string; rootLabel?: string }) => (
    <div><a data-testid="breadcrumb-root" href={rootTo}>{rootLabel}</a>{children}</div>
  ),
}));

import MasterDataCopyPage from './MasterDataCopyPage';

describe('MasterDataCopyPage breadcrumb', () => {
  it('roots at the budget administration page, with its label', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MasterDataCopyPage />
      </ThemeProvider>,
    );
    const root = screen.getByTestId('breadcrumb-root');
    expect(root).toHaveAttribute('href', '/ops/operations');
    expect(root).toHaveTextContent('ops:operations.title');
  });
});
