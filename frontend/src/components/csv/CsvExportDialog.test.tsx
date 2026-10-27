import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const t = (key: string, options?: { count?: number; limit?: string; total?: string }) => (
    options?.count !== undefined ? `${key}:${options.count}` : options?.total !== undefined ? `${key}:${options.limit}/${options.total}` : key
  );
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});

vi.mock('../../api', () => ({ default: { get: vi.fn() } }));

import api from '../../api';
import CsvExportDialog from './CsvExportDialog';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

describe('CsvExportDialog', () => {
  const createObjectURL = vi.fn(() => 'blob:export');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    get.mockReset();
    Object.assign(window.URL, { createObjectURL, revokeObjectURL });
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

  it('downloads the file and closes', async () => {
    get.mockResolvedValueOnce({ data: 'name\n', headers: { 'content-disposition': 'attachment; filename="suppliers.csv"' } });
    const onClose = vi.fn();
    render(<CsvExportDialog open onClose={onClose} endpoint="/suppliers" flexibleFormat />);
    fireEvent.click(screen.getByRole('button', { name: 'csv.exportData' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith('/suppliers/export', expect.objectContaining({ params: expect.objectContaining({ scope: 'data' }) }));
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1);
  });

  it('stays open with the error when the export fails', async () => {
    get.mockRejectedValueOnce({ response: { status: 500, data: { message: 'Boom' } } });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onClose = vi.fn();
    render(<CsvExportDialog open onClose={onClose} endpoint="/suppliers" />);
    fireEvent.click(screen.getByRole('button', { name: 'csv.exportData' }));
    expect(await screen.findByText('Boom')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('says what the file holds when the page gives a note', () => {
    render(<CsvExportDialog open onClose={() => undefined} endpoint="/suppliers" note="The whole register is exported." />);
    expect(screen.getByText('The whole register is exported.')).toBeInTheDocument();
  });

  it('exports what the list shows by default, and the whole register on request', async () => {
    get.mockResolvedValue({ data: 'name\n', headers: {} });
    const filters = JSON.stringify({ name: { filterType: 'text', type: 'contains', filter: 'o' } });
    const listRequest = { params: { q: 'ok', sort: 'name:DESC', status: 'enabled', filters }, total: 12 };
    const onClose = vi.fn();
    const { rerender } = render(
      <CsvExportDialog open onClose={onClose} endpoint="/suppliers" title="Export suppliers" listRequest={listRequest} entity="suppliers" flexibleFormat />,
    );
    // The title counts the rows the list shows.
    expect(screen.getByText('csv.exportRows.suppliers:12')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'csv.exportScopeList' })).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'csv.exportData' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenLastCalledWith('/suppliers/export', expect.objectContaining({
      params: { q: 'ok', sort: 'name:DESC', status: 'enabled', filters, language: 'en', scope: 'data', rows: 'list' },
    }));

    // The whole register: no list parameter, the title says so.
    rerender(<CsvExportDialog open={false} onClose={onClose} endpoint="/suppliers" listRequest={listRequest} entity="suppliers" />);
    rerender(<CsvExportDialog open onClose={onClose} endpoint="/suppliers" listRequest={listRequest} entity="suppliers" />);
    fireEvent.click(screen.getByRole('radio', { name: 'csv.exportScopeAll' }));
    expect(screen.getByText('csv.exportAllRows.suppliers')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'csv.exportData' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(2));
    expect(get).toHaveBeenLastCalledWith('/suppliers/export', expect.objectContaining({ params: { language: 'en', scope: 'data' } }));
  });

  it('keeps the page title and the whole register without a list', () => {
    render(<CsvExportDialog open onClose={() => undefined} endpoint="/admin/coa-templates/t1" title="Export template" csvOnly />);
    expect(screen.getByText('Export template')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });

  it('says when the list holds more rows than an export can', () => {
    const big = { params: { sort: 'name:ASC' }, total: 60_000 };
    const { rerender } = render(<CsvExportDialog open onClose={() => undefined} endpoint="/suppliers" listRequest={big} entity="suppliers" />);
    expect(screen.getByText('csv.exportRowLimit:50,000/60,000')).toBeInTheDocument();
    // The whole register is not cut: no warning there.
    fireEvent.click(screen.getByRole('radio', { name: 'csv.exportScopeAll' }));
    expect(screen.queryByText(/csv.exportRowLimit/)).toBeNull();
    rerender(<CsvExportDialog open onClose={() => undefined} endpoint="/suppliers" listRequest={{ ...big, total: 50_000 }} entity="suppliers" />);
    fireEvent.click(screen.getByRole('radio', { name: 'csv.exportScopeList' }));
    expect(screen.queryByText(/csv.exportRowLimit/)).toBeNull();
  });

  it('has nothing to export from an empty list, the whole register still can be', async () => {
    get.mockResolvedValue({ data: 'name\n', headers: {} });
    const onClose = vi.fn();
    render(<CsvExportDialog open onClose={onClose} endpoint="/suppliers" listRequest={{ params: { q: 'zzz' }, total: 0 }} entity="suppliers" />);
    expect(screen.getByText('csv.exportNoRows.suppliers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'csv.exportData' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'csv.exportScopeAll' }));
    expect(screen.getByText('csv.exportAllRows.suppliers')).toBeInTheDocument();
    const button = screen.getByRole('button', { name: 'csv.exportData' });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenLastCalledWith('/suppliers/export', expect.objectContaining({ params: { language: 'en', scope: 'data' } }));
  });

  it('offers CSV or Excel, remembers the choice and sends it with the list', async () => {
    const store = stubStorage();
    get.mockResolvedValue({ data: new Blob(['x']), headers: {} });
    const appended: HTMLAnchorElement[] = [];
    const append = document.body.appendChild.bind(document.body);
    vi.spyOn(document.body, 'appendChild').mockImplementation((node: any) => {
      if (node instanceof HTMLAnchorElement) appended.push(node);
      return append(node);
    });
    const onClose = vi.fn();
    const listRequest = { params: { q: 'ok' }, total: 3 };
    render(<CsvExportDialog open onClose={onClose} endpoint="/suppliers" listRequest={listRequest} entity="suppliers" flexibleFormat />);
    expect(screen.getByRole('radio', { name: 'ops:operations.budgetFile.formatCsv' })).toBeChecked();
    expect(screen.getByText('csv.exportDescriptionFlexible')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'ops:operations.budgetFile.formatXlsx' }));
    expect(store.get('kanap.exportFormat')).toBe('xlsx');
    // The CSV hints (separator, decimal mark) say nothing about a workbook.
    expect(screen.queryByText('csv.exportDescriptionFlexible')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'csv.exportData' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenLastCalledWith('/suppliers/export', expect.objectContaining({
      params: { q: 'ok', language: 'en', scope: 'data', rows: 'list', format: 'xlsx' },
    }));
    // No file name from the server: the fallback has the format's extension.
    expect(appended[appended.length - 1]?.download).toBe('data.xlsx');
  });

  it('opens on the format last chosen in any export dialog', () => {
    stubStorage({ 'kanap.exportFormat': 'xlsx' });
    render(<CsvExportDialog open onClose={() => undefined} endpoint="/contacts" />);
    expect(screen.getByRole('radio', { name: 'ops:operations.budgetFile.formatXlsx' })).toBeChecked();
    expect(screen.queryByText('csv.exportDescription')).toBeNull();
  });

  it('keeps a stored CSV file in CSV, whatever was chosen elsewhere', async () => {
    stubStorage({ 'kanap.exportFormat': 'xlsx' });
    get.mockResolvedValue({ data: 'a\n', headers: {} });
    const onClose = vi.fn();
    render(<CsvExportDialog open onClose={onClose} endpoint="/admin/coa-templates/t1" csvOnly />);
    expect(screen.queryByText('ops:operations.budgetFile.format')).toBeNull();
    expect(screen.getByText('csv.exportDescription')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'csv.exportData' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenLastCalledWith('/admin/coa-templates/t1/export', expect.objectContaining({ params: { language: 'en', scope: 'data' } }));
  });
});
