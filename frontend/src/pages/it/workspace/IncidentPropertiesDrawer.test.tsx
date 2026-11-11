import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import i18n from '../../../i18n';
import IncidentPropertiesDrawer, { type IncidentDrawerValues } from './IncidentPropertiesDrawer';

// The properties selects take their row label as accessible name. An empty category reads
// "No category" in the interface language.

vi.mock('../../../components/fields/UserSelect', () => ({ default: () => null }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    byField: { incidentCategories: [{ code: 'availability', label: 'Availability', deprecated: false }] },
    labelFor: (_field: string, code: string) => code,
  }),
}));

const EMPTY: IncidentDrawerValues = {
  category: null,
  severity: 'minor',
  status: 'open',
  started_at: null,
  detected_at: '2026-11-01T08:00:00.000Z',
  resolved_at: null,
  closed_at: null,
  reporter_user_id: null,
  owner_user_id: null,
  source_ref: null,
  personal_data_affected: false,
  authority_notification_required: false,
  confidential: false,
  authority_notified_at: null,
  notified_parties: null,
};

const COPY = {
  en: { category: 'Category', empty: 'No category', severity: 'Severity', status: 'Status' },
  fr: { category: 'Catégorie', empty: 'Aucune catégorie', severity: 'Gravité', status: 'Statut' },
  de: { category: 'Kategorie', empty: 'Keine Kategorie', severity: 'Schweregrad', status: 'Status' },
  es: { category: 'Categoría', empty: 'Sin categoría', severity: 'Gravedad', status: 'Estado' },
} as const;

function renderDrawer(values: IncidentDrawerValues = EMPTY) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <IncidentPropertiesDrawer values={values} onChange={vi.fn()} />
    </ThemeProvider>,
  );
}

describe('Incident properties selects', () => {
  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it.each(Object.entries(COPY))('names the selects and shows the empty category in %s', async (locale, labels) => {
    await i18n.changeLanguage(locale);
    renderDrawer();
    expect(screen.getByRole('combobox', { name: labels.category })).toHaveTextContent(labels.empty);
    expect(screen.getByRole('combobox', { name: labels.severity })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: labels.status })).toBeTruthy();
  });

  it('keeps the category name when a category is chosen', async () => {
    await i18n.changeLanguage('en');
    renderDrawer({ ...EMPTY, category: 'availability' });
    expect(screen.getByRole('combobox', { name: 'Category' })).toHaveTextContent('Availability');
  });
});
