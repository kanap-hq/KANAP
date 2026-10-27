import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string, options?: Record<string, unknown>) => (options?.table ? `${key}:${options.table}` : key),
    i18n: { language: 'fr-FR', resolvedLanguage: 'fr' },
  };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../../utils/downloadBlob', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/downloadBlob')>();
  return { ...actual, downloadBlob: vi.fn() };
});

import api from '../../api';
import { downloadBlob } from '../../utils/downloadBlob';
import ReportExportButton from './ReportExportButton';

const get = api.get as unknown as ReturnType<typeof vi.fn>;
const save = downloadBlob as unknown as ReturnType<typeof vi.fn>;

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  return store;
}

function renderButton(props: Partial<React.ComponentProps<typeof ReportExportButton>> = {}) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <ReportExportButton
        url="/portfolio/reports/time-logged/export"
        params={{ months: 6, tz: 'Europe/Paris', teamIds: undefined, projectIds: '' }}
        fileBase="time-logged"
        {...props}
      />
    </ThemeProvider>,
  );
}

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: 'reports.shared.exportTable' }));

describe('ReportExportButton', () => {
  beforeEach(() => {
    get.mockReset();
    save.mockReset();
    get.mockResolvedValue({ data: new Blob(['x']), headers: { 'content-disposition': "attachment; filename=\"time-logged-2026-10-27.xlsx\"" } });
  });
  afterEach(() => {
    Object.defineProperty(window, 'localStorage', { value: undefined, configurable: true });
  });

  it('asks the server for the file with the screen parameters, the format and the screen language, and saves it under its name', async () => {
    stubStorage();
    renderButton();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'reports.shared.exportXlsx' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(get).toHaveBeenCalledWith('/portfolio/reports/time-logged/export', {
      params: { months: 6, tz: 'Europe/Paris', format: 'xlsx', language: 'fr' },
      responseType: 'blob',
    });
    expect(save.mock.calls[0][1]).toBe('time-logged-2026-10-27.xlsx');
  });

  it('remembers the format chosen last and highlights it', async () => {
    const store = stubStorage({ 'kanap.exportFormat': 'xlsx' });
    renderButton();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'reports.shared.exportXlsx' })).toHaveClass('Mui-selected');
    expect(screen.getByRole('menuitem', { name: 'reports.shared.exportCsv' })).not.toHaveClass('Mui-selected');
    fireEvent.click(screen.getByRole('menuitem', { name: 'reports.shared.exportCsv' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(store.get('kanap.exportFormat')).toBe('csv');
    expect(get.mock.calls[0][1].params.format).toBe('csv');
  });

  it('offers one CSV per table when the report has several, and sends the table', async () => {
    stubStorage();
    renderButton({ tables: [{ key: 'people', label: 'People' }, { key: 'teams', label: 'Teams' }] });
    openMenu();
    expect(screen.queryByRole('menuitem', { name: 'reports.shared.exportCsv' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'reports.shared.exportCsvTable:Teams' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(get.mock.calls[0][1].params).toMatchObject({ format: 'csv', table: 'teams' });
  });

  it('works when the browser storage throws, and names the file itself when the server gives no name', async () => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new Error('denied'); },
    });
    get.mockResolvedValue({ data: new Blob(['x']), headers: {} });
    renderButton();
    openMenu();
    expect(screen.getByRole('menuitem', { name: 'reports.shared.exportCsv' })).toHaveClass('Mui-selected');
    fireEvent.click(screen.getByRole('menuitem', { name: 'reports.shared.exportCsv' }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0][1]).toBe('time-logged.csv');
  });

  it('says so when the export fails', async () => {
    stubStorage();
    get.mockRejectedValue(new Error('400'));
    renderButton();
    openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'reports.shared.exportCsv' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('reports.shared.exportFailed');
    expect(save).not.toHaveBeenCalled();
  });

  it('is disabled while the report loads', () => {
    stubStorage();
    renderButton({ disabled: true });
    expect(screen.getByRole('button', { name: 'reports.shared.exportTable' })).toBeDisabled();
  });
});
