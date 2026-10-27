import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  const translation = { t, i18n: { language: 'fr-FR', resolvedLanguage: 'fr' } };
  return { useTranslation: () => translation };
});

vi.mock('../../api', () => ({ default: { get: vi.fn() } }));

import api from '../../api';
import CsvExportDialogV2 from './CsvExportDialogV2';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

describe('CsvExportDialogV2', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async (url: string) => (
      url.endsWith('/csv-fields')
        ? { data: { fields: [{ csvColumn: 'name', exportable: true, importable: true }], presets: [] } }
        : { data: 'name\n', headers: {} }
    ));
    Object.assign(window.URL, { createObjectURL: vi.fn(() => 'blob:export'), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const stubStorage = (initial: Record<string, string> = {}) => {
    const store = new Map(Object.entries(initial));
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
    });
    return store;
  };

  it('writes the file in the screen language, and says so', async () => {
    render(<CsvExportDialogV2 open onClose={() => undefined} endpoint="/assets" />);
    expect(await screen.findByText('csv.exportDescriptionFlexible')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'csv.exportData' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/export', expect.objectContaining({
      params: expect.objectContaining({ scope: 'data', language: 'fr' }),
    })));
  });

  it('sends the filters of the list and says which rows the file holds', async () => {
    render(
      <CsvExportDialogV2
        open
        onClose={() => undefined}
        endpoint="/applications"
        params={{ q: 'erp', filters: '{"lifecycle":{"filterType":"set","values":["active"]}}', ownerUserId: 'u1' }}
        scopeSummary="6 applications, following the filters of the list."
      />,
    );
    expect(await screen.findByText('6 applications, following the filters of the list.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'csv.exportData' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/applications/export', expect.objectContaining({
      params: expect.objectContaining({ q: 'erp', ownerUserId: 'u1', scope: 'data', filters: expect.stringContaining('lifecycle') }),
    })));
  });
  it('offers CSV or Excel, sends the choice and remembers it', async () => {
    const store = stubStorage();
    get.mockImplementation(async (url: string) => (
      url.endsWith('/csv-fields')
        ? { data: { fields: [{ csvColumn: 'name', exportable: true, importable: true }], presets: [] } }
        : { data: new Blob(['xlsx']), headers: {} }
    ));
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
    render(<CsvExportDialogV2 open onClose={() => undefined} endpoint="/portfolio/projects" params={{ rows: 'list', q: 'alpha' }} />);
    expect(await screen.findByText('ops:operations.budgetFile.format')).toBeInTheDocument();
    const csv = screen.getByRole('radio', { name: 'ops:operations.budgetFile.formatCsv' });
    const xlsx = screen.getByRole('radio', { name: 'ops:operations.budgetFile.formatXlsx' });
    expect(csv).toBeChecked();
    expect(screen.getByText('csv.exportDescriptionFlexible')).toBeInTheDocument();
    fireEvent.click(xlsx);
    expect(xlsx).toBeChecked();
    expect(store.get('kanap.exportFormat')).toBe('xlsx');
    expect(screen.queryByText('csv.exportDescriptionFlexible')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'csv.exportData' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/portfolio/projects/export', expect.objectContaining({
      params: expect.objectContaining({ rows: 'list', q: 'alpha', scope: 'data', format: 'xlsx' }),
    })));
    await waitFor(() => expect(clicked).toEqual(['data.xlsx']));
  });

  it('opens on the format chosen last in any export dialog, and sends no format for CSV', async () => {
    stubStorage({ 'kanap.exportFormat': 'xlsx' });
    render(<CsvExportDialogV2 open onClose={() => undefined} endpoint="/tasks" />);
    expect(await screen.findByRole('radio', { name: 'ops:operations.budgetFile.formatXlsx' })).toBeChecked();
    fireEvent.click(screen.getByRole('radio', { name: 'ops:operations.budgetFile.formatCsv' }));
    fireEvent.click(screen.getByRole('button', { name: 'csv.exportData' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/tasks/export', expect.anything()));
    const exportCall = get.mock.calls.find(([url]) => url === '/tasks/export');
    expect(exportCall?.[1]?.params?.format).toBeUndefined();
  });
});
