import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key, language: 'en' } }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../components/PageHeader', () => ({ default: () => null }));
vi.mock('../../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({ default: () => ({ data: undefined }) }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    byField: { lifecycleStatus: [{ code: 'active', label: 'Active' }, { code: 'retired', label: 'Retired' }] },
    labelFor: (_field: string, code: string) => ({ active: 'Active', retired: 'Retired' } as Record<string, string>)[code] ?? code,
  }),
}));
const grid = vi.fn();
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: unknown) => {
    grid(props);
    return null;
  },
}));

import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import ConnectionsPage from './ConnectionsPage';

type Col = { field?: string; filter?: unknown; floatingFilterComponent?: unknown; filterParams?: { values?: unknown } };

describe('ConnectionsPage filters', () => {
  it('offers checkbox lists on topology and lifecycle, with the labels the grid shows', () => {
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    const columns = (grid.mock.calls[grid.mock.calls.length - 1][0] as { columns: Col[] }).columns;
    const column = (field: string) => columns.find((c) => c.field === field)!;
    for (const field of ['topology', 'lifecycle']) {
      expect(column(field).filter).toBe(CheckboxSetFilter);
      expect(column(field).floatingFilterComponent).toBe(CheckboxSetFloatingFilter);
    }
    expect(column('topology').filterParams?.values).toEqual([
      { value: 'server_to_server', label: 'Server to server' },
      { value: 'multi_server', label: 'Multi-server' },
    ]);
    expect(column('lifecycle').filterParams?.values).toEqual([{ value: 'active', label: 'Active' }, { value: 'retired', label: 'Retired' }]);
  });

  it('offers no filter on the columns whose cells can show derived values', () => {
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    const columns = (grid.mock.calls[grid.mock.calls.length - 1][0] as { columns: Col[] }).columns;
    for (const field of ['criticality', 'data_class', 'contains_pii']) {
      const col = columns.find((c) => c.field === field)!;
      expect(col.filter).toBe(false);
      expect(col.floatingFilterComponent).toBeUndefined();
    }
  });
});
