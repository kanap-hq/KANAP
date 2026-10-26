import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import i18next from 'i18next';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import en from '../../locales/en/common.json';
import fr from '../../locales/fr/common.json';
import de from '../../locales/de/common.json';
import es from '../../locales/es/common.json';
import type { CsvImportResult } from './csv.types';

// The real strings: the counters must change tense, and the done tense must pluralise.
const instance = i18next.createInstance();
void instance.init({
  lng: 'en',
  resources: {
    en: { common: en },
    fr: { common: fr },
    de: { common: de },
    es: { common: es },
  },
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  initImmediate: false,
});
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => instance.t(key, options),
    i18n: { language: instance.language, resolvedLanguage: instance.language },
  }),
}));

import { CsvValidationResults } from './CsvValidationResults';

const base: CsvImportResult = {
  ok: true,
  dryRun: true,
  total: 3,
  inserted: 2,
  updated: 1,
  skipped: 0,
  errors: [],
  warnings: [],
};

function show(result: CsvImportResult) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <CsvValidationResults result={result} />
    </ThemeProvider>,
  );
}

describe('CsvValidationResults counters', () => {
  it('keeps the future tense on a dry run and the done tense after the write', async () => {
    await instance.changeLanguage('en');
    const dryRun = show(base);
    expect(screen.getByText('Validation passed. Ready to import 3 rows.')).toBeInTheDocument();
    expect(screen.getByText('2 to insert')).toBeInTheDocument();
    expect(screen.getByText('1 to update')).toBeInTheDocument();
    dryRun.unmount();

    show({ ...base, dryRun: false });
    expect(screen.getByText('Import completed successfully.')).toBeInTheDocument();
    expect(screen.getByText('2 created')).toBeInTheDocument();
    expect(screen.getByText('1 updated')).toBeInTheDocument();
    expect(screen.queryByText('2 to insert')).not.toBeInTheDocument();
    expect(screen.queryByText('1 to update')).not.toBeInTheDocument();
  });

  it('pluralises both tenses', async () => {
    const cases: Array<[string, boolean, number, number, string, string]> = [
      ['fr', true, 2, 1, '2 à insérer', '1 à mettre à jour'],
      ['fr', false, 2, 1, '2 créées', '1 mise à jour'],
      ['fr', false, 1, 2, '1 créée', '2 mises à jour'],
      ['de', false, 1, 2, '1 erstellt', '2 aktualisiert'],
      ['es', false, 1, 2, '1 creada', '2 actualizadas'],
      ['es', false, 2, 1, '2 creadas', '1 actualizada'],
      ['en', false, 1, 1, '1 created', '1 updated'],
    ];
    for (const [lng, dryRun, inserted, updated, createdText, updatedText] of cases) {
      await instance.changeLanguage(lng);
      const view = show({ ...base, dryRun, inserted, updated, total: inserted + updated });
      expect(screen.getByText(createdText)).toBeInTheDocument();
      expect(screen.getByText(updatedText)).toBeInTheDocument();
      view.unmount();
    }
  });
});
