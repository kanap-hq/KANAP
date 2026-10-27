import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  // A stable `t` that returns the key, so the tests read which string is shown.
  const t = (key: string) => key;
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const features = vi.hoisted(() => ({ importXlsx: false }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features }, isLoading: false }) }));

import api from '../../api';
import CsvImportDialogV2 from './CsvImportDialogV2';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

function renderDialog() {
  const view = render(<CsvImportDialogV2 open onClose={() => undefined} endpoint="/portfolio/projects" />);
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(['name'], 'projects.csv', { type: 'text/csv' })] } });
  return view;
}

const ENCODING_ERROR = 'This file is not UTF-8 or Windows-1252.';

describe('CsvImportDialogV2', () => {
  beforeEach(() => {
    post.mockReset();
    get.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('shows the server message when the validation request is refused', async () => {
    post.mockRejectedValueOnce({ response: { status: 400, data: { statusCode: 400, message: ENCODING_ERROR } } });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.validate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(ENCODING_ERROR);
  });

  it('shows a fallback when the request fails without a message', async () => {
    post.mockRejectedValueOnce({ response: { status: 500, data: {} } });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.validate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('messages.importFailed');
  });

  it('shows the server message when the template download fails', async () => {
    // A 403 without a code reads as the missing-right sentence (apiErrorMessage): a 400 keeps the server words.
    const body = new Blob([JSON.stringify({ statusCode: 400, message: 'Insufficient permission' })], { type: 'application/json' });
    get.mockRejectedValueOnce({ response: { status: 400, data: body } });
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'csv.downloadTemplate' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Insufficient permission');
  });

  it('names the workflow presets and the validate step buttons through i18n', async () => {
    post.mockResolvedValueOnce({
      data: {
        ok: false,
        dryRun: true,
        total: 1,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: [{ row: 2, message: 'Name is required' }],
        warnings: [],
      },
    });
    renderDialog();
    expect(screen.getByText('csv.workflowPresets.merge.label')).toBeInTheDocument();
    expect(screen.getByText('csv.workflowPresets.fullReplace.description')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'buttons.validate' }));
    expect(await screen.findByText('csv.validationFailed')).toBeInTheDocument();
    expect(screen.getByText('csv.rowPrefix')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'buttons.cancel' })).toBeInTheDocument();
  });

  it('takes CSV files only while the server reads no workbook, and both while it does', () => {
    const { unmount } = render(<CsvImportDialogV2 open onClose={() => undefined} endpoint="/portfolio/projects" />);
    expect((document.querySelector('input[type="file"]') as HTMLInputElement).accept).toBe('.csv,text/csv');
    expect(screen.getByText('csv.importTitle')).toBeInTheDocument();
    unmount();
    features.importXlsx = true;
    try {
      render(<CsvImportDialogV2 open onClose={() => undefined} endpoint="/portfolio/projects" />);
      const accept = (document.querySelector('input[type="file"]') as HTMLInputElement).accept;
      expect(accept.split(',')).toEqual(expect.arrayContaining(['.csv', '.xlsx']));
      expect(screen.getByText('buttons.import')).toBeInTheDocument();
      expect(screen.getByText('csv.uploadDescriptionFlexibleWorkbook')).toBeInTheDocument();
      expect(screen.getByText('csv.dragDropFileOrClick')).toBeInTheDocument();
    } finally {
      features.importXlsx = false;
    }
  });
});
