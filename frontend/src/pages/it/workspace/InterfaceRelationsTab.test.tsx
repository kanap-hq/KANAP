import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design';
import api from '../../../api';
import type { InterfaceRelationRow } from '../../../components/workspace/relations';
import InterfaceRelationsTab from './InterfaceRelationsTab';

const rights = vi.hoisted(() => ({ applications: 'member' } as Record<string, string>));

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([name]) => name !== 'defaultValue').map(([name, value]) => `${name}=${value}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => translation,
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => {
      const rank: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };
      const current = rights[resource];
      if (!current) return false;
      return (rank[current] ?? 0) >= (rank[level] ?? 0);
    },
  }),
}));
vi.mock('../../../components/EntityKnowledgePanel', () => ({
  default: ({ entityType, entityId, canCreate }: { entityType: string; entityId: string; canCreate: boolean }) => (
    <div data-testid="documents" data-type={entityType} data-id={entityId} data-create={canCreate ? 'yes' : 'no'} />
  ),
}));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (field: string, code?: string | null) => (code ? `${field}:${code}` : '') }),
}));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [] } }),
}));

const mocked = vi.mocked(api);

type Relations = { upstream: InterfaceRelationRow[]; downstream: InterfaceRelationRow[] };

const row = (id: string, reference: string, name: string, lifecycle = 'active'): InterfaceRelationRow => ({
  id,
  reference,
  name,
  source_application_name: 'SAP',
  target_application_name: 'Salesforce',
  lifecycle,
});

function relations(): Relations {
  return {
    upstream: [row('if-2', 'INT-2', 'Customer master'), row('if-3', 'INT-3', 'Old feed', 'retired')],
    downstream: [{ ...row('if-4', 'INT-4', 'Invoices'), source_application_name: null }],
  };
}

const LINKS = [{ id: 'l-1', description: 'Runbook', url: 'https://wiki.example.com/runbook', created_at: '2026-10-01T10:00:00.000Z' }];
const FILES = [{ id: 'a-1', original_filename: 'mapping.xlsx', size: 2048, uploaded_at: '2026-10-01T10:00:00.000Z' }];

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTab(data: Relations = relations(), onCountChange = vi.fn()) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/interfaces/if-1/relations') return { data } as never;
    if (url === '/interfaces/if-1/links') return { data: LINKS } as never;
    if (url === '/interfaces/if-1/attachments') return { data: FILES } as never;
    if (url === '/interfaces') {
      return { data: { items: [
        { id: 'if-1', name: 'This interface', interface_reference: 'INT-1', source_application_name: 'SAP', target_application_name: 'CRM' },
        { id: 'if-2', name: 'Customer master', interface_reference: 'INT-2', source_application_name: 'SAP', target_application_name: 'CRM' },
        { id: 'if-8', name: 'Payments', interface_reference: 'INT-8', source_application_name: 'Bank', target_application_name: 'SAP' },
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
            <InterfaceRelationsTab interfaceId="if-1" onCountChange={onCountChange} />
            <Location />
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onCountChange };
}

const COL = (name: string) => `workspace.application.relations.columns.${name}`;
const UPSTREAM = 'workspace.interface.relations.upstream';
const DOWNSTREAM = 'workspace.interface.relations.downstream';

describe('InterfaceRelationsTab', () => {
  beforeEach(() => {
    rights.applications = 'member';
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    mocked.delete.mockReset();
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    mocked.patch.mockResolvedValue({ data: { ok: true } } as never);
    mocked.delete.mockResolvedValue({ data: { ok: true } } as never);
  });

  it('keeps the documents first, then upstream, downstream, links and files, and opens an interface', async () => {
    const { onCountChange } = renderTab();
    await screen.findByText('Customer master');

    expect(screen.getByTestId('documents')).toHaveAttribute('data-type', 'interfaces');
    expect(screen.getByTestId('documents')).toHaveAttribute('data-id', 'if-1');
    expect(screen.getByTestId('documents')).toHaveAttribute('data-create', 'yes');
    const labels = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(labels).toEqual([UPSTREAM, DOWNSTREAM, 'linksAndFiles.title']);

    const upstream = screen.getByRole('region', { name: UPSTREAM });
    expect(within(upstream).getByText('INT-2')).toBeTruthy();
    expect(within(upstream).getByText('Customer master')).toBeTruthy();
    expect(within(upstream).getAllByText('SAP')).toHaveLength(2);
    expect(within(upstream).getAllByText('Salesforce')).toHaveLength(2);
    expect(within(upstream).getByText('lifecycleStatus:active')).toBeTruthy();
    expect(within(upstream).getByText('lifecycleStatus:retired')).toBeTruthy();
    for (const header of [COL('ref'), COL('name'), 'pages.interfaces.columns.sourceApp', 'pages.interfaces.columns.targetApp', 'common.lifecycle']) {
      expect(within(upstream).getByText(header)).toBeTruthy();
    }
    const downstream = screen.getByRole('region', { name: DOWNSTREAM });
    expect(within(downstream).getByText('Invoices')).toBeTruthy();
    expect(within(downstream).getByText('—')).toBeTruthy();

    await waitFor(() => expect(onCountChange).toHaveBeenLastCalledWith(5));

    fireEvent.click(within(downstream).getByText('Invoices'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/interfaces/INT-4/overview');
  });

  it('shows the empty line of a section without links', async () => {
    renderTab({ upstream: [], downstream: [] });
    expect(await screen.findByText('workspace.interface.relations.empty.upstream')).toBeTruthy();
    expect(screen.getByText('workspace.interface.relations.empty.downstream')).toBeTruthy();
  });

  it('adds from the picker, leaving out the linked rows and the interface itself', async () => {
    renderTab();
    const upstream = await screen.findByRole('region', { name: UPSTREAM });
    await within(upstream).findByText('Customer master');
    fireEvent.click(within(upstream).getByText('workspace.application.relations.add'));
    expect(await screen.findByRole('option', { name: /Payments/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Customer master/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /This interface/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Payments/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/interfaces/if-1/relations/upstream', { id: 'if-8' }));
    expect(mocked.get).toHaveBeenCalledWith('/interfaces', expect.objectContaining({
      params: expect.objectContaining({ page: 1, limit: 30, sort: 'name:ASC' }),
    }));

    const downstream = screen.getByRole('region', { name: DOWNSTREAM });
    fireEvent.click(within(downstream).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /Customer master/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/interfaces/if-1/relations/downstream', { id: 'if-2' }));
  });

  it('unlinks a row at once and restores it when the server refuses', async () => {
    renderTab();
    let reject: (error: unknown) => void = () => undefined;
    mocked.delete.mockReturnValue(new Promise((_, next) => { reject = next; }) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=Customer master)' }));

    expect(mocked.delete).toHaveBeenCalledWith('/interfaces/if-1/relations/upstream/if-2');
    await waitFor(() => expect(screen.queryByText('Customer master')).toBeNull());

    reject({ response: { status: 500, data: { message: 'Server down' } } });
    expect(await screen.findByText('Customer master')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('gives a reader the tables and the navigation only', async () => {
    rights.applications = 'reader';
    renderTab();
    await screen.findByText('Customer master');
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'linksAndFiles.addLink' })).toBeNull();
    expect(screen.queryByLabelText('linksAndFiles.attachFile')).toBeNull();
    expect(screen.getByTestId('documents')).toHaveAttribute('data-create', 'no');
    fireEvent.click(screen.getByText('Customer master'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/interfaces/INT-2/overview');
  });

  it('saves each web link at once and deletes a file only after confirmation', async () => {
    renderTab();
    expect(await screen.findByText('Runbook')).toBeTruthy();
    expect(screen.getByText('mapping.xlsx')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.addLink' }));
    fireEvent.change(await screen.findByLabelText('linksAndFiles.columns.name'), { target: { value: 'Status page' } });
    fireEvent.change(screen.getByLabelText('linksAndFiles.url'), { target: { value: ' https://status.example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.add' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/interfaces/if-1/links', { url: 'https://status.example.com', description: 'Status page' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.editLinkNamed(name=Runbook)' }));
    fireEvent.change(await screen.findByLabelText('linksAndFiles.url'), { target: { value: 'https://wiki.example.com/run' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/interfaces/if-1/links/l-1', { url: 'https://wiki.example.com/run', description: 'Runbook' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.removeNamed(name=Runbook)' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/interfaces/if-1/links/l-1'));

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.removeFileNamed(name=mapping.xlsx)' }));
    expect(mocked.patch).not.toHaveBeenCalledWith('/interfaces/attachments/a-1/delete', {});
    expect(await screen.findByText('ops:confirmations.deleteAttachment(name=mapping.xlsx)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/interfaces/attachments/a-1/delete', {}));
  });

  it('attaches a file', async () => {
    renderTab();
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(await screen.findByLabelText('linksAndFiles.attachFile'), { target: { files: [file] } });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/interfaces/if-1/attachments', expect.any(FormData)));
    const form = mocked.post.mock.calls.find(([url]) => url === '/interfaces/if-1/attachments')?.[1] as FormData;
    expect(form.get('kind')).toBe('functional');
  });
});
