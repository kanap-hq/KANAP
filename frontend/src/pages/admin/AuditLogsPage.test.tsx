import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  auditUserLabel,
} from './auditLogLabels';
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

  it('offers an administrator the CSV export of the list', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
  });

  it('shows nothing of the log without the users admin level', () => {
    auth.admin = false;
    renderPage();
    expect(screen.getByText('Forbidden')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Export CSV' })).toBeNull();
  });

  it("exports with the list's filters, search, sort and the screen language", async () => {
    await i18n.changeLanguage('fr');
    getMock.mockResolvedValue(csvResponse() as any);
    renderPage();
    const filterModel = { table_name: { filterType: 'set', values: ['auth'] } };
    act(() => {
      grid.props?.onQueryStateChange({ sort: 'created_at:ASC', filterModel, q: 'alice' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Exporter CSV' }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(getMock).toHaveBeenCalledWith('/audit-logs/export', {
      params: { language: 'fr', sort: 'created_at:ASC', q: 'alice', filters: JSON.stringify(filterModel) },
      responseType: 'blob',
    });
    expect(vi.mocked(downloadBlob).mock.calls[0][1]).toBe('audit-log-2026-10-09.csv');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says when the file stopped at the row limit', async () => {
    getMock.mockResolvedValue(csvResponse({ 'x-export-truncated': '100000' }) as any);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('The file holds the first 100,000 entries. Narrow the filters to export the rest.')).toBeTruthy();
  });

  it('says when exports come too fast, and when one fails', async () => {
    getMock.mockRejectedValueOnce({ response: { status: 429 } });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(await screen.findByText('Too many exports in a short time. Try again in a minute.')).toBeTruthy();
    getMock.mockRejectedValueOnce({ response: { status: 500 } });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
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
    expect(column('table_name').valueFormatter({ data: { table_name: 'suppliers' } })).toBe('suppliers');
    expect(column('table_name').filterParams.labelFormatter('export')).toBe('Export');
    expect(column('action').filterParams.labelFormatter('login_failed')).toBe('Failed sign-in');
    expect(column('source_ref').valueFormatter({ data: { table_name: 'auth', source_ref: 'bad_password' } })).toBe('Wrong password');
    expect(auditReasonLabel({ table_name: 'auth', source_ref: 'unknown_user' }, t)).toBe('No account with this address');
    expect(auditReasonLabel({ table_name: 'suppliers', source_ref: 'import-7' }, t)).toBe('import-7');
    expect(auditTableLabel({ table_name: 'export', after_json: { resource: 'something-new' } }, t)).toBe('Export');
    expect(auditUserLabel({ table_name: 'auth', user_id: null }, t)).toBe('Unknown account');
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
      'values.unknownAccount', 'tables.auth', 'tables.export',
      'export.button', 'export.failed', 'export.tooMany', 'export.truncated',
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
