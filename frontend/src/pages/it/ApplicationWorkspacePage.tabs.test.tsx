import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import api from '../../api';
import ApplicationWorkspacePage, { OperationsTab, OverviewTab } from './ApplicationWorkspacePage';
import type { ReachVulnerabilities } from './workspace/ReachVulnerabilitiesSection';

const features = vi.hoisted(() => ({ vulnerabilityFeed: true }));

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({
  useTranslation: () => translation,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features } }) }));
vi.mock('../../hooks/useApplicationNav', () => ({
  useApplicationNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/fields/SupplierSelect', () => ({ default: () => null }));
vi.mock('../../components/fields/ContactSelect', () => ({ default: () => null }));
vi.mock('../../components/fields/CompanySelect', () => ({ default: () => null }));
vi.mock('../../components/fields/DepartmentMultiSelect', () => ({ default: () => null }));
vi.mock('../../components/fields/TeamMemberMultiSelect', () => ({ default: () => null }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../components/IntegratedDocumentEditor', () => ({ default: () => <div data-testid="description-editor" /> }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => <div data-testid="knowledge-panel" /> }));
vi.mock('../../components/history/RecordHistoryTab', () => ({
  default: ({ table, recordId }: { table: string; recordId: string }) => <div data-testid="record-history">{`${table}:${recordId}`}</div>,
}));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ byField: { accessMethod: [] }, labelFor: (_field: string, code: string) => code }),
}));

const mocked = vi.mocked(api);
const SECTION = 'workspace.application.relations.sections.technologies';
const VULNERABILITIES = 'pages.vulnerabilities.section.title';
const RECORD = 'workspace.application.relations.technologyServers.action';
const BADGE = 'pages.vulnerabilities.severeBadge.hint(count=2)';
const VULNERABILITIES_KEY = ['vulnerabilities', 'application', 'app-1'];

const counts = (open: Partial<ReachVulnerabilities['rows'][number]['open']>) => ({ critical: 0, high: 0, medium: 0, low: 0, none: 0, unknown: 0, ...open });
const reach: ReachVulnerabilities = {
  rows: [
    {
      technology: { id: 'tec-4', name: 'Java', reference: 'TEC-4' },
      version_id: null,
      label: null,
      open: counts({ critical: 1, high: 1 }),
      total: 2,
      severe: 2,
      exploited_severe: 1,
      servers: [],
      declared: true,
    },
  ],
  totals: { open: 2, severe: 2, exploited_severe: 1 },
};
const relationsData = (extra: Record<string, unknown> = {}) => ({
  year: 2026,
  budget_column: { key: 'planned', label: 'Budget' },
  budget_lines: [],
  contracts: [],
  projects: [],
  requests: [],
  tasks: [],
  technologies: [
    {
      id: 'tec-4', reference: 'TEC-4', name: 'Java', family: 'runtime', declared: true, hosted: false, versions: [], version_unknown: true, standard_support_end: null, via: [],
      declarations: [{ link_id: 'lnk-4', technology_version_id: null, version_label: null }],
    },
  ],
  processes: [],
  suggestions: [],
  also: { assets: 0, interfaces: 0, documents: 0 },
  ...extra,
});
const servers = [{ asset_id: 'srv-1', name: 'srv-etl-1', asset_reference: 'AST-1', environments: ['prod'], roles: [] }];

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderTab() {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/applications/app-1/relations') {
      return {
        data: {
          year: 2026,
          budget_column: { key: 'planned', label: 'Budget' },
          budget_lines: [],
          contracts: [],
          projects: [],
          requests: [],
          tasks: [],
          technologies: [
            { id: 'tec-4', reference: 'TEC-4', name: 'Java', family: 'runtime', declared: true, hosted: false, versions: [], version_unknown: true, standard_support_end: null, via: [] },
          ],
          processes: [],
          suggestions: [],
          also: { assets: 0, interfaces: 0, documents: 0 },
        },
      } as never;
    }
    throw new Error(`unexpected GET ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <OperationsTab
            app={{ id: 'app-1', access_methods: [], support_contacts: [], support_notes: null, external_facing: false, etl_enabled: false, is_suite: false } as never}
            canManage
            onPatch={async () => undefined}
          />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  features.vulnerabilityFeed = true;
});

describe('Operations tab', () => {
  it('shows technical information, then technologies, and no support sections', async () => {
    renderTab();
    const section = await screen.findByRole('region', { name: SECTION });
    await screen.findByText('Java');
    const technical = screen.getByRole('heading', { name: 'workspace.application.technical.sectionTitle' });
    expect(technical.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'workspace.application.technical.support' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'workspace.application.technical.supportNotes' })).toBeNull();
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/applications/app-1/relations'));
  });
});

describe('Overview tab support', () => {
  const contact = { id: 'sc-1', contact_id: 'c-1', role: 'Vendor', contact: { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' } };

  function renderOverview(onPatch = vi.fn(async () => undefined), onRefresh = vi.fn(async () => undefined)) {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <OverviewTab
            app={{ id: 'app-1', support_contacts: [contact], support_notes: 'Call the vendor' } as never}
            canEditManagedDocs
            canCreateKnowledge
            canManage
            editorRef={React.createRef()}
            connections={{ type: 'none' } as never}
            onOpenApplication={() => undefined}
            onShowInterfaces={() => undefined}
            onPatch={onPatch}
            onRefresh={onRefresh}
          />
        </MemoryRouter>
      </ThemeProvider>,
    );
    return { onPatch, onRefresh };
  }

  it('shows support contacts and support notes at the bottom', () => {
    renderOverview();
    const support = screen.getByRole('heading', { name: 'workspace.application.technical.support' });
    const notes = screen.getByRole('heading', { name: 'workspace.application.technical.supportNotes' });
    const knowledge = screen.getByTestId('knowledge-panel');
    expect(knowledge.compareDocumentPosition(support) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(support.compareDocumentPosition(notes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Call the vendor')).toBeInTheDocument();
  });

  it('saves support notes and contacts through the same calls', async () => {
    mocked.post.mockResolvedValue({ data: [] } as never);
    const { onPatch, onRefresh } = renderOverview();
    const notes = screen.getByDisplayValue('Call the vendor');
    fireEvent.change(notes, { target: { value: 'Call the desk' } });
    expect(onPatch).not.toHaveBeenCalled();
    fireEvent.blur(notes);
    expect(onPatch).toHaveBeenCalledWith({ support_notes: 'Call the desk' });
    const row = screen.getByText('Ada Lovelace').closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /removeContact/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/support-contacts/bulk-replace', { contacts: [] }));
    await waitFor(() => expect(onRefresh).toHaveBeenCalled());
  });
});

describe('Operations tab vulnerabilities', () => {
  function renderOperations(vulnerabilities: ReachVulnerabilities | null, relations = relationsData()) {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/applications/app-1/relations') return { data: relations } as never;
      throw new Error(`unexpected GET ${url}`);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(VULNERABILITIES_KEY, vulnerabilities);
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter>
            <OperationsTab
              app={{ id: 'app-1', sequential_id: 'APP-1', access_methods: [], external_facing: false, etl_enabled: false, is_suite: false } as never}
              canManage
              onPatch={async () => undefined}
              vulnerabilities={vulnerabilities}
            />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    return client;
  }

  it('shows the vulnerabilities last, after the technologies', async () => {
    renderOperations(reach);
    const technologies = await screen.findByRole('region', { name: SECTION });
    const vulnerabilities = screen.getByRole('region', { name: VULNERABILITIES });
    expect(technologies.compareDocumentPosition(vulnerabilities) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(vulnerabilities).getByRole('link', { name: 'pages.vulnerabilities.section.see' }).getAttribute('href'))
      .toBe('/it/vulnerabilities?application=APP-1&technology=TEC-4');
  });

  it('shows no vulnerabilities section without data', async () => {
    renderOperations(null);
    await screen.findByRole('region', { name: SECTION });
    expect(screen.queryByRole('region', { name: VULNERABILITIES })).toBeNull();
  });

  it('records a declared line on a server and reads the vulnerabilities again', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true } } as never);
    const client = renderOperations(reach, relationsData({ deployment_servers: servers }));
    const vulnerabilities = await screen.findByRole('region', { name: VULNERABILITIES });
    await screen.findByRole('table', { name: SECTION });
    fireEvent.click(within(vulnerabilities).getByRole('button', { name: RECORD }));
    expect(await screen.findByText('workspace.application.relations.technologyServers.proposalUnknown(technology=Java)')).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /srv-etl-1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.relations.technologyServers.recordOn(count=1)' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/technologies', { id: 'tec-4', technology_version_id: null, asset_ids: ['srv-1'] }));
    await waitFor(() => expect(client.getQueryState(VULNERABILITIES_KEY)?.isInvalidated).toBe(true));
  });

  it('offers no recording without deployment servers', async () => {
    renderOperations(reach);
    const vulnerabilities = await screen.findByRole('region', { name: VULNERABILITIES });
    await screen.findByRole('table', { name: SECTION });
    expect(within(vulnerabilities).getByText('workspace.application.relations.technologyLink.declared')).toBeInTheDocument();
    expect(within(vulnerabilities).queryByRole('button', { name: RECORD })).toBeNull();
  });
});

describe('Application workspace vulnerabilities', () => {
  const APP = {
    id: 'app-1', sequential_id: 'APP-1', name: 'Billing', category: 'business', lifecycle: 'active', criticality: null,
    supplier_id: null, editor: null, version: null, go_live_date: null, end_of_support_date: null, retired_date: null,
    external_facing: false, is_suite: false, etl_enabled: false, access_methods: [], owners: [], companies: [], departments: [],
    data_residency: [], support_contacts: [], support_notes: null, deployments: [],
  };

  function renderPage(
    path: string,
    vulnerabilities: ReachVulnerabilities | (() => Promise<unknown>) = reach,
    application: (() => Promise<unknown>) | null = null,
    interfaces: unknown[] | (() => Promise<unknown>) = [],
  ) {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/applications/app-1/vulnerabilities') {
        return (typeof vulnerabilities === 'function' ? vulnerabilities() : { data: vulnerabilities }) as never;
      }
      if (url === '/applications/app-1/relations') return { data: relationsData() } as never;
      if (url === '/applications/app-1/relations-count') return { data: { total: 0 } } as never;
      if (url === '/interfaces/by-application/app-1') return (typeof interfaces === 'function' ? interfaces() : { data: { items: interfaces } }) as never;
      if (url === '/incidents') return { data: { items: [], total: 0 } } as never;
      if (/^\/applications\/[^/]+$/.test(url)) return (application ? application() : { data: APP }) as never;
      throw new Error(`unexpected GET ${url}`);
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <MemoryRouter initialEntries={[path]}>
              <Routes>
                <Route path="/it/applications/:id/:tab" element={<><ApplicationWorkspacePage /><Location /></>} />
              </Routes>
            </MemoryRouter>
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  }

  const vulnerabilityCalls = () => mocked.get.mock.calls.filter(([url]) => String(url).endsWith('/vulnerabilities'));

  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => store.clear(),
    });
  });

  it('opens an interface and its counterpart through real links, and does not name the open application as its middleware', async () => {
    const base = {
      environment: 'prod', source_application_id: 'app-1', source_application_name: 'Billing',
      target_application_id: 'app-2', target_application_name: 'ERP', via_middleware: true,
    };
    renderPage('/it/applications/app-1/interfaces', reach, null, [
      { ...base, id: 'int-1', name: 'Orders', interface_reference: 'INT-1', target_application_reference: 'APP-2', middleware_application_ids: ['app-1'], middleware_application_names: ['Billing'] },
      { ...base, id: 'int-2', name: 'Invoices', interface_reference: 'INT-2', middleware_application_ids: ['app-1', 'mw-1'], middleware_application_names: ['Billing', 'Hub'] },
    ]);
    const orders = await screen.findByRole('link', { name: /Orders/ });
    expect(orders.getAttribute('href')).toBe('/it/interfaces/INT-1/overview');
    // The counterpart opens by its reference, by its id only when it has none.
    expect(screen.getAllByRole('link', { name: 'ERP' }).map((link) => link.getAttribute('href'))).toEqual(['/it/applications/APP-2/overview', '/it/applications/app-2/overview']);
    expect(screen.getByText('workspace.application.interfaces.viaNames(names=Hub)')).toBeInTheDocument();
    expect(screen.queryByText(/names=Billing/)).toBeNull();
    expect(screen.getByText('enums.environment.prod')).toBeInTheDocument();
  });

  it('says the interfaces could not be loaded and reads them again on retry', async () => {
    let calls = 0;
    renderPage('/it/applications/app-1/interfaces', reach, null, async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return { data: { items: [] } };
    });
    expect(await screen.findByText('workspace.application.interfaces.loadFailed')).toBeInTheDocument();
    expect(screen.queryByText('workspace.application.interfaces.noInterfaces')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.retry' }));
    expect(await screen.findByText('workspace.application.interfaces.noInterfaces')).toBeInTheDocument();
    expect(calls).toBe(2);
  });

  it('counts distinct interfaces and lists the unbound ones last, without environment', async () => {
    const row = (id: string, name: string, environment: string | null) => ({
      id, name, environment, interface_reference: id.toUpperCase(), via_middleware: false,
      source_application_id: 'app-1', source_application_name: 'Billing', target_application_id: 'app-2', target_application_name: 'ERP',
    });
    renderPage('/it/applications/app-1/interfaces', reach, null, [
      row('int-1', 'Orders', 'prod'), row('int-1', 'Orders', 'test'), row('int-2', 'Invoices', null),
    ]);
    const unbound = await screen.findByText('workspace.application.interfaces.unbound');
    expect(screen.getByText('workspace.application.interfaces.unboundHint')).toBeInTheDocument();
    const test = screen.getByText('enums.environment.test');
    expect(screen.getByText('enums.environment.prod').compareDocumentPosition(test) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(test.compareDocumentPosition(unbound) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getAllByText('Orders')).toHaveLength(2);
    expect(screen.getAllByText('Invoices')).toHaveLength(1);
    const tab = screen.getByRole('tab', { name: /workspace\.application\.tabs\.interfaces/ });
    expect(tab.textContent).toMatch(/2$/);
  });

  it('links the severe badge to the Vulnerabilities page filtered on the application', async () => {
    renderPage('/it/applications/app-1/overview');
    const badge = await screen.findByRole('link', { name: BADGE });
    expect(badge.getAttribute('href')).toBe('/it/vulnerabilities?application=APP-1');
    expect(screen.getByTestId('vulnerability-severe-badge').querySelector('[data-severity="critical"]')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'pages.vulnerabilities.severeBadge.exploited(count=1)' })).toBeInTheDocument();
    expect(vulnerabilityCalls()).toHaveLength(1);
  });

  it('shows the metadata bar in one go, once the vulnerabilities have arrived', async () => {
    let answer: (value: unknown) => void = () => undefined;
    renderPage('/it/applications/app-1/overview', () => new Promise((resolve) => { answer = resolve; }));
    await waitFor(() => expect(vulnerabilityCalls()).toHaveLength(1));
    expect(screen.getByTestId('metadata-pending')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByRole('link', { name: BADGE })).toBeNull();
    answer({ data: reach });
    expect(await screen.findByRole('link', { name: BADGE })).toBeInTheDocument();
    expect(screen.queryByTestId('metadata-pending')).toBeNull();
  });

  it('shows the metadata bar without the badge when the vulnerabilities cannot be read', async () => {
    renderPage('/it/applications/app-1/overview', () => Promise.reject(new Error('down')));
    await waitFor(() => expect(vulnerabilityCalls()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('metadata-pending')).toBeNull());
    expect(screen.getByText('workspace.application.meta.goLive')).toBeInTheDocument();
    expect(screen.queryByTestId('vulnerability-severe-badge')).toBeNull();
  });

  it('shows the metadata bar without waiting while the vulnerability feed is off', async () => {
    features.vulnerabilityFeed = false;
    renderPage('/it/applications/app-1/overview');
    expect(await screen.findByText('workspace.application.meta.goLive')).toBeInTheDocument();
    expect(screen.queryByTestId('metadata-pending')).toBeNull();
    expect(vulnerabilityCalls()).toHaveLength(0);
  });

  it('links the section count to the Vulnerabilities page filtered on the application', async () => {
    renderPage('/it/applications/app-1/operations');
    const count = await screen.findByTestId('reach-vulnerabilities-count');
    expect(count.textContent).toBe('2');
    expect(count.getAttribute('href')).toBe('/it/vulnerabilities?application=APP-1');
  });

  it('shows no badge and no section for an application out of service', async () => {
    renderPage('/it/applications/app-1/operations', { rows: [], totals: null });
    await screen.findByRole('region', { name: SECTION });
    await waitFor(() => expect(vulnerabilityCalls()).toHaveLength(1));
    expect(screen.queryByTestId('vulnerability-severe-badge')).toBeNull();
    expect(screen.queryByRole('region', { name: VULNERABILITIES })).toBeNull();
  });

  it('reads nothing while the vulnerability feed is off', async () => {
    features.vulnerabilityFeed = false;
    renderPage('/it/applications/app-1/operations');
    await screen.findByRole('region', { name: SECTION });
    expect(vulnerabilityCalls()).toHaveLength(0);
    expect(screen.queryByTestId('vulnerability-severe-badge')).toBeNull();
    expect(screen.queryByRole('region', { name: VULNERABILITIES })).toBeNull();
  });

  it('shows no untitled title while the application loads', async () => {
    let answer: (value: unknown) => void = () => undefined;
    renderPage('/it/applications/app-1/overview', reach, () => new Promise((resolve) => { answer = resolve; }));
    await waitFor(() => expect(mocked.get.mock.calls.some(([url]) => url === '/applications/app-1')).toBe(true));
    expect(screen.queryByText('workspace.application.untitled')).toBeNull();
    answer({ data: { ...APP, name: '' } });
    expect(await screen.findByText('workspace.application.untitled')).toBeInTheDocument();
  });

  it('shows the History tab last and renders the application history by its id, from an APP-N route', async () => {
    renderPage('/it/applications/APP-1/history');
    const history = await screen.findByTestId('record-history');
    // The route names the reference; the history reads the uuid the page loaded.
    expect(history.textContent).toBe('applications:app-1');
    const tabs = screen.getAllByRole('tab');
    expect(tabs[tabs.length - 1].textContent).toContain('workspace.application.tabs.history');
    expect(screen.getByTestId('location').textContent).toBe('/it/applications/APP-1/history');
  });

  it('keeps the History tab disabled while creating an application', async () => {
    renderPage('/it/applications/new/overview');
    await screen.findByRole('textbox', { name: 'common:buttons.editTitle' });
    const history = screen.getByRole('tab', { name: /workspace\.application\.tabs\.history/ });
    expect(history).toBeDisabled();
    expect(screen.queryByTestId('record-history')).toBeNull();
  });

  it('reads nothing while creating an application', async () => {
    renderPage('/it/applications/new/overview');
    await screen.findByRole('textbox', { name: 'common:buttons.editTitle' });
    expect(vulnerabilityCalls()).toHaveLength(0);
    expect(screen.queryByTestId('vulnerability-severe-badge')).toBeNull();
  });
});
