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
import MasterDataCopyPage from './MasterDataCopyPage';

describe('MasterDataCopyPage header', () => {
  it('shows its title and subtitle, with no breadcrumb', () => {
    const { container } = render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MasterDataCopyPage />
      </ThemeProvider>,
    );
    expect(container.querySelector('nav[aria-label="breadcrumb"]')).toBeNull();
    expect(screen.getByText('admin.copy.title')).toBeTruthy();
    expect(screen.getByText('admin.copy.subtitle')).toBeTruthy();
  });
});
