import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import deMasterData from '../../../locales/de/master-data.json';
import deOps from '../../../locales/de/ops.json';
import enMasterData from '../../../locales/en/master-data.json';
import enOps from '../../../locales/en/ops.json';
import esMasterData from '../../../locales/es/master-data.json';
import esOps from '../../../locales/es/ops.json';
import frMasterData from '../../../locales/fr/master-data.json';
import frOps from '../../../locales/fr/ops.json';
import { copyMasterData } from '../../../services/masterDataOperations';
import MasterDataCopyPage, { copyEntityLabel, copyStatusLabel } from './MasterDataCopyPage';

function opsT(ops: { reports: { shared: { unknownDepartment: string; unknownCompany: string } } }) {
  return (key: string) => {
    if (key === 'ops:reports.shared.unknownDepartment') return ops.reports.shared.unknownDepartment;
    if (key === 'ops:reports.shared.unknownCompany') return ops.reports.shared.unknownCompany;
    return key;
  };
}

function statusT(masterData: { admin: { copy: { status: {
  noDataForSourceYear: string;
  failedToCopyMetrics: string;
  skipped: string;
  readyToCopy: string;
} } } }) {
  const status = masterData.admin.copy.status;
  return (key: string) => {
    if (key === 'admin.copy.status.noDataForSourceYear') return status.noDataForSourceYear;
    if (key === 'admin.copy.status.failedToCopyMetrics') return status.failedToCopyMetrics;
    if (key === 'admin.copy.status.skipped') return status.skipped;
    if (key === 'admin.copy.status.readyToCopy') return status.readyToCopy;
    return key;
  };
}

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

describe('MasterDataCopyPage export', () => {
  it('offers the server export of the preview, held once the copy has run', async () => {
    const answer = { success: true, dryRun: false, summary: { totalItems: 0, processed: 0, skipped: 0, errors: 0 }, results: [], errors: [] };
    vi.mocked(copyMasterData).mockResolvedValue(answer as never);
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MasterDataCopyPage />
      </ThemeProvider>,
    );
    const exportButton = screen.getByRole('button', { name: 'reports.shared.exportTable' });
    expect(exportButton).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'admin.copy.dryRunBtn' }));
    await waitFor(() => expect(copyMasterData).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole('button', { name: 'admin.copy.copyDataBtn' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'reports.shared.exportTable' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'admin.copy.copyDataBtn' }));
    await waitFor(() => expect(copyMasterData).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'reports.shared.exportTable' })).toBeDisabled());
  });
});

describe('copyEntityLabel', () => {
  it('words a department with no name in each language', () => {
    const row = { entityType: 'department' as const, entityName: null };
    expect(copyEntityLabel(opsT(frOps), row)).toBe('Département inconnu');
    expect(copyEntityLabel(opsT(deOps), row)).toBe('Unbekannte Abteilung');
    expect(copyEntityLabel(opsT(esOps), row)).toBe('Departamento desconocido');
    expect(copyEntityLabel(opsT(enOps), row)).toBe('Unknown department');
    expect(copyEntityLabel(opsT(frOps), { entityType: 'department', entityName: '  ' })).toBe('Département inconnu');
    expect(copyEntityLabel(opsT(enOps), { entityType: 'department', entityName: 'Finance (Fromage)' })).toBe('Finance (Fromage)');
    expect(copyEntityLabel(opsT(enOps), { entityType: 'company', entityName: 'Fromage' })).toBe('Fromage');
  });

  it('words a company with no name in each language', () => {
    const row = { entityType: 'company' as const, entityName: null };
    expect(copyEntityLabel(opsT(frOps), row)).toBe('Société inconnue');
    expect(copyEntityLabel(opsT(deOps), row)).toBe('Unbekanntes Unternehmen');
    expect(copyEntityLabel(opsT(esOps), row)).toBe('Empresa desconocida');
    expect(copyEntityLabel(opsT(enOps), row)).toBe('Unknown company');
    expect(copyEntityLabel(opsT(frOps), { entityType: 'company', entityName: '  ' })).toBe('Société inconnue');
    expect(copyEntityLabel(opsT(frOps), row)).not.toBe('Unknown company');
  });
});

describe('copyStatusLabel', () => {
  it('words skip reasons in French and keeps the English sentences out', () => {
    const t = statusT(frMasterData);
    const noData = copyStatusLabel(t, 'no_data_for_source_year');
    const failed = copyStatusLabel(t, 'failed_to_copy_metrics');
    expect(noData).toBe("Aucune donnée pour l'année source");
    expect(failed).toBe('Échec de la copie des indicateurs');
    expect(frMasterData.admin.copy.status.noDataForSourceYear).toBe(noData);
    expect(frMasterData.admin.copy.status.failedToCopyMetrics).toBe(failed);
    expect(noData).not.toBe('No data for source year');
    expect(failed).not.toBe('Failed to copy metrics');
    expect(noData).not.toContain('No data');
    expect(failed).not.toContain('Failed to copy');
    expect(copyStatusLabel(t, 'No data for source year')).toBe('Ignoré');
    expect(copyStatusLabel(t, 'Failed to copy metrics')).toBe('Ignoré');
    expect(copyStatusLabel(t, null)).toBe('Ignoré');
  });

  it('words the same codes in German, Spanish and English', () => {
    expect(copyStatusLabel(statusT(deMasterData), 'no_data_for_source_year')).toBe('Keine Daten für das Quelljahr');
    expect(copyStatusLabel(statusT(deMasterData), 'failed_to_copy_metrics')).toBe('Die Kennzahlen konnten nicht kopiert werden');
    expect(copyStatusLabel(statusT(esMasterData), 'no_data_for_source_year')).toBe('No hay datos para el año de origen');
    expect(copyStatusLabel(statusT(esMasterData), 'failed_to_copy_metrics')).toBe('No se pudieron copiar los indicadores');
    expect(copyStatusLabel(statusT(enMasterData), 'no_data_for_source_year')).toBe('No data for source year');
    expect(copyStatusLabel(statusT(enMasterData), 'failed_to_copy_metrics')).toBe('Failed to copy metrics');
    expect(deMasterData.admin.copy.status.noDataForSourceYear).not.toBe(enMasterData.admin.copy.status.noDataForSourceYear);
    expect(esMasterData.admin.copy.status.failedToCopyMetrics).not.toBe(enMasterData.admin.copy.status.failedToCopyMetrics);
  });
});
