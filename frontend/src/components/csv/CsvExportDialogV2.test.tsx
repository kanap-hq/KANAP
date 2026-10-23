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
  afterEach(() => vi.restoreAllMocks());

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
});
