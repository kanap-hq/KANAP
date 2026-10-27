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
// The header renders its actions: the delete button is one of them.
vi.mock('../../components/PageHeader', () => ({ default: ({ actions }: { actions?: React.ReactNode }) => <>{actions}</> }));
const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
vi.mock('../../components/DeleteSelectedButton', () => ({
  default: (props: Record<string, any>) => {
    deleteButton.props = props;
    return null;
  },
}));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({
    data: {
      businessCriticalityLevels: [{ code: 'business_critical', label: 'Critical' }, { code: 'low', label: 'Low' }],
      dataClasses: [{ code: 'restricted', label: 'Restricted' }, { code: 'public', label: 'Public' }],
    },
  }),
}));
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
      { value: 'server_to_server', label: 'it:enums.topology.serverToServer' },
      { value: 'multi_server', label: 'it:enums.topology.multiServer' },
    ]);
    expect(column('lifecycle').filterParams?.values).toEqual([{ value: 'active', label: 'Active' }, { value: 'retired', label: 'Retired' }]);
  });

  it('filters criticality, data class and PII on the codes behind the effective values the cells show', () => {
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    const columns = (grid.mock.calls[grid.mock.calls.length - 1][0] as { columns: Col[] }).columns;
    const column = (field: string) => columns.find((c) => c.field === field)!;
    for (const field of ['criticality', 'data_class', 'contains_pii']) {
      expect(column(field).filter).toBe(CheckboxSetFilter);
      expect(column(field).floatingFilterComponent).toBe(CheckboxSetFloatingFilter);
    }
    expect(column('criticality').filterParams?.values).toEqual([
      { value: 'business_critical', label: 'Critical' },
      { value: 'low', label: 'Low' },
      { value: null },
    ]);
    expect(column('data_class').filterParams?.values).toEqual([
      { value: 'restricted', label: 'Restricted' },
      { value: 'public', label: 'Public' },
      { value: null },
    ]);
    expect(column('contains_pii').filterParams?.values).toEqual([
      { value: 'true', label: 'enums.yesNo.yes' },
      { value: 'false', label: 'enums.yesNo.no' },
    ]);
  });
});

describe('ConnectionsPage delete', () => {
  it('names connections in the dialog and the message once done, in the four languages', async () => {
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    const labels = deleteButton.props?.itemLabels;
    expect(labels.toDelete(2)).toBe('pages.connections.delete.toDelete');
    expect(labels.deleted(2)).toBe('pages.connections.delete.deleted');
    expect(labels.title(2)).toBe('pages.connections.delete.title');
    for (const lang of ['en', 'fr', 'de', 'es']) {
      const it = (await import(`../../locales/${lang}/it.json`)).default as any;
      for (const key of ['toDelete', 'deleted', 'title']) {
        expect(it.pages.connections.delete[`${key}_one`], `${lang} ${key}`).toBeTruthy();
        expect(it.pages.connections.delete[`${key}_other`], `${lang} ${key}`).toBeTruthy();
      }
    }
  });

  it('warns that the hops of each deleted connection go with it, in the four languages', async () => {
    render(<MemoryRouter><ConnectionsPage /></MemoryRouter>);
    expect(deleteButton.props?.warning).toBe('pages.connections.deleteWarning');
    const hop = { en: /\bhops?\b/, fr: /\bsauts?\b/, de: /\bHops?\b/, es: /\bsaltos?\b/ };
    const kept = {
      en: /servers, interfaces and documents stay/,
      fr: /serveurs, interfaces et documents sont conservés/,
      de: /Server, Schnittstellen und Dokumente bleiben erhalten/,
      es: /servidores, interfaces y documentos se conservan/,
    };
    for (const lang of ['en', 'fr', 'de', 'es'] as const) {
      const it = (await import(`../../locales/${lang}/it.json`)).default as {
        pages: { connections: Record<string, string> };
      };
      for (const key of ['deleteWarning_one', 'deleteWarning_other']) {
        const text = it.pages.connections[key];
        expect(text, `${lang} ${key} hops`).toMatch(hop[lang]);
        expect(text, `${lang} ${key} kept`).toMatch(kept[lang]);
      }
    }
  });
});
