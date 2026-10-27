import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
const features = vi.hoisted(() => ({ importXlsx: false }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features }, isLoading: false }) }));

import { ImportLabel } from './importFiles';

describe('ImportLabel', () => {
  it('keeps the CSV label while the server reads no workbook, and says Import while it does', () => {
    const { unmount } = render(<button type="button"><ImportLabel csv="Import CSV" /></button>);
    expect(screen.getByRole('button', { name: 'Import CSV' })).toBeInTheDocument();
    unmount();
    features.importXlsx = true;
    render(<button type="button"><ImportLabel csv="Import CSV" /></button>);
    expect(screen.getByRole('button', { name: 'common:buttons.import' })).toBeInTheDocument();
    features.importXlsx = false;
  });
});
