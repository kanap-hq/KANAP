import React from 'react';
import { act, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../i18n', () => ({ default: { t: (key: string) => key, language: 'en' } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../components/PageHeader', () => ({ default: () => null }));
vi.mock('../../components/DeleteSelectedButton', () => ({ default: () => null }));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: [] })), post: vi.fn() } }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [{ code: 'business_critical', label: 'Critical' }, { code: 'low', label: 'Low' }] } }),
}));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    byField: {
      lifecycleStatus: [{ code: 'active', label: 'Active' }, { code: 'retired', label: 'Retired' }],
      interfaceDataCategory: [{ code: 'master_data', label: 'Master data' }],
    },
    labelFor: (_field: string, code: string) => ({ active: 'Active', retired: 'Retired', master_data: 'Master data' } as Record<string, string>)[code] ?? code,
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
import InterfacesPage from './InterfacesPage';

type Col = {
  field?: string;
  filter?: unknown;
  filterParams?: { values?: unknown; getValues?: unknown };
  cellRenderer?: React.FC<any>;
};
const lastProps = () => grid.mock.calls[grid.mock.calls.length - 1][0] as { columns: Col[]; onQueryStateChange: (state: any) => void };

describe('InterfacesPage', () => {
  it('filters lifecycle, criticality, data category, PII and business process on codes, with the cell labels', () => {
    render(<MemoryRouter><InterfacesPage /></MemoryRouter>);
    const column = (field: string) => lastProps().columns.find((c) => c.field === field)!;
    for (const field of ['lifecycle', 'criticality', 'data_category', 'contains_pii', 'business_process_id']) {
      expect(column(field).filter).toBe(CheckboxSetFilter);
    }
    expect(column('lifecycle').filterParams?.values).toEqual([{ value: 'active', label: 'Active' }, { value: 'retired', label: 'Retired' }]);
    expect(column('criticality').filterParams?.values).toEqual([
      { value: 'business_critical', label: 'Critical' },
      { value: 'low', label: 'Low' },
      { value: null },
    ]);
    expect(column('contains_pii').filterParams?.values).toEqual([
      { value: 'true', label: 'enums.yesNo.yes' },
      { value: 'false', label: 'enums.yesNo.no' },
    ]);
    expect(typeof column('business_process_id').filterParams?.getValues).toBe('function');
  });

  it('sends the filter model, not flattened parameters', () => {
    render(<MemoryRouter><InterfacesPage /></MemoryRouter>);
    expect((lastProps() as any).extraParams).toBeUndefined();
  });

  it('carries sort, search and filters into the workspace link, so prev/next walks the filtered set', () => {
    render(<MemoryRouter><InterfacesPage /></MemoryRouter>);
    const filters = { lifecycle: { filterType: 'set', values: ['active'] } };
    act(() => {
      lastProps().onQueryStateChange({ sort: 'name:ASC', q: 'pay', filterModel: filters });
    });
    const Cell = lastProps().columns.find((c) => c.field === 'name')!.cellRenderer!;
    const { container } = render(
      <MemoryRouter>
        <Cell value="Payslips" data={{ id: 'i-1', interface_reference: 'INT-7', name: 'Payslips' }} />
      </MemoryRouter>,
    );
    const href = container.querySelector('a')?.getAttribute('href') ?? '';
    expect(href.startsWith('/it/interfaces/INT-7/overview?')).toBe(true);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('sort')).toBe('name:ASC');
    expect(params.get('q')).toBe('pay');
    expect(JSON.parse(params.get('filters') ?? '{}')).toEqual(filters);
  });
});
