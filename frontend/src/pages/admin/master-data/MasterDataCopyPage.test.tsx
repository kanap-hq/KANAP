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
import deOps from '../../../locales/de/ops.json';
import enOps from '../../../locales/en/ops.json';
import esOps from '../../../locales/es/ops.json';
import frOps from '../../../locales/fr/ops.json';
import MasterDataCopyPage, { copyEntityLabel } from './MasterDataCopyPage';

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

describe('copyEntityLabel', () => {
  const t = (label: string) => (key: string) => (key === 'ops:reports.shared.unknownDepartment' ? label : key);

  it('words a department with no name in each language', () => {
    const row = { entityType: 'department' as const, entityName: null };
    expect(copyEntityLabel(t(frOps.reports.shared.unknownDepartment), row)).toBe('Département inconnu');
    expect(copyEntityLabel(t(deOps.reports.shared.unknownDepartment), row)).toBe('Unbekannte Abteilung');
    expect(copyEntityLabel(t(esOps.reports.shared.unknownDepartment), row)).toBe('Departamento desconocido');
    expect(copyEntityLabel(t(enOps.reports.shared.unknownDepartment), row)).toBe('Unknown department');
    expect(copyEntityLabel(t(frOps.reports.shared.unknownDepartment), { entityType: 'department', entityName: '  ' })).toBe('Département inconnu');
    expect(copyEntityLabel(t('unused'), { entityType: 'department', entityName: 'Finance (Fromage)' })).toBe('Finance (Fromage)');
    expect(copyEntityLabel(t('unused'), { entityType: 'company', entityName: 'Fromage' })).toBe('Fromage');
    expect(copyEntityLabel(t('unused'), { entityType: 'company', entityName: null })).toBe('');
  });
});
