import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import api from '../../api';
import { downloadBlob } from '../../utils/downloadBlob';
import en from '../../locales/en/admin.json';
import fr from '../../locales/fr/admin.json';
import de from '../../locales/de/admin.json';
import es from '../../locales/es/admin.json';
import {
  AUDIT_EVENT_ACTIONS,
  AUTH_EVENT_REASONS,
  EXPORT_RESOURCE_KEYS,
  auditReasonLabel,
  auditTableLabel,
  auditTablesMatchingSearch,
  auditUserLabel,
} from '../../lib/audit/auditLogLabels';
import AuditLogsPage from './AuditLogsPage';

const auth = vi.hoisted(() => ({ admin: true }));
const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string, level: string) => auth.admin && resource === 'users' && level === 'admin' }),
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title, actions }: { title: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {actions}
    </div>
  ),
}));

vi.mock('../ForbiddenPage', () => ({ default: () => <div>Forbidden</div> }));

vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    return null;
  },
}));

vi.mock('../../utils/downloadBlob', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../utils/downloadBlob')>()),
  downloadBlob: vi.fn(),
}));

const getMock = vi.mocked(api.get);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <AuditLogsPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const column = (field: string) => (grid.props?.columns as any[]).find((col) => col.field === field);
const t = i18n.getFixedT('en', 'admin') as unknown as (key: string, options?: Record<string, unknown>) => string;

function csvResponse(headers: Record<string, string> = {}) {
  return {
    data: new Blob(['date,action\n']),
    headers: { 'content-disposition': 'attachment; filename="audit-log-2026-10-09.csv"', ...headers },
  };
}

function auditRow(overrides: Record<string, any> = {}) {
  return {
    id: 'a-1', tenant_id: 't-1', table_name: 'suppliers', record_id: null, action: 'update',
    before_json: null, after_json: null, user_id: null, user_email: null, user_name: null,
    source: 'user', source_ref: null, created_at: '2026-10-16T07:19:02Z', ...overrides,
  };
}

async function openDetail(entry: Record<string, any>) {
  getMock.mockResolvedValue({ data: entry } as any);
  renderPage();
  act(() => {
    grid.props?.onCellClicked({ data: entry });
  });
  const dialog = await screen.findByRole('dialog');
  await screen.findByText(/^Date: /);
  return dialog;
}

describe('AuditLogsPage', () => {
  beforeEach(async () => {
    auth.admin = true;
    grid.props = null;
    getMock.mockReset();
    vi.mocked(downloadBlob).mockReset();
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('offers an administrator the export of the list, CSV or Excel', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    expect(screen.getByRole('menuitem', { name: 'CSV' })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' })).toBeTruthy();
  });

  it('shows nothing of the log without the users admin level', () => {
    auth.admin = false;
    renderPage();
    expect(screen.getByText('Forbidden')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull();
  });

  it("exports with the list's filters, search and sort, in one format whatever the screen language", async () => {
    await i18n.changeLanguage('fr');
    getMock.mockResolvedValue(csvResponse() as any);
    renderPage();
    const filterModel = { table_name: { filterType: 'set', values: ['auth'] } };
    act(() => {
      grid.props?.onQueryStateChange({ sort: 'created_at:ASC', filterModel, q: 'alice' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Exporter' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(getMock).toHaveBeenCalledWith('/audit-logs/export', {
      params: { format: 'xlsx', sort: 'created_at:ASC', q: 'alice', filters: JSON.stringify(filterModel) },
      responseType: 'blob',
    });
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('audit-log-2026-10-09.csv');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says when the file stopped at the row limit', async () => {
    getMock.mockResolvedValue(csvResponse({ 'x-export-truncated': '100000' }) as any);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));
    expect(await screen.findByText('The file holds the first 100,000 entries. Narrow the filters to export the rest.')).toBeTruthy();
  });

  it('says when exports come too fast, and when one fails', async () => {
    getMock.mockRejectedValueOnce({ response: { status: 429 } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));
    expect(await screen.findByText('Too many exports in a short time. Try again in a minute.')).toBeTruthy();
    getMock.mockRejectedValueOnce({ response: { status: 500 } });
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));
    expect(await screen.findByText('The audit log could not be exported.')).toBeTruthy();
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it('labels sign-in, session and export rows in plain language, names only', () => {
    renderPage();
    const user = column('user_email');
    expect(user.valueGetter({ data: { table_name: 'auth', user_id: null, source: 'user' } })).toBe('Unknown account');
    expect(user.valueGetter({ data: { table_name: 'suppliers', user_id: null, source: 'system' } })).toBe('System');
    expect(user.valueGetter({ data: { table_name: 'auth', user_id: 'u-1', user_name: 'Alice Admin', user_email: 'alice@example.com' } })).toBe('Alice Admin');
    expect(column('table_name').valueFormatter({ data: { table_name: 'export', after_json: { resource: 'incidents/report' } } })).toBe('Incident report');
    expect(column('table_name').valueFormatter({ data: { table_name: 'auth' } })).toBe('Sign-in and session');
    expect(column('table_name').valueFormatter({ data: { table_name: 'suppliers' } })).toBe('Suppliers');
    expect(column('table_name').filterParams.labelFormatter('export')).toBe('Export');
    expect(column('action').filterParams.labelFormatter('login_failed')).toBe('Failed sign-in');
    expect(column('source_ref').valueFormatter({ data: { table_name: 'auth', source_ref: 'bad_password' } })).toBe('Wrong password');
    expect(auditReasonLabel({ table_name: 'auth', source_ref: 'unknown_user' }, t)).toBe('No account with this address');
    expect(auditReasonLabel({ table_name: 'suppliers', source_ref: 'import-7' }, t)).toBe('import-7');
    expect(auditTableLabel({ table_name: 'export', after_json: { resource: 'something-new' } }, t)).toBe('Export');
    expect(auditUserLabel({ table_name: 'auth', user_id: null }, t)).toBe('Unknown account');
  });

  it('names the tables in the reader language in the list, the filter and the detail', async () => {
    await i18n.changeLanguage('fr');
    const row = {
      id: 'a-1', tenant_id: 't-1', table_name: 'contract_links', record_id: 'r-1', action: 'create',
      before_json: null, after_json: { id: 'r-1' }, user_id: null, user_email: null, user_name: null,
      source: 'user', source_ref: null, created_at: '2026-10-15T08:00:00Z',
    };
    getMock.mockResolvedValue({ data: row } as any);
    renderPage();
    expect(column('table_name').valueFormatter({ data: { table_name: 'suppliers' } })).toBe('Fournisseurs');
    expect(column('table_name').filterParams.labelFormatter('spend_items')).toBe('Lignes OPEX');
    expect(column('table_name').filterParams.labelFormatter('some_new_table')).toBe('some_new_table');
    act(() => {
      grid.props?.onCellClicked({ data: row });
    });
    expect(await screen.findByText('Table : Liens de contrat')).toBeTruthy();
    expect(screen.queryByText(/contract_links/)).toBeNull();
  });

  it('names the budget file import source, and dates the detail like the list', async () => {
    await i18n.changeLanguage('fr');
    const row = {
      id: 'a-2', tenant_id: 't-1', table_name: 'suppliers', record_id: 'r-1', action: 'update',
      before_json: null, after_json: { id: 'r-1' }, user_id: null, user_email: null, user_name: null,
      source: 'budget_file', source_ref: null, created_at: '2026-10-16T07:19:02Z',
    };
    getMock.mockResolvedValue({ data: row } as any);
    renderPage();
    expect(column('source').valueFormatter({ value: 'budget_file' })).toBe('Import du fichier budgétaire');
    expect(column('source').filterParams.labelFormatter('budget_file')).toBe('Import du fichier budgétaire');
    expect(column('source').valueFormatter({ value: 'ai_chat' })).toBe('Chat IA');
    const listDate = column('created_at').valueFormatter({ value: row.created_at });
    act(() => {
      grid.props?.onCellClicked({ data: row });
    });
    expect(await screen.findByText('Source : Import du fichier budgétaire')).toBeTruthy();
    expect(screen.getByText(`Date : ${listDate}`)).toBeTruthy();
  });

  it('shows the changed fields in a table and the raw JSON only on demand', async () => {
    const entry = auditRow({
      before_json: { status: 'draft', go_live_date: null, mfa_supported: false, name: 'Same name' },
      after_json: { status: 'active', go_live_date: '2020-11-01', mfa_supported: true, name: 'Same name' },
    });
    await openDetail(entry);

    expect(screen.getByRole('columnheader', { name: 'Field' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Before' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'After' })).toBeTruthy();
    expect(screen.getByText('Status')).toBeTruthy();
    expect(screen.getByText('Go-live date')).toBeTruthy();
    expect(screen.getByText('MFA supported')).toBeTruthy();
    expect(screen.getByText('Draft')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('1 Nov 2020')).toBeTruthy();
    expect(screen.getByText('No')).toBeTruthy();
    expect(screen.getByText('Yes')).toBeTruthy();
    expect(screen.queryByText('Name')).toBeNull();
    expect(document.querySelector('pre')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'View raw data' }));
    const pre = document.querySelector('pre');
    expect(pre?.textContent).toContain('"status": "draft"');
    expect(screen.getByRole('button', { name: 'Hide raw data' })).toBeTruthy();
  });

  it('shows an incident status with the incident label', async () => {
    const entry = auditRow({
      table_name: 'incidents',
      before_json: { status: 'open' },
      after_json: { status: 'resolved' },
    });
    await openDetail(entry);
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('Resolved')).toBeTruthy();
  });

  it('shows one value column for a create, without the technical id fields', async () => {
    const entry = auditRow({
      action: 'create',
      after_json: {
        id: '11111111-1111-4111-8111-111111111111',
        tenant_id: '22222222-2222-4222-8222-222222222222',
        name: 'Acme',
        status: 'active',
        created_at: '2026-10-16T07:19:02Z',
        updated_at: '2026-10-16T07:19:02Z',
      },
    });
    await openDetail(entry);

    expect(screen.getByRole('columnheader', { name: 'Value' })).toBeTruthy();
    expect(screen.queryByRole('columnheader', { name: 'Before' })).toBeNull();
    expect(screen.getByText('Name')).toBeTruthy();
    expect(screen.getByText('Created on')).toBeTruthy();
    expect(screen.queryByText('id')).toBeNull();
    expect(screen.queryByText('tenant_id')).toBeNull();
    expect(screen.queryByText('updated_at')).toBeNull();
  });

  it('shows an unknown field under its stored name', async () => {
    const entry = auditRow({
      before_json: { foo_bar: 'before' },
      after_json: { foo_bar: 'after' },
    });
    await openDetail(entry);
    expect(screen.getByText('foo_bar')).toBeTruthy();
  });

  it('never shows an id without a readable neighbour', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const entry = auditRow({
      before_json: { company_id: null },
      after_json: { company_id: id },
    });
    await openDetail(entry);

    expect(screen.getByText('Identifier')).toBeTruthy();
    expect(screen.queryByText(id)).toBeNull();
    expect(screen.getAllByTitle(id).length).toBeGreaterThan(0);
  });

  it('names the people of its fields with one grouped lookup', async () => {
    const previousOwner = '22222222-2222-4222-8222-222222222222';
    const nextOwner = '44444444-4444-4444-8444-444444444444';
    const entry = auditRow({
      before_json: { owner_user_id: previousOwner },
      after_json: { owner_user_id: nextOwner },
    });
    getMock.mockImplementation(async (url: string) => {
      if (url === '/users/lookup') {
        return {
          data: {
            items: [
              { id: previousOwner, first_name: 'Alice', last_name: 'Martin' },
              { id: nextOwner, first_name: 'Bob', last_name: 'Durand' },
            ],
            has_more: false,
          },
        };
      }
      return { data: entry };
    });
    renderPage();
    act(() => {
      grid.props?.onCellClicked({ data: entry });
    });

    expect(await screen.findByText('Alice Martin')).toBeTruthy();
    expect(await screen.findByText('Bob Durand')).toBeTruthy();
    const lookups = getMock.mock.calls.filter(([url]) => url === '/users/lookup');
    expect(lookups).toHaveLength(1);
    expect(lookups[0][1]?.params).toEqual({ ids: [previousOwner, nextOwner].sort().join(',') });
    expect(screen.queryByText(previousOwner)).toBeNull();
    expect(screen.queryByText(nextOwner)).toBeNull();
  });

  it('names the record with its item number when the table has one', async () => {
    const id = '33333333-3333-4333-8333-333333333333';
    const entry = auditRow({
      table_name: 'tasks',
      record_id: id,
      before_json: { status: 'draft' },
      after_json: { status: 'active', item_number: 4 },
    });
    await openDetail(entry);

    expect(screen.getByText('Record: T-4')).toBeTruthy();
    expect(screen.queryByText(id)).toBeNull();
  });

  it('shows an identifier, not a record uuid, and no tenant line', async () => {
    const id = '55555555-5555-4555-8555-555555555555';
    const entry = auditRow({
      table_name: 'suppliers',
      record_id: id,
      tenant_id: '77777777-7777-4777-8777-777777777777',
      before_json: { status: 'draft' },
      after_json: { status: 'active' },
    });
    await openDetail(entry);

    expect(screen.getByText('Record: Identifier')).toBeTruthy();
    expect(screen.queryByText(id)).toBeNull();
    expect(screen.getAllByTitle(id).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Tenant:/)).toBeNull();
    expect(screen.queryByText(entry.tenant_id)).toBeNull();
  });

  it('names an application and an asset by their stored reference', async () => {
    const id = '66666666-6666-4666-8666-666666666666';
    const application = auditRow({
      table_name: 'applications',
      record_id: id,
      tenant_id: '77777777-7777-4777-8777-777777777777',
      before_json: { name: 'Atlas' },
      after_json: { name: 'Atlas', sequential_id: 'APP-12' },
    });
    await openDetail(application);
    expect(screen.getByText('Record: APP-12')).toBeTruthy();
    expect(screen.queryByText(id)).toBeNull();
    expect(screen.queryByText(application.tenant_id)).toBeNull();

    const assetId = '88888888-8888-4888-8888-888888888888';
    const asset = auditRow({
      id: 'a-asset',
      table_name: 'assets',
      record_id: assetId,
      tenant_id: application.tenant_id,
      before_json: { name: 'db01' },
      after_json: { name: 'db01', asset_reference: 'AST-31' },
    });
    getMock.mockResolvedValue({ data: asset } as any);
    act(() => {
      grid.props?.onCellClicked({ data: asset });
    });
    expect(await screen.findByText('Record: AST-31')).toBeTruthy();
    expect(screen.queryByText('Record: APP-12')).toBeNull();
    expect(screen.queryByText(assetId)).toBeNull();
    expect(screen.queryByText(/Tenant:/)).toBeNull();
  });

  it('shows the raw JSON directly when a payload is not an object', async () => {
    const entry = auditRow({
      action: 'update',
      before_json: ['before'],
      after_json: ['after'],
    });
    await openDetail(entry);

    expect(screen.queryByRole('columnheader', { name: 'Field' })).toBeNull();
    expect(document.querySelector('pre')?.textContent).toContain('"before"');
    expect(screen.queryByRole('button', { name: 'View raw data' })).toBeNull();
  });

  it('closes the detail with Escape and with the close button', async () => {
    await i18n.changeLanguage('en');
    const row = {
      id: 'a-3', tenant_id: 't-1', table_name: 'suppliers', record_id: 'r-1', action: 'update',
      before_json: null, after_json: { id: 'r-1' }, user_id: null, user_email: null, user_name: null,
      source: 'user', source_ref: null, created_at: '2026-10-16T07:19:02Z',
    };
    getMock.mockResolvedValue({ data: row } as any);
    renderPage();
    const open = async () => {
      act(() => {
        grid.props?.onCellClicked({ data: row });
      });
      return screen.findByRole('dialog');
    };

    fireEvent.keyDown(await open(), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('searches the table labels of the reader language: the list, the filter values and the export send their codes', async () => {
    await i18n.changeLanguage('fr');
    getMock.mockResolvedValue(csvResponse() as any);
    renderPage();
    // The grid adds these parameters to its request when the search box holds the text.
    expect(grid.props?.searchParams('fournisseur')).toEqual({ q_tables: 'supplier_contacts,suppliers' });
    expect(grid.props?.searchParams('Liens de contrat')).toEqual({ q_tables: 'contract_links' });
    expect(grid.props?.searchParams('zzz')).toEqual({});
    expect(grid.props?.searchParams('e')).toEqual({});
    getMock.mockResolvedValueOnce({ data: { table_name: [] } } as any);
    await column('table_name').filterParams.getValues({ context: { getQueryState: () => ({ q: 'Fournisseurs', filters: {} }) } });
    expect(getMock).toHaveBeenCalledWith('/audit-logs/filter-values', { params: { fields: 'table_name', q: 'Fournisseurs', q_tables: 'suppliers' } });
    act(() => {
      grid.props?.onQueryStateChange({ sort: 'created_at:DESC', filterModel: {}, q: 'Fournisseurs' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Exporter' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(getMock).toHaveBeenCalledWith('/audit-logs/export', {
      params: { format: 'csv', sort: 'created_at:DESC', q: 'Fournisseurs', q_tables: 'suppliers' },
      responseType: 'blob',
    });
    // Accents and case aside, as the server folds a search.
    expect(auditTablesMatchingSearch('societes', i18n.getFixedT('fr', 'admin') as any)).toContain('companies');
  });

  const ctxId = '33333333-3333-4333-8333-333333333333';
  const costCenterId = '44444444-4444-4444-8444-444444444444';

  function exportEntry(resource: string, path: string, query: Record<string, unknown>, format: string) {
    return auditRow({
      id: `export-${resource}`,
      table_name: 'export',
      action: 'export',
      after_json: { resource, path, query, format, rows: 4 },
    });
  }

  async function openExport(entry: Record<string, any>) {
    getMock.mockResolvedValue({ data: entry } as any);
    renderPage();
    act(() => {
      grid.props?.onCellClicked({ data: entry });
    });
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/^(Exported|Exporté) ?:/);
    return dialog;
  }

  it('names a budget file export and folds the route under the raw data', async () => {
    const entry = exportEntry(
      'budget-lines/budget-file',
      '/budget-lines/budget-file/export',
      {
        amountYears: '2025,2026',
        columns: 'budget,forecast,actual',
        ctx: ctxId,
        detail: 'yearly',
        filters: JSON.stringify({
          status: { filterType: 'set', values: ['enabled'] },
          name: { filterType: 'text', type: 'contains', filter: 'Acme' },
        }),
        format: 'xlsx',
        language: 'en',
        q: 'hosting',
      },
      'xlsx',
    );
    const parameters = [
      'Years: 2025, 2026',
      'Columns: Budget, Forecast, Actuals',
      'Detail: Yearly totals',
      'Status: Enabled',
      'Name: Acme',
      'Format: Excel (.xlsx)',
      'Language: English',
      'Search: hosting',
    ].join(' ');

    const dialog = await openExport(entry);
    expect(within(dialog).getByText('Exported: Budget file')).toBeTruthy();
    expect(within(dialog).getByText('Budget file')).toBeTruthy();
    expect(within(dialog).getByText(parameters)).toBeTruthy();
    expect(within(dialog).getByText('Excel (.xlsx)')).toBeTruthy();
    expect(within(dialog).queryByText('Route')).toBeNull();
    expect(dialog.textContent).not.toContain('/budget-lines/budget-file/export');
    expect(dialog.textContent).not.toContain(ctxId);

    fireEvent.click(within(dialog).getByRole('button', { name: 'View raw data' }));
    const raw = Array.from(dialog.querySelectorAll('pre'), (node) => node.textContent).join('\n');
    expect(raw).toContain('/budget-lines/budget-file/export');
    expect(raw).toContain(ctxId);

    cleanup();
    await i18n.changeLanguage('fr');
    const french = await openExport(entry);
    expect(within(french).getByText('Exporté : Fichier budgétaire')).toBeTruthy();
    expect(within(french).getByText('Fichier budgétaire')).toBeTruthy();
    expect(within(french).getByText([
      'Années : 2025, 2026',
      'Colonnes : Budget, Prévision, Réalisé',
      'Détail : Totaux annuels',
      'Statut : Activé',
      'Nom : Acme',
      'Format : Excel (.xlsx)',
      'Langue : English',
      'Recherche : hosting',
    ].join(' '))).toBeTruthy();
    expect(within(french).queryByText('Route')).toBeNull();
    expect(french.textContent).not.toContain('/budget-lines/budget-file/export');
    fireEvent.click(within(french).getByRole('button', { name: 'Voir les données brutes' }));
    expect(Array.from(french.querySelectorAll('pre'), (node) => node.textContent).join('\n')).toContain('/budget-lines/budget-file/export');
  });

  it('names a report export and keeps an identifier out of the parameter text', async () => {
    const entry = exportEntry(
      'reports/budget/top-lines',
      '/reports/budget/top-lines/export',
      {
        costCenter: costCenterId,
        ctx: ctxId,
        format: 'csv',
        language: 'fr',
        measure: 'amount',
        metric: 'budget',
        runBuild: 'run',
        scope: 'opex',
        top: '10',
        tz: 'Europe/Paris',
        year: '2026',
      },
      'csv',
    );
    const parameters = [
      'Cost center: Identifier',
      'Format: CSV',
      'Language: Français',
      'Measure: Amount',
      'Metric: Budget',
      'Run or build: Run',
      'Scope: OPEX',
      'Top count: 10',
      'Time zone: Europe/Paris',
      'Year: 2026',
    ].join(' ');

    const dialog = await openExport(entry);
    expect(within(dialog).getByText('Exported: Top lines report')).toBeTruthy();
    expect(within(dialog).getByText('Top lines report')).toBeTruthy();
    expect(within(dialog).getByText(parameters)).toBeTruthy();
    expect(within(dialog).getByTitle(costCenterId)).toBeTruthy();
    expect(within(dialog).queryByTitle(ctxId)).toBeNull();
    expect(dialog.textContent).not.toContain(costCenterId);
    expect(dialog.textContent).not.toContain(ctxId);
    expect(within(dialog).queryByText('Route')).toBeNull();
    expect(dialog.textContent).not.toContain('/reports/budget/top-lines/export');

    fireEvent.click(within(dialog).getByRole('button', { name: 'View raw data' }));
    expect(Array.from(dialog.querySelectorAll('pre'), (node) => node.textContent).join('\n')).toContain('/reports/budget/top-lines/export');

    cleanup();
    await i18n.changeLanguage('fr');
    const french = await openExport(entry);
    expect(within(french).getByText('Exporté : Rapport du top lignes')).toBeTruthy();
    expect(within(french).getByText('Rapport du top lignes')).toBeTruthy();
    expect(within(french).getByText([
      'Centre de coûts : Identifiant',
      'Format : CSV',
      'Langue : Français',
      'Mesure : Montant',
      'Métrique : Budget',
      'Run ou build : Run',
      'Périmètre : OPEX',
      'Nombre de premiers : 10',
      'Fuseau horaire : Europe/Paris',
      'Année : 2026',
    ].join(' '))).toBeTruthy();
    expect(within(french).getByTitle(costCenterId)).toBeTruthy();
    expect(french.textContent).not.toContain(costCenterId);
    expect(french.textContent).not.toContain(ctxId);
  });

  it('has every audit log text in the four languages', () => {
    const flatten = (value: unknown, prefix = ''): Record<string, string> => {
      if (typeof value === 'string') return { [prefix]: value };
      return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
        (acc, [key, child]) => ({ ...acc, ...flatten(child, prefix ? `${prefix}.${key}` : key) }),
        {},
      );
    };
    const locales = { en, fr, de, es } as Record<string, any>;
    const english = flatten(en.auditLogs);
    const required = [
      ...AUDIT_EVENT_ACTIONS.map((action) => `actions.${action}`),
      ...AUTH_EVENT_REASONS.map((reason) => `reasons.${reason}`),
      ...Object.values(EXPORT_RESOURCE_KEYS).map((key) => `exportResources.${key}`),
      'values.unknownAccount', 'tableNames.auth', 'tableNames.export',
      'export.failed', 'export.tooMany', 'export.truncated',
      'details.reason', 'details.exported',
    ];
    for (const key of required) expect(english[key], key).toBeTruthy();
    const variables = (text: string) => (text.match(/\{\{\w+\}\}/g) ?? []).sort();
    for (const [language, locale] of Object.entries(locales)) {
      const texts = flatten(locale.auditLogs);
      expect(Object.keys(texts).sort(), language).toEqual(Object.keys(english).sort());
      for (const [key, text] of Object.entries(texts)) {
        expect(text, `${language} ${key}`).toBeTruthy();
        expect(variables(text), `${language} ${key}`).toEqual(variables(english[key]));
      }
    }
  });
});
