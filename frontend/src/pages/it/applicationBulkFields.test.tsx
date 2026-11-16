import { fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const translation = vi.hoisted(() => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }));
vi.mock('react-i18next', () => ({ useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => {} } }));
vi.mock('../../utils/applicationClassification', () => ({ classificationText: (source: string) => source }));
vi.mock('../../components/fields/UserMultiSelect', () => ({ default: () => null }));

const options = vi.hoisted(() => ({
  byField: {
    lifecycleStatus: [{ code: 'active', label: 'Active' }],
    applicationCategory: [
      { code: 'analytics', label: 'Analytique' },
      { code: 'infrastructure', label: 'Infrastructure' },
      { code: 'legacy_tools', label: 'Outils anciens', deprecated: true },
      { code: 'atelier', label: 'Atelier' },
    ],
  },
}));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({ default: () => options }));
const catalog = vi.hoisted(() => ({
  data: {
    businessCriticalityLevels: [{ code: 'high', label: 'Élevée' }],
    cyberCriticalityLevels: [
      { code: 'critical', label: 'Critique' },
      { code: 'high', label: 'Élevée' },
      { code: 'old', label: 'Ancien niveau', deprecated: true },
    ],
  },
}));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({ default: () => catalog }));

import { useApplicationBulkFields } from './applicationBulkFields';

/** The names a field's select offers, opened as a person would. */
function offered(field: { render: (props: any) => React.ReactNode }): string[] {
  const { unmount } = render(<>{field.render({ value: null, onChange: () => {}, label: 'field', disabled: false })}</>);
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'field' }));
  const names = within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent ?? '');
  unmount();
  return names;
}

describe('useApplicationBulkFields', () => {
  it('offers the category and the cyber criticality, with the values the workspace still offers', () => {
    const { result } = renderHook(() => useApplicationBulkFields());
    const fields = result.current;
    expect(fields.map((field) => field.key)).toEqual(['owners_business', 'owners_it', 'category', 'lifecycle', 'criticality', 'cyber_criticality']);
    const category = fields.find((field) => field.key === 'category')!;
    expect(category.label).toBe('pages.applications.columns.category');
    expect(category.optional).toBe(false);
    expect(offered(category)).toEqual(['Analytique', 'Infrastructure', 'Atelier']);
    expect(category.changes('infrastructure', null)).toEqual({ category: 'infrastructure' });
    const cyber = fields.find((field) => field.key === 'cyber_criticality')!;
    expect(cyber.label).toBe('Cyber criticality');
    expect(cyber.optional).toBe(true);
    expect(offered(cyber)).toEqual(['Critique', 'Élevée']);
    expect(cyber.changes(null, null)).toEqual({ cyber_criticality: null });
  });
});
