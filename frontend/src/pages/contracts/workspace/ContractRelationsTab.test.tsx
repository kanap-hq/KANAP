import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design';
import api from '../../../api';
import ContractRelationsTab from './ContractRelationsTab';
import type { ApplicationRelationRow, AssetRelationRow, TechnologyRelationRow } from '../../../components/workspace/relations';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => translation,
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../components/contacts/ItemContactsSection', () => ({ default: () => null }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (field: string, code?: string | null) => (code ? `${field}:${code}` : '') }),
}));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [{ code: 'high', label: 'High' }] } }),
}));

const mocked = vi.mocked(api);

type Suggestion = {
  type: 'application' | 'asset';
  id: string;
  reference: string;
  name: string;
  via: { kind: 'same_supplier'; label: null };
};

type Relations = {
  applications: ApplicationRelationRow[];
  assets: AssetRelationRow[];
  technologies: TechnologyRelationRow[] | null;
  suggestions: Suggestion[];
};

function relations(overrides: Partial<Relations> = {}): Relations {
  return {
    applications: [
      { id: 'app-1', reference: 'APP-4', name: 'SAP S/4HANA', lifecycle: 'active', business_criticality: 'high', status: 'enabled' },
      { id: 'app-2', reference: 'APP-9', name: 'Legacy CRM', lifecycle: 'retired', business_criticality: null, status: 'disabled' },
    ],
    assets: [
      { id: 'as-1', reference: 'AST-2', name: 'sap-prd-db01', kind: 'physical_server', environment: 'prod', status: 'active' },
      { id: 'as-2', reference: 'AST-8', name: 'old-printer', kind: 'virtual_machine', environment: 'test', status: 'retired' },
    ],
    technologies: [
      { id: 'tec-1', reference: 'TEC-9', name: 'Oracle Database', family: 'database', vendor: 'Oracle' },
      { id: 'tec-2', reference: 'TEC-3', name: 'Tomcat', family: 'runtime', vendor: null },
    ],
    suggestions: [
      { type: 'application', id: 'app-7', reference: 'APP-7', name: 'Payroll', via: { kind: 'same_supplier', label: null } },
    ],
    ...overrides,
  };
}

const LINKS = [{ id: 'l-1', description: 'Vendor portal', url: 'https://me.example.com', created_at: '2026-10-01T10:00:00.000Z' }];
const FILES = [{ id: 'a-1', original_filename: 'contract.pdf', size: 2048, uploaded_at: '2026-10-01T10:00:00.000Z' }];

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTab(data: Relations, { readOnly = false, onChanged = vi.fn() }: { readOnly?: boolean; onChanged?: () => void } = {}) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/contracts/c-1/relations') return { data } as never;
    if (url === '/contracts/c-1/links') return { data: LINKS } as never;
    if (url === '/contracts/c-1/attachments') return { data: FILES } as never;
    if (url === '/applications') {
      return { data: { items: [
        { id: 'app-1', name: 'SAP S/4HANA', sequential_id: 'APP-4' },
        { id: 'app-8', name: 'Billing', sequential_id: 'APP-8' },
      ] } } as never;
    }
    return { data: [] } as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter>
            <ContractRelationsTab contractId="c-1" readOnly={readOnly} onChanged={onChanged} />
            <Location />
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return onChanged;
}

describe('ContractRelationsTab', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    mocked.delete.mockReset();
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    mocked.patch.mockResolvedValue({ data: { ok: true } } as never);
    mocked.delete.mockResolvedValue({ data: { ok: true } } as never);
  });

  it('shows one table per type, with labelled columns, and opens the record', async () => {
    renderTab(relations());
    await screen.findByText('SAP S/4HANA');
    const applications = screen.getByRole('region', { name: 'workspace.application.relations.sections.applications' });
    expect(within(applications).getByText('APP-4')).toBeTruthy();
    expect(within(applications).getByText('SAP S/4HANA')).toBeTruthy();
    expect(within(applications).getByText('lifecycleStatus:active')).toBeTruthy();
    expect(within(applications).getByText('High')).toBeTruthy();
    expect(within(applications).getByText('Legacy CRM')).toBeTruthy();
    expect(within(applications).getByText('—')).toBeTruthy();
    expect(within(applications).getByText('common.lifecycle')).toBeTruthy();
    expect(within(applications).getByText('classification.business_criticality')).toBeTruthy();

    const assets = screen.getByRole('region', { name: 'workspace.application.relations.sections.assets' });
    expect(within(assets).getByText('AST-2')).toBeTruthy();
    expect(within(assets).getByText('sap-prd-db01')).toBeTruthy();
    expect(within(assets).getByText('serverKind:physical_server')).toBeTruthy();
    expect(within(assets).getByText('enums.environment.prod')).toBeTruthy();
    expect(within(assets).getByText('lifecycleStatus:active')).toBeTruthy();
    expect(within(assets).getByText('old-printer')).toBeTruthy();
    expect(within(assets).getByText('pages.assets.columns.environment')).toBeTruthy();
    expect(within(assets).getByText('workspace.application.relations.columns.status')).toBeTruthy();

    const technologies = screen.getByRole('region', { name: 'workspace.application.relations.sections.technologies' });
    expect(within(technologies).getByText('TEC-9')).toBeTruthy();
    expect(within(technologies).getByText('Oracle Database')).toBeTruthy();
    expect(within(technologies).getByText('technologyFamily:database')).toBeTruthy();
    expect(within(technologies).getByText('Oracle')).toBeTruthy();
    expect(within(technologies).getByText('Tomcat')).toBeTruthy();
    expect(within(technologies).getByText('—')).toBeTruthy();
    expect(within(technologies).getByText('pages.technologies.columns.editor')).toBeTruthy();

    fireEvent.click(within(applications).getByText('SAP S/4HANA'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/applications/APP-4/overview');
  });

  it('adds an application from the picker and leaves out the ones already linked', async () => {
    const onChanged = renderTab(relations());
    const applications = await screen.findByRole('region', { name: 'workspace.application.relations.sections.applications' });
    await within(applications).findByText('SAP S/4HANA');
    fireEvent.click(within(applications).getByText('workspace.application.relations.add'));
    expect(await screen.findByRole('option', { name: /Billing/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /SAP S\/4HANA/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Billing/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/c-1/relations/applications', { id: 'app-8' }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(mocked.get).toHaveBeenCalledWith('/applications', expect.objectContaining({
      params: expect.objectContaining({ page: 1, limit: 30, sort: 'name:ASC' }),
    }));
  });

  it('unlinks a row at once and restores it when the server refuses', async () => {
    const onChanged = renderTab(relations());
    let reject: (error: unknown) => void = () => undefined;
    mocked.delete.mockReturnValue(new Promise((_, r) => { reject = r; }) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=SAP S/4HANA)' }));

    expect(mocked.delete).toHaveBeenCalledWith('/contracts/c-1/relations/applications/app-1');
    await waitFor(() => expect(screen.queryByText('SAP S/4HANA')).toBeNull());
    expect(onChanged).not.toHaveBeenCalled();

    reject({ response: { status: 500, data: { message: 'Server down' } } });
    expect(await screen.findByText('SAP S/4HANA')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('links a suggestion and moves it into its section', async () => {
    const current = relations();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/contracts/c-1/relations') return { data: current } as never;
      if (url === '/contracts/c-1/links') return { data: LINKS } as never;
      if (url === '/contracts/c-1/attachments') return { data: FILES } as never;
      return { data: [] } as never;
    });
    mocked.post.mockImplementation(async (url: string, body?: unknown) => {
      const id = (body as { id?: string } | undefined)?.id;
      if (url === '/contracts/c-1/relations/applications' && id === 'app-7') {
        current.suggestions = [];
        current.applications = [
          ...current.applications,
          { id: 'app-7', reference: 'APP-7', name: 'Payroll', lifecycle: 'active', business_criticality: 'high', status: 'enabled' },
        ];
      }
      return { data: { ok: true, changed: true } } as never;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <MemoryRouter>
              <ContractRelationsTab contractId="c-1" readOnly={false} onChanged={vi.fn()} />
            </MemoryRouter>
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    const related = await screen.findByRole('region', { name: 'workspace.application.relations.sections.related' });
    expect(within(related).getByText('APP-7')).toBeTruthy();
    expect(within(related).getByText('workspace.application.relations.types.application')).toBeTruthy();
    expect(within(related).getByText('workspace.application.relations.via.same_supplier(label=)')).toBeTruthy();
    fireEvent.click(within(related).getByRole('button', { name: 'workspace.application.relations.linkNamed(name=Payroll)' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/c-1/relations/applications', { id: 'app-7' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.related' })).toBeNull());
    const applications = screen.getByRole('region', { name: 'workspace.application.relations.sections.applications' });
    expect(within(applications).getByText('Payroll')).toBeTruthy();
  });

  it('leaves technologies out when the response is null', async () => {
    renderTab(relations({ technologies: null }));
    await screen.findByRole('region', { name: 'workspace.application.relations.sections.applications' });
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.technologies' })).toBeNull();
    expect(screen.getByRole('region', { name: 'workspace.application.relations.sections.assets' })).toBeTruthy();
  });

  it('gives readers the tables and the navigation only', async () => {
    renderTab(relations(), { readOnly: true });
    await screen.findByText('SAP S/4HANA');
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.linkNamed/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'linksAndFiles.addLink' })).toBeNull();
    expect(screen.queryByLabelText('linksAndFiles.attachFile')).toBeNull();
    fireEvent.click(screen.getByText('sap-prd-db01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-2/overview');
  });

  it('adds a web link and deletes a file only after confirmation', async () => {
    const onChanged = renderTab(relations());
    expect(await screen.findByText('Vendor portal')).toBeTruthy();
    expect(screen.getByText('me.example.com')).toBeTruthy();
    expect(screen.getByText('contract.pdf')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.addLink' }));
    fireEvent.change(await screen.findByLabelText('linksAndFiles.columns.name'), { target: { value: 'Status page' } });
    fireEvent.change(screen.getByLabelText('linksAndFiles.url'), { target: { value: ' https://status.example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.add' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/c-1/links', { url: 'https://status.example.com', description: 'Status page' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onChanged).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.removeFileNamed(name=contract.pdf)' }));
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(await screen.findByText('ops:confirmations.deleteAttachment(name=contract.pdf)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contracts/attachments/a-1/delete', {}));
  });

  it('attaches a file', async () => {
    const onChanged = renderTab(relations());
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(await screen.findByLabelText('linksAndFiles.attachFile'), { target: { files: [file] } });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/c-1/attachments', expect.any(FormData)));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });
});
