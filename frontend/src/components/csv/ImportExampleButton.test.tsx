import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  const translation = { t, i18n: { language: 'fr', resolvedLanguage: 'fr' } };
  return { useTranslation: () => translation };
});

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../utils/downloadBlob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/downloadBlob')>()),
  downloadBlob: vi.fn(),
}));
const features = vi.hoisted(() => ({ importXlsx: false }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features }, isLoading: false }) }));

import api from '../../api';
import { downloadBlob } from '../../utils/downloadBlob';
import CsvImportDialogV2 from './CsvImportDialogV2';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

describe('ImportExampleButton', () => {
  beforeEach(() => {
    get.mockReset();
    vi.mocked(downloadBlob).mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('downloads the example of the import in the screen language, next to the template', async () => {
    const blob = new Blob(['xlsx']);
    get.mockResolvedValueOnce({ data: blob, headers: { 'content-disposition': 'attachment; filename="applications-exemple.xlsx"' } });
    render(<CsvImportDialogV2 open onClose={() => undefined} endpoint="/applications" example="applications" />);
    expect(screen.getByRole('button', { name: 'csv.downloadTemplate' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'csv.downloadExample' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, 'applications-exemple.xlsx'));
    expect(get).toHaveBeenCalledWith('/import-examples/applications', { params: { language: 'fr' }, responseType: 'blob' });
  });

  it('shows the refusal in the dialog', async () => {
    get.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    render(<CsvImportDialogV2 open onClose={() => undefined} endpoint="/applications" example="applications" />);
    fireEvent.click(screen.getByRole('button', { name: 'csv.downloadExample' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('messages.exportFailed');
  });

  it('is not offered for an import without an example', () => {
    render(<CsvImportDialogV2 open onClose={() => undefined} endpoint="/portfolio/requests" />);
    expect(screen.queryByRole('button', { name: 'csv.downloadExample' })).toBeNull();
  });
});
