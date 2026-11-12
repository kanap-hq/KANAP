import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectAnchoredLeft, expectAnchoredRight, placeAnchor, stubPopoverPaperWidth } from '../../../test/popoverAnchor';
import { createAppTheme } from '../../../config/ThemeContext';
import { frenchSpacing } from '../../../i18n/formatters';
import api from '../../../api';
import deIt from '../../../locales/de/it.json';
import enIt from '../../../locales/en/it.json';
import esIt from '../../../locales/es/it.json';
import frIt from '../../../locales/fr/it.json';
import ApplicationTechnologiesSection from './ApplicationTechnologiesSection';
import type { ApplicationRelationsData } from './ApplicationRelationsTab';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const auth = { manager: true, readOnly: [] as string[] };
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: (resource: string) => auth.manager && !auth.readOnly.includes(resource) }) }));
const families: Record<string, string> = { database: 'Base de données' };
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (field: string, code: string) => (field === 'technologyFamily' ? families[code] ?? code : code) }),
}));

const mocked = vi.mocked(api);

function relations(overrides: Partial<ApplicationRelationsData> = {}): ApplicationRelationsData {
  return {
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
      {
        id: 'tec-1', reference: 'TEC-1', name: 'SQL Server', family: 'database', declared: false, hosted: true, versions: ['2019'], version_unknown: false,
        standard_support_end: '2020-01-14', support_end: '2020-01-14', support_state: 'out_of_support',
        via: [{ asset_id: 'srv-1', asset_name: 'srv-etl-1', host_name: null }],
      },
      {
        id: 'tec-3', reference: 'TEC-3', name: 'Tomcat', family: 'middleware', declared: true, hosted: true, versions: [], version_unknown: true,
        standard_support_end: null, via: [{ asset_id: 'srv-1', asset_name: 'srv-etl-1', host_name: null }],
        declarations: [{ link_id: 'lnk-3', technology_version_id: null, version_label: null }],
      },
      {
        id: 'tec-2', reference: 'TEC-2', name: 'vSphere', family: 'virtualization', declared: false, hosted: true, versions: ['8'], version_unknown: false,
        standard_support_end: '2099-10-11', support_end: '2099-10-11', support_state: 'supported',
        via: [{ asset_id: 'srv-2', asset_name: 'srv-etl-2', host_name: 'esx-01' }],
      },
    ],
    deployment_servers: [],
    processes: [],
    incidents: [],
    suggestions: [],
    also: { assets: 0, interfaces: 0, documents: 0 },
    ...overrides,
  };
}

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

/** A local day `months` from today, clamped like the support horizon. */
function shiftMonths(months: number): string {
  const date = new Date();
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + months);
  date.setDate(Math.min(day, new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()));
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const dayText = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${dayText}`;
}

/** The record's tooltip sentence for a count, as the locale files state it. */
function endsWithinMonths(relations: { endsWithinMonths_one: string; endsWithinMonths_other: string }, count: number): string {
  const template = count === 1 ? relations.endsWithinMonths_one : relations.endsWithinMonths_other;
  return template.split('{{count}}').join(String(count));
}

function renderSection(data: ApplicationRelationsData) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/applications/app-1/relations') return { data } as never;
    if (url === '/technologies/lookup') {
      return { data: { items: [{ id: 'tec-4', name: 'Java', reference: 'TEC-4', editor: 'Oracle' }, { id: 'tec-1', name: 'SQL Server', reference: 'TEC-1', editor: 'Microsoft' }] } } as never;
    }
    if (url === '/technologies/tec-1/versions') return { data: { items: [{ id: 'v-2019', label: '2019' }] } } as never;
    if (url === '/technologies/tec-3/versions') return { data: { items: [{ id: 'v-9', label: '9.0' }] } } as never;
    throw new Error(`unexpected GET ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/applications/app-1/operations']}>
          <Routes>
            <Route path="*" element={<><ApplicationTechnologiesSection id="app-1" /><Location /></>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  auth.manager = true;
  auth.readOnly = [];
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.patch.mockReset();
  mocked.delete.mockReset();
});

describe('ApplicationTechnologiesSection', () => {
  it('lists each technology once, declared and hosted, with its version, servers and end of support', async () => {
    renderSection(relations());
    const table = await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows.map((row) => row.querySelector('td')?.textContent)).toEqual(['TEC-4', 'TEC-1', 'TEC-3', 'TEC-2']);

    const sql = within(rows[1] as HTMLElement);
    expect(sql.getByText('Base de données')).toBeTruthy();
    expect(sql.getByText('2019')).toBeTruthy();
    expect(sql.getByText('workspace.application.relations.technologyLink.hosted')).toBeTruthy();
    expect(sql.getByText('srv-etl-1')).toBeTruthy();
    expect(getComputedStyle(sql.getByText(/2020/)).color).not.toBe(getComputedStyle(within(rows[3] as HTMLElement).getByText(/2099/)).color);

    const java = within(rows[0] as HTMLElement);
    expect(java.getByText('runtime')).toBeTruthy();
    expect(java.getByTitle('workspace.application.relations.versionUnknown').textContent).toBe('—');
    expect(java.getByText('workspace.application.relations.technologyLink.declared')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('workspace.application.relations.technologyLink.both')).toBeTruthy();
    expect(within(rows[3] as HTMLElement).getByText('workspace.application.relations.viaHost(server=srv-etl-2,host=esx-01)')).toBeTruthy();

    fireEvent.click(java.getByText('Java'));
    expect(screen.getByTestId('location').textContent).toBe('/it/technologies/TEC-4');

    // A hosted row changes on the server's page.
    fireEvent.click(sql.getByRole('link', { name: 'srv-etl-1' }));
    expect(screen.getByTestId('location').textContent).toBe('/it/assets/srv-1/operations');
  });

  it('shows the end of support as the End of support report does: the date that matters, its state and both ends', async () => {
    const base = relations().technologies!;
    renderSection(relations({
      technologies: [
        // Standard support passed, extended support to come: the extended end, in extended support.
        { ...base[1], standard_support_end: '2022-10-11', extended_support_end: '2098-10-12', support_end: '2098-10-12', support_state: 'extended_support' },
        // Both passed: the last end, out of support.
        { ...base[3], standard_support_end: '2019-12-31', extended_support_end: '2022-12-31', support_end: '2022-12-31', support_state: 'out_of_support' },
        // No version with an end: a dash.
        { ...base[2] },
      ],
    }));
    const table = await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    const rows = [...table.querySelectorAll('tbody tr')] as HTMLElement[];
    const extended = within(rows[0]).getByText(/2098/);
    expect(extended.getAttribute('data-state')).toBe('extended');
    expect(extended.getAttribute('title')).toBe(
      'pages.endOfSupport.states.extended_support · workspace.asset.technical.standardSupportEnds(date=11 Oct 2022) / workspace.asset.technical.extendedSupportEnds(date=12 Oct 2098)',
    );
    expect(within(rows[0]).queryByText(/2022/)).toBeNull();
    const ended = within(rows[1]).getByText(/2022/);
    expect(ended.getAttribute('data-state')).toBe('ended');
    expect(ended.getAttribute('title')).toMatch(/^pages\.endOfSupport\.states\.out_of_support · /);
    expect(getComputedStyle(ended).color).not.toBe(getComputedStyle(extended).color);
    expect(rows[2].querySelectorAll('td')[6]?.textContent).toBe('—');
  });

  it('names the 12-month window on a version that ends within it', async () => {
    const base = relations().technologies!;
    const soon = shiftMonths(6);
    const later = shiftMonths(18);
    renderSection(relations({
      technologies: [
        { ...base[1], standard_support_end: soon, support_end: soon, support_state: null },
        { ...base[3], standard_support_end: later, support_end: later, support_state: 'supported' },
      ],
    }));
    const table = await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    const rows = [...table.querySelectorAll('tbody tr')] as HTMLElement[];
    const ending = rows[0].querySelector('[data-state]') as HTMLElement;
    expect(ending.getAttribute('data-state')).toBe('ending_soon');
    const title = ending.getAttribute('title') ?? '';
    expect(title).toContain('workspace.application.relations.endsWithinMonths(count=12)');
    expect(title).toContain('workspace.asset.technical.standardSupportEnds(');
    expect(title).not.toContain('upcoming');
    const supported = rows[1].querySelector('[data-state]') as HTMLElement;
    expect(supported.getAttribute('data-state')).toBe('supported');
    expect(getComputedStyle(ending).color).not.toBe(getComputedStyle(supported).color);

    expect(endsWithinMonths(enIt.workspace.application.relations, 12)).toBe('Ends within 12 months');
    expect(frenchSpacing(endsWithinMonths(frIt.workspace.application.relations, 12))).toBe('Fin dans les 12 mois');
    expect(endsWithinMonths(deIt.workspace.application.relations, 12)).toBe('Endet innerhalb von 12 Monaten');
    expect(endsWithinMonths(esIt.workspace.application.relations, 12)).toBe('Termina dentro de 12 meses');
  });

  it('wraps several long server names in Via instead of cutting them', async () => {
    const names = [
      'paris-prod-application-server-01',
      'lyon-prod-application-server-02',
      'nantes-prod-application-server-03',
    ];
    renderSection(relations({
      technologies: [{
        id: 'tec-9', reference: 'TEC-9', name: 'PostgreSQL', family: 'database', declared: false, hosted: true,
        versions: ['16'], version_unknown: false, standard_support_end: null,
        via: names.map((name, index) => ({
          asset_id: `srv-long-${index}`,
          asset_name: name,
          host_name: index === 2 ? 'esx-long-03' : null,
        })),
      }],
    }));
    const table = await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    const row = within(table).getByText('PostgreSQL').closest('tr') as HTMLElement;
    const labels = [
      names[0],
      names[1],
      `workspace.application.relations.viaHost(server=${names[2]},host=esx-long-03)`,
    ];
    for (const label of labels) {
      const link = within(row).getByRole('link', { name: label });
      expect(link).toHaveAttribute('href', `/it/assets/srv-long-${labels.indexOf(label)}/operations`);
      expect(link.className).not.toMatch(/ellipsis/i);
      const style = getComputedStyle(link);
      expect(style.textOverflow).not.toBe('ellipsis');
      expect(style.whiteSpace).not.toBe('nowrap');
    }
    const cell = within(row).getByRole('link', { name: names[0] }).closest('td') as HTMLElement;
    expect(cell.classList.contains('w')).toBe(true);
    const cellStyle = getComputedStyle(cell);
    expect(cellStyle.textOverflow).not.toBe('ellipsis');
    expect(cellStyle.whiteSpace).toBe('normal');
    for (const node of cell.querySelectorAll<HTMLElement>('*')) {
      const style = getComputedStyle(node);
      expect(style.textOverflow).not.toBe('ellipsis');
      expect(style.whiteSpace).not.toBe('nowrap');
    }
    const viaIndex = within(table).getAllByRole('columnheader')
      .findIndex((header) => header.textContent === 'workspace.application.relations.columns.via');
    expect((table.querySelectorAll('col')[viaIndex] as HTMLElement).style.width).toBe('140px');
  });

  it('leaves the free width to the technology name', async () => {
    renderSection(relations());
    const table = await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    const widths = [...table.querySelectorAll('col')].map((col) => (col as HTMLElement).style.width);
    expect(widths[1]).toBe('');
    const fixed = widths.filter(Boolean).reduce((sum, width) => sum + parseInt(width, 10), 0);
    expect(fixed).toBeLessThanOrEqual(700);
    expect(within(table).getByTitle('Tomcat').textContent).toBe('Tomcat');
  });

  it('removes a declared technology only, and keeps it as hosted when a server carries it', async () => {
    mocked.delete.mockReturnValue(new Promise(() => undefined) as never);
    renderSection(relations());
    await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    expect(screen.queryByRole('button', { name: 'workspace.application.relations.remove(name=SQL Server)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'workspace.application.relations.remove(name=vSphere)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.relations.remove(name=Tomcat)' }));
    expect(mocked.delete).toHaveBeenCalledWith('/applications/app-1/relations/technologies/tec-3');
    await waitFor(() => expect(screen.getByText('Tomcat').closest('tr')?.textContent).toContain('technologyLink.hosted'));
  });

  async function pickSqlServer() {
    await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    const section = screen.getByRole('region', { name: 'workspace.application.relations.sections.technologies' });
    fireEvent.click(within(section).getByText('workspace.application.relations.add'));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/technologies/lookup', expect.objectContaining({ params: { limit: 30 } })));
    const option = await screen.findByRole('option', { name: /SQL Server/ });
    expect(screen.queryByRole('option', { name: /Java/ })).toBeNull();
    fireEvent.click(option);
  }

  const servers = [
    { asset_id: 'srv-1', name: 'srv-etl-1', asset_reference: 'AST-1', environments: ['prod'], roles: ['app'] },
    { asset_id: 'srv-3', name: 'CAVE-EDGE-01', asset_reference: 'AST-3', environments: ['prod'], roles: ['web'] },
  ];

  it('declares a technology from the lookup, then its version, offering the hosted ones but not the declared ones', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderSection(relations());
    await pickSqlServer();
    fireEvent.click(await screen.findByRole('option', { name: '2019' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/technologies', { id: 'tec-1', technology_version_id: 'v-2019' }));
  });

  it('declares a new version or an unknown one', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderSection(relations());
    await pickSqlServer();
    const field = await screen.findByRole('combobox', { name: 'workspace.technology.versionPicker.search' });
    fireEvent.change(field, { target: { value: '2022' } });
    fireEvent.click(await screen.findByRole('option', { name: 'workspace.technology.versionPicker.create(label=2022)' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/technologies', { id: 'tec-1', version_label: '2022' }));

    mocked.post.mockClear();
    await pickSqlServer();
    fireEvent.click(await screen.findByRole('option', { name: 'workspace.technology.versionPicker.unknown' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/technologies', { id: 'tec-1', technology_version_id: null }));
  });

  it('offers the deployment servers after the version, none ticked, and sends the ticked ones', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderSection(relations({ deployment_servers: servers }));
    await pickSqlServer();
    const field = await screen.findByRole('combobox', { name: 'workspace.technology.versionPicker.search' });
    fireEvent.change(field, { target: { value: '2022' } });
    fireEvent.keyDown(field, { key: 'Enter' });

    expect(await screen.findByText('workspace.application.relations.technologyServers.proposal(technology=SQL Server,version=2022)')).toBeTruthy();
    const edge = screen.getByRole('menuitemcheckbox', { name: /CAVE-EDGE-01/ });
    expect(edge.textContent).toContain('(enums.environment.prod, web)');
    expect(edge.getAttribute('aria-checked')).toBe('false');
    // srv-etl-1 carries SQL Server already: shown, not offered.
    const etl = screen.getByRole('menuitemcheckbox', { name: /srv-etl-1/ });
    expect(etl.getAttribute('aria-disabled')).toBe('true');
    expect(etl.textContent).toContain('workspace.application.relations.technologyServers.already');
    expect(mocked.post).not.toHaveBeenCalled();

    fireEvent.click(edge);
    expect(edge.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.relations.technologyServers.add' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/technologies', { id: 'tec-1', version_label: '2022', asset_ids: ['srv-3'] }));
  });

  it('declares without servers when none is ticked', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderSection(relations({ deployment_servers: servers }));
    await pickSqlServer();
    fireEvent.click(await screen.findByRole('option', { name: '2019' }));
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.technologyServers.add' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/technologies', { id: 'tec-1', technology_version_id: 'v-2019' }));
  });

  it('changes the version of a declaration from its version', async () => {
    mocked.patch.mockResolvedValue({ data: { ok: true } } as never);
    renderSection(relations());
    await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    expect(screen.queryByRole('button', { name: 'workspace.application.relations.technologyServers.changeVersion(name=SQL Server)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.relations.technologyServers.changeVersion(name=Tomcat)' }));
    fireEvent.click(await screen.findByRole('option', { name: '9.0' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/technologies/tec-3/application-links/lnk-3', { technology_version_id: 'v-9' }));
    expect(screen.getByTestId('location').textContent).toBe('/it/applications/app-1/operations');
  });

  it('records a declaration on a server when no server of the application carries it', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true, servers: { added: 1, skipped: 0 } } } as never);
    renderSection(relations({ deployment_servers: servers }));
    await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    expect(screen.queryByRole('button', { name: 'workspace.application.relations.technologyServers.actionNamed(name=Tomcat)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.relations.technologyServers.actionNamed(name=Java)' }));
    expect(await screen.findByText('workspace.application.relations.technologyServers.proposalUnknown(technology=Java)')).toBeTruthy();
    const record = screen.getByRole('button', { name: 'workspace.application.relations.technologyServers.recordOn(count=0)' });
    expect((record as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /srv-etl-1/ }));
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.relations.technologyServers.recordOn(count=1)' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/technologies', { id: 'tec-4', technology_version_id: null, asset_ids: ['srv-1'] }));
  });

  it('offers no server and no action without deployment servers', async () => {
    renderSection(relations());
    await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    expect(screen.queryByRole('button', { name: /technologyServers\.actionNamed/ })).toBeNull();
  });

  it('stays read-only without the right to edit technologies', async () => {
    auth.readOnly = ['infrastructure'];
    renderSection(relations({ deployment_servers: servers }));
    const section = await screen.findByRole('region', { name: 'workspace.application.relations.sections.technologies' });
    await within(section).findByRole('table');
    expect(within(section).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(section).queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(within(section).queryByRole('button', { name: /technologyServers/ })).toBeNull();
  });

  it('hides the section when the caller cannot read technologies', async () => {
    renderSection(relations({ technologies: null }));
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.technologies' })).toBeNull();
    });
  });

  describe('popover anchor', () => {
    const innerWidth = window.innerWidth;
    let restoreWidth: () => void = () => undefined;
    const addBox = { left: 280, top: 80, width: 160, height: 32 };
    const rowBox = { left: 900, top: 200, width: 32, height: 32 };

    beforeEach(() => {
      window.innerWidth = 1280;
      restoreWidth = stubPopoverPaperWidth();
    });

    afterEach(() => {
      window.innerWidth = innerWidth;
      restoreWidth();
    });

    it('opens the version picker and the server proposal under the Add button, on its left edge', async () => {
      renderSection(relations({ deployment_servers: servers }));
      const section = await screen.findByRole('region', { name: 'workspace.application.relations.sections.technologies' });
      const button = (await within(section).findByText('workspace.application.relations.add')).closest('button') as HTMLButtonElement;
      placeAnchor(button, addBox);
      fireEvent.click(button);
      fireEvent.click(await screen.findByRole('option', { name: /SQL Server/ }));
      expect(await screen.findByRole('combobox', { name: 'workspace.technology.versionPicker.search' })).toBeTruthy();
      expectAnchoredLeft({ left: 280, bottom: 112 });
      fireEvent.click(await screen.findByRole('option', { name: '2019' }));
      expect(await screen.findByText('workspace.application.relations.technologyServers.proposal(technology=SQL Server,version=2019)')).toBeTruthy();
      expectAnchoredLeft({ left: 280, bottom: 112 });
    });

    it('keeps the version picker right-aligned on a row', async () => {
      renderSection(relations());
      const button = await screen.findByRole('button', { name: 'workspace.application.relations.technologyServers.changeVersion(name=Tomcat)' });
      placeAnchor(button, rowBox);
      fireEvent.click(button);
      expect(await screen.findByRole('option', { name: '9.0' })).toBeTruthy();
      expectAnchoredRight(932, 300);
    });

    it('keeps the server proposal right-aligned on a row action', async () => {
      renderSection(relations({ deployment_servers: servers }));
      const button = await screen.findByRole('button', { name: 'workspace.application.relations.technologyServers.actionNamed(name=Java)' });
      placeAnchor(button, rowBox);
      fireEvent.click(button);
      expect(await screen.findByText('workspace.application.relations.technologyServers.proposalUnknown(technology=Java)')).toBeTruthy();
      expectAnchoredRight(932, 340);
    });
  });
});
