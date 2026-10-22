import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import type {
  ApplicationRelationRow,
  AssetRelationRow,
  TechnologyRelationRow,
} from '../../../components/workspace/relations';
import IncidentRelationsTab from './IncidentRelationsTab';

const rights = vi.hoisted(() => ({
  incidents: 'contributor',
  infrastructure: 'reader',
  applications: 'reader',
} as Record<string, string>));

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts
      ? Object.entries(opts).filter(([name]) => name !== 'defaultValue').map(([name, value]) => `${name}=${value}`).join(',')
      : '';
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
      const rank: Record<string, number> = { reader: 1, contributor: 2, member: 3, manager: 3, admin: 4 };
      const current = rights[resource];
      if (!current) return false;
      return (rank[current] ?? 0) >= (rank[level] ?? 0);
    },
  }),
}));
vi.mock('../../../components/EntityTasksPanel', () => ({
  default: ({ entityType, entityId, disabled }: { entityType: string; entityId: string; disabled?: boolean }) => (
    <div data-testid="incident-tasks" data-type={entityType} data-id={entityId} data-disabled={disabled ? 'yes' : 'no'} />
  ),
}));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (field: string, code?: string | null) => (code ? `${field}:${code}` : '') }),
}));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [{ code: 'high', label: 'High' }] } }),
}));

const mocked = vi.mocked(api);

type Suggestion = {
  type: 'technology';
  id: string;
  reference: string;
  name: string;
  family: string;
  vendor: string | null;
  via: { kind: 'asset_technology' | 'application_technology'; label: string };
};

type Relations = {
  assets: AssetRelationRow[] | null;
  applications: ApplicationRelationRow[] | null;
  technologies: TechnologyRelationRow[] | null;
  editable: boolean;
  suggestions: Suggestion[];
};

function relations(overrides: Partial<Relations> = {}): Relations {
  return {
    assets: [
      { id: 'as-1', reference: 'AST-2', name: 'sap-prd-db01', kind: 'physical_server', environment: 'prod', status: 'active' },
      { id: 'as-2', reference: 'AST-8', name: 'old-printer', kind: 'virtual_machine', environment: 'test', status: 'retired' },
    ],
    applications: [
      { id: 'app-1', reference: 'APP-4', name: 'SAP S/4HANA', lifecycle: 'active', business_criticality: 'high', status: 'enabled' },
      { id: 'app-2', reference: 'APP-9', name: 'Legacy CRM', lifecycle: 'retired', business_criticality: null, status: 'disabled' },
    ],
    technologies: [
      { id: 'tec-1', reference: 'TEC-9', name: 'Oracle Database', family: 'database', vendor: 'Oracle' },
      { id: 'tec-2', reference: 'TEC-3', name: 'Tomcat', family: 'runtime', vendor: null },
    ],
    editable: true,
    suggestions: [
      {
        type: 'technology', id: 'tec-4', reference: 'TEC-4', name: 'Nginx', family: 'runtime', vendor: 'F5',
        via: { kind: 'asset_technology', label: 'AST-2' },
      },
      {
        type: 'technology', id: 'tec-5', reference: 'TEC-5', name: 'PostgreSQL', family: 'database', vendor: 'PostgreSQL',
        via: { kind: 'application_technology', label: 'APP-4' },
      },
    ],
    ...overrides,
  };
}

const EDGE = { id: 'as-8', reference: 'AST-11', name: 'edge-fw', kind: 'virtual_machine', environment: 'prod', status: 'active' } as const;

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function grantContributor() {
  rights.incidents = 'contributor';
  rights.infrastructure = 'reader';
  rights.applications = 'reader';
}

function renderTab(
  data: Relations,
  { readOnly = false, onLinksChange = vi.fn(), onTasksChange = vi.fn() }: {
    readOnly?: boolean;
    onLinksChange?: (kind: string, count: number) => void;
    onTasksChange?: () => void;
  } = {},
) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/incidents/inc-1/relations') return { data } as never;
    if (url === '/assets') {
      return { data: { items: [
        { id: 'as-1', name: 'sap-prd-db01', asset_reference: 'AST-2' },
        { id: 'as-8', name: 'edge-fw', asset_reference: 'AST-11' },
      ] } } as never;
    }
    if (url === '/applications') {
      return { data: { items: [
        { id: 'app-1', name: 'SAP S/4HANA', sequential_id: 'APP-4' },
        { id: 'app-8', name: 'Billing', sequential_id: 'APP-8' },
      ] } } as never;
    }
    if (url === '/technologies/lookup') {
      return { data: { items: [
        { id: 'tec-1', name: 'Oracle Database', reference: 'TEC-9', editor: 'Oracle' },
        { id: 'tec-8', name: 'Redis', reference: 'TEC-8', editor: 'Redis' },
      ] } } as never;
    }
    return { data: [] } as never;
  });
  mocked.post.mockImplementation(async (url: string, body?: unknown) => {
    const id = (body as { id?: string } | undefined)?.id;
    if (url === '/incidents/inc-1/relations/assets' && id === 'as-8' && data.assets) {
      data.assets = [...data.assets, { ...EDGE }];
    }
    if (url === '/incidents/inc-1/relations/technologies' && id && data.technologies) {
      const suggestion = data.suggestions.find((row) => row.id === id);
      data.suggestions = data.suggestions.filter((row) => row.id !== id);
      if (suggestion) {
        data.technologies = [...data.technologies, {
          id: suggestion.id,
          reference: suggestion.reference,
          name: suggestion.name,
          family: suggestion.family,
          vendor: suggestion.vendor,
        }];
      }
    }
    return { data: { ok: true, changed: true } } as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['incident-entries', 'inc-1'], []);
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <IncidentRelationsTab
            incidentId="inc-1"
            readOnly={readOnly}
            onLinksChange={onLinksChange}
            onTasksChange={onTasksChange}
          />
          <Location />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onLinksChange, onTasksChange, client };
}

const COL = (name: string) => `workspace.application.relations.columns.${name}`;
const SECTION = (name: string) => `workspace.application.relations.sections.${name}`;
const ADD = 'workspace.application.relations.add';

describe('IncidentRelationsTab', () => {
  beforeEach(() => {
    grantContributor();
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.delete.mockReset();
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    mocked.delete.mockResolvedValue({ data: { ok: true } } as never);
  });

  it('shows one table per type, in order, and opens the record', async () => {
    renderTab(relations());
    await screen.findByText('sap-prd-db01');

    const labels = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(labels).toEqual([
      SECTION('assets'),
      SECTION('applications'),
      SECTION('technologies'),
      SECTION('related'),
    ]);

    const assets = screen.getByRole('region', { name: SECTION('assets') });
    expect(within(assets).getByText('AST-2')).toBeTruthy();
    expect(within(assets).getByText('sap-prd-db01')).toBeTruthy();
    expect(within(assets).getByText('serverKind:physical_server')).toBeTruthy();
    expect(within(assets).getByText('enums.environment.prod')).toBeTruthy();
    expect(within(assets).getByText('lifecycleStatus:active')).toBeTruthy();
    expect(within(assets).getByText('old-printer')).toBeTruthy();
    expect(within(assets).getByText('lifecycleStatus:retired')).toBeTruthy();
    expect(within(assets).getByText('pages.assets.columns.environment')).toBeTruthy();
    expect(within(assets).getByText(COL('status'))).toBeTruthy();

    const applications = screen.getByRole('region', { name: SECTION('applications') });
    expect(within(applications).getByText('APP-4')).toBeTruthy();
    expect(within(applications).getByText('SAP S/4HANA')).toBeTruthy();
    expect(within(applications).getByText('lifecycleStatus:active')).toBeTruthy();
    expect(within(applications).getByText('High')).toBeTruthy();
    expect(within(applications).getByText('Legacy CRM')).toBeTruthy();
    expect(within(applications).getByText('—')).toBeTruthy();
    expect(within(applications).getByText('common.lifecycle')).toBeTruthy();
    expect(within(applications).getByText('classification.business_criticality')).toBeTruthy();

    const technologies = screen.getByRole('region', { name: SECTION('technologies') });
    expect(within(technologies).getByText('TEC-9')).toBeTruthy();
    expect(within(technologies).getByText('Oracle Database')).toBeTruthy();
    expect(within(technologies).getByText('technologyFamily:database')).toBeTruthy();
    expect(within(technologies).getByText('Oracle')).toBeTruthy();
    expect(within(technologies).getByText('Tomcat')).toBeTruthy();
    expect(within(technologies).getByText('—')).toBeTruthy();
    expect(within(technologies).getByText('pages.technologies.columns.editor')).toBeTruthy();

    const related = screen.getByRole('region', { name: SECTION('related') });
    expect(within(related).getByText('TEC-4')).toBeTruthy();
    expect(within(related).getByText('Nginx')).toBeTruthy();
    expect(within(related).getAllByText('workspace.application.relations.types.technology')).toHaveLength(2);
    expect(within(related).getByText('workspace.application.relations.via.asset_technology(label=AST-2)')).toBeTruthy();
    expect(within(related).getByText('workspace.application.relations.via.application_technology(label=APP-4)')).toBeTruthy();

    const tasks = screen.getByTestId('incident-tasks');
    expect(tasks).toHaveAttribute('data-type', 'incident');
    expect(tasks).toHaveAttribute('data-id', 'inc-1');
    expect(tasks).toHaveAttribute('data-disabled', 'no');
    expect(related.compareDocumentPosition(tasks) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(within(assets).getByText('sap-prd-db01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-2/overview');
    fireEvent.click(within(applications).getByText('SAP S/4HANA'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/applications/APP-4/overview');
    fireEvent.click(within(technologies).getByText('Oracle Database'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/technologies/TEC-9/overview');
    fireEvent.click(within(related).getByText('Nginx'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/technologies/TEC-4/overview');
  });

  it('adds an asset from the picker, updates the badge and invalidates the journal', async () => {
    const { onLinksChange, client } = renderTab(relations());
    const assets = await screen.findByRole('region', { name: SECTION('assets') });
    await within(assets).findByText('sap-prd-db01');

    // The open picker hides the rest of the page. The next Add is read with hidden: true.
    const hidden = { hidden: true } as const;
    const technologies = screen.getByRole('region', { name: SECTION('technologies'), ...hidden });
    fireEvent.click(within(technologies).getByText(ADD));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/technologies/lookup', expect.objectContaining({
      params: expect.objectContaining({ limit: 30 }),
    })));

    const applications = screen.getByRole('region', { name: SECTION('applications'), ...hidden });
    fireEvent.click(within(applications).getByText(ADD));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/applications', expect.objectContaining({
      params: expect.objectContaining({ page: 1, limit: 30, sort: 'name:ASC' }),
    })));

    fireEvent.click(within(assets).getByText(ADD));
    expect(await screen.findByRole('option', { name: /edge-fw/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /sap-prd-db01/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /edge-fw/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/incidents/inc-1/relations/assets', { id: 'as-8' }));
    await waitFor(() => expect(onLinksChange).toHaveBeenCalledWith('assets', 3));
    expect(onLinksChange).toHaveBeenCalledWith('applications', 2);
    expect(onLinksChange).toHaveBeenCalledWith('technologies', 2);
    expect(client.getQueryState(['incident-entries', 'inc-1'])?.isInvalidated).toBe(true);
    expect(mocked.get).toHaveBeenCalledWith('/assets', expect.objectContaining({
      params: expect.objectContaining({ page: 1, limit: 30, sort: 'name:ASC' }),
    }));
  });

  it('unlinks a row at once and restores it when the server refuses', async () => {
    const { onLinksChange, client } = renderTab(relations());
    let reject: (error: unknown) => void = () => undefined;
    mocked.delete.mockReturnValue(new Promise((_, r) => { reject = r; }) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=SAP S/4HANA)' }));

    expect(mocked.delete).toHaveBeenCalledWith('/incidents/inc-1/relations/applications/app-1');
    await waitFor(() => expect(screen.queryByText('SAP S/4HANA')).toBeNull());
    expect(onLinksChange).not.toHaveBeenCalled();
    expect(client.getQueryState(['incident-entries', 'inc-1'])?.isInvalidated).not.toBe(true);

    reject({ response: { status: 500, data: { message: 'Server down' } } });
    expect(await screen.findByText('SAP S/4HANA')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onLinksChange).not.toHaveBeenCalled();
  });

  it('links a suggestion and shows why it was offered', async () => {
    const { onLinksChange, client } = renderTab(relations());
    const related = await screen.findByRole('region', { name: SECTION('related') });
    expect(within(related).getByText('workspace.application.relations.via.asset_technology(label=AST-2)')).toBeTruthy();
    fireEvent.click(within(related).getByRole('button', { name: 'workspace.application.relations.linkNamed(name=Nginx)' }));

    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/incidents/inc-1/relations/technologies', { id: 'tec-4' }));
    await waitFor(() => expect(within(related).queryByText('Nginx')).toBeNull());
    const technologies = screen.getByRole('region', { name: SECTION('technologies') });
    expect(within(technologies).getByText('Nginx')).toBeTruthy();
    expect(within(related).getByText('PostgreSQL')).toBeTruthy();
    expect(onLinksChange).toHaveBeenCalledWith('technologies', 3);
    expect(client.getQueryState(['incident-entries', 'inc-1'])?.isInvalidated).toBe(true);
  });

  it('leaves a section out when the response is null, and still shows the tasks', async () => {
    renderTab(relations({ assets: null, technologies: null, suggestions: [] }));
    await screen.findByRole('region', { name: SECTION('applications') });
    expect(screen.queryByRole('region', { name: SECTION('assets') })).toBeNull();
    expect(screen.queryByRole('region', { name: SECTION('technologies') })).toBeNull();
    expect(screen.queryByRole('region', { name: SECTION('related') })).toBeNull();
    expect(screen.getByTestId('incident-tasks')).toBeTruthy();
  });

  it('hides add and unlink on a section the contributor cannot read', async () => {
    rights.infrastructure = '';
    renderTab(relations());
    const assets = await screen.findByRole('region', { name: SECTION('assets') });
    expect(within(assets).getByText('sap-prd-db01')).toBeTruthy();
    expect(within(assets).queryByText(ADD)).toBeNull();
    expect(within(assets).queryByRole('button', { name: /relations\.remove/ })).toBeNull();

    const technologies = screen.getByRole('region', { name: SECTION('technologies') });
    expect(within(technologies).queryByText(ADD)).toBeNull();
    expect(within(technologies).queryByRole('button', { name: /relations\.remove/ })).toBeNull();

    const applications = screen.getByRole('region', { name: SECTION('applications') });
    expect(within(applications).getByText(ADD)).toBeTruthy();
    expect(within(applications).getByRole('button', { name: 'workspace.application.relations.remove(name=SAP S/4HANA)' })).toBeTruthy();

    const related = screen.getByRole('region', { name: SECTION('related') });
    expect(within(related).getByText('Nginx')).toBeTruthy();
    expect(within(related).queryByRole('button', { name: /relations\.linkNamed/ })).toBeNull();
    expect(screen.getByTestId('incident-tasks')).toBeTruthy();
  });

  it('gives a reader the tables, the suggestions and the tasks, without a button', async () => {
    rights.incidents = 'reader';
    renderTab(relations());
    await screen.findByText('sap-prd-db01');
    expect(screen.queryByText(ADD)).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.linkNamed/ })).toBeNull();
    expect(screen.getByTestId('incident-tasks')).toBeTruthy();
    fireEvent.click(screen.getByText('old-printer'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-8/overview');
  });

  it.each([
    { name: 'read only', readOnly: true, editable: true },
    { name: 'frozen by the server', readOnly: false, editable: false },
  ])('offers no add, unlink or link when the incident is $name', async ({ readOnly, editable }) => {
    renderTab(relations({ editable }), { readOnly });
    await screen.findByText('sap-prd-db01');
    expect(screen.getByText('Nginx')).toBeTruthy();
    expect(screen.queryByText(ADD)).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.linkNamed/ })).toBeNull();
    expect(screen.getByTestId('incident-tasks')).toHaveAttribute('data-disabled', readOnly ? 'yes' : 'no');
  });
});
