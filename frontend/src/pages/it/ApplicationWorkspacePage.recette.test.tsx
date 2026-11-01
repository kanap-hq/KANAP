import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import api from '../../api';
import ApplicationWorkspacePage from './ApplicationWorkspacePage';

const auth = vi.hoisted(() => ({ rank: 2 }));
const RANKS: Record<string, number> = { reader: 1, member: 2, manager: 3, admin: 4 };

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => undefined } }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { vulnerabilityFeed: false } } }) }));
vi.mock('../../hooks/useApplicationNav', () => ({ useApplicationNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }) }));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/fields/SupplierSelect', () => ({ default: () => null }));
vi.mock('../../components/fields/ContactSelect', () => ({ default: () => null }));
vi.mock('../../components/fields/CompanySelect', () => ({ default: () => null }));
const departmentField = vi.hoisted(() => ({ mounts: 0 }));
vi.mock('../../components/fields/DepartmentMultiSelect', async () => {
  const { useEffect } = await import('react');
  return {
    default: function DepartmentField({ onChange }: { onChange: (ids: string[]) => void }) {
      useEffect(() => { departmentField.mounts += 1; }, []);
      return <button type="button" onClick={() => onChange(['d-1'])}>pick department</button>;
    },
  };
});
vi.mock('../../components/fields/TeamMemberMultiSelect', () => ({
  default: ({ label, onChange }: { label: string; onChange: (ids: string[]) => Promise<void> }) => (
    <button type="button" onClick={() => { void onChange(['u-9']); }}>{`pick ${label}`}</button>
  ),
}));
vi.mock('../ForbiddenPage', () => ({ default: () => <div data-testid="forbidden" /> }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: (_resource: string, level: string) => auth.rank >= RANKS[level] }) }));
vi.mock('../../components/IntegratedDocumentEditor', () => ({ default: () => <div data-testid="description-editor" /> }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => <div data-testid="knowledge-panel" /> }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [{ code: 'high', label: 'High', rank: 1 }], cyberCriticalityLevels: [], dataClasses: [], recoveryWaves: [] } }),
}));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ byField: { accessMethod: [], applicationCategory: [], lifecycleStatus: [{ code: 'active', label: 'Active' }] }, labelFor: (_f: string, code: string) => code }),
}));

const mocked = vi.mocked(api);
const SERVER_ERROR = { response: { status: 500, data: {} } };
const application = {
  id: 'app-1', sequential_id: 'APP-1', name: 'Atlas', category: 'business', supplier_id: null, editor: 'Acme', lifecycle: 'active', criticality: 'high',
  version: '2.0', go_live_date: '2026-01-01', owners: [], companies: [], departments: [], data_residency: [], access_methods: [], users_mode: 'it_users',
  support_notes: null, support_contacts: [{ id: 'sc-1', contact_id: 'c-1', role: 'Vendor', contact: { first_name: 'Ada', last_name: 'Lovelace' } }],
  predecessor_id: 'app-0', is_suite: false, deployments: [],
};

function renderPage(path = '/it/applications/app-1/overview', detail: () => unknown = () => application) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/applications/app-1') return { data: detail() } as never;
    if (url === '/departments/d-1') return { data: { id: 'd-1', company_id: 'co-1', name: 'Finance' } } as never;
    if (url === '/applications/app-1/version-lineage') {
      return { data: { predecessors: [{ id: 'app-0', sequential_id: 'APP-3', name: 'Atlas 1' }], successors: [{ id: 'app-2', sequential_id: 'APP-9', name: 'Atlas 3' }] } } as never;
    }
    if (url === '/applications/app-1/suites') return { data: { items: [{ id: 'su-1', name: 'Office suite' }] } } as never;
    if (url === '/interfaces/by-application/app-1') return { data: { items: [] } } as never;
    if (url === '/applications/app-1/relations') return { data: { processes: [] } } as never;
    return { data: { items: [], total: 0 } } as never;
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/it/applications" element={<div data-testid="application-list" />} />
              <Route path="/it/applications/:id/:tab" element={<ApplicationWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('Application workspace, recette C1a', () => {
  beforeEach(() => {
    cleanup();
    auth.rank = 2;
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => undefined) }, configurable: true });
  });

  it('refuses the creation screen to a reader', async () => {
    auth.rank = 1;
    renderPage('/it/applications/new/overview');
    expect(await screen.findByTestId('forbidden')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows a reader no new version button, no menu chips and no support notes hint', async () => {
    auth.rank = 1;
    renderPage();
    await screen.findByText('Active');
    expect(screen.queryByRole('button', { name: 'workspace.application.createNewVersion' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Active' })).toBeNull();
    expect(screen.queryByRole('button', { name: /v2\.0/ })).toBeNull();
    expect(screen.queryByPlaceholderText('workspace.application.technical.supportNotesPlaceholder')).toBeNull();
  });

  it('names the previous and next versions and the suites the application is included in', async () => {
    renderPage();
    const previous = await screen.findByRole('link', { name: 'APP-3 Atlas 1' });
    expect(previous.getAttribute('href')).toBe('/it/applications/app-0/overview');
    expect(screen.getByRole('link', { name: 'APP-9 Atlas 3' }).getAttribute('href')).toBe('/it/applications/app-2/overview');
    expect(await screen.findByRole('link', { name: 'Office suite' })).toBeTruthy();
    expect(screen.getByLabelText('workspace.application.overview.includedIn')).toBeTruthy();
  });

  it('removes a suite link, replaces the list and offers to undo', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true } } as never);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=Office suite)' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/suites/bulk-replace', { suite_ids: [] }));
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.undo.undo' }));
    await waitFor(() => expect(mocked.post).toHaveBeenLastCalledWith('/applications/app-1/suites/bulk-replace', { suite_ids: ['su-1'] }));
  });

  it('tells the person when the owners cannot be saved', async () => {
    mocked.post.mockRejectedValue(SERVER_ERROR);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'pick workspace.application.ownership.businessOwners' }));
    expect(await screen.findByText('messages.saveOwnersFailed')).toBeTruthy();
  });

  it('removes a support contact with a message and an undo, and tells the person of a refusal', async () => {
    mocked.post.mockResolvedValueOnce({ data: [] } as never);
    renderPage();
    const row = (await screen.findByText('Ada Lovelace')).closest('tr') as HTMLElement;
    fireEvent.click(within(row).getByRole('button', { name: /removeContact/ }));
    expect(await screen.findByText('workspace.application.undo.contactRemoved')).toBeTruthy();
    mocked.post.mockResolvedValueOnce({ data: [] } as never);
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.undo.undo' }));
    await waitFor(() => expect(mocked.post).toHaveBeenLastCalledWith('/applications/app-1/support-contacts/bulk-replace', { contacts: [{ contact_id: 'c-1', role: 'Vendor' }] }));

    mocked.post.mockRejectedValueOnce(SERVER_ERROR);
    fireEvent.click(within(row).getByRole('button', { name: /removeContact/ }));
    expect(await screen.findByText('messages.saveSupportContactsFailed')).toBeTruthy();
  });

  it('says "Copied" after the reference is copied and reports a refused clipboard', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('APP-1'));
    expect(await screen.findByText('workspace.application.referenceCopied')).toBeTruthy();
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValueOnce(SERVER_ERROR);
    fireEvent.click(screen.getByText('APP-1'));
    expect(await screen.findByText('messages.copyReferenceFailed')).toBeTruthy();
  });

  it('keeps the department field mounted while a chosen department is saved', async () => {
    let current: typeof application = { ...application, companies: [{ company_id: 'co-1' }] as never };
    renderPage(undefined, () => current);
    mocked.post.mockImplementation(async (url: string) => {
      if (url.endsWith('/companies/bulk-replace')) return { data: [] } as never;
      if (url.endsWith('/departments/bulk-replace')) {
        current = { ...current, companies: [], departments: [{ department_id: 'd-1' }] as never };
        return { data: current.departments } as never;
      }
      return { data: {} } as never;
    });
    const pick = await screen.findByRole('button', { name: 'pick department' });
    const mountsBefore = departmentField.mounts;
    fireEvent.click(pick);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/departments/d-1'));
    await waitFor(() => expect(screen.getByText('workspace.application.ownership.audienceDepartmentsOnly')).toBeTruthy());
    expect(departmentField.mounts).toBe(mountsBefore);
  });

  it('says why the users are 0 when the audience is departments without a headcount', async () => {
    renderPage(undefined, () => ({ ...application, departments: [{ department_id: 'd-1' }], derived_total_users: 0 }));
    expect(await screen.findByText('workspace.application.ownership.usersNoDepartmentHeadcount')).toBeTruthy();
  });

  it('keeps an empty title open with the message', async () => {
    renderPage();
    fireEvent.click(await screen.findByText('Atlas'));
    const input = screen.getByDisplayValue('Atlas');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert').textContent).toBe('messages.nameRequired');
    expect(input.isConnected && input.getAttribute('aria-invalid')).toBe('true');
    expect(mocked.patch).not.toHaveBeenCalled();
  });
});
