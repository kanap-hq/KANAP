import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
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
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
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
      { id: 'tec-4', reference: 'TEC-4', name: 'Java', family: 'runtime', declared: true, hosted: false, versions: [], version_unknown: true, standard_support_end: null, via: [] },
      {
        id: 'tec-1', reference: 'TEC-1', name: 'SQL Server', family: 'database', declared: false, hosted: true, versions: ['2019'], version_unknown: false,
        standard_support_end: '2020-01-14', via: [{ asset_id: 'srv-1', asset_name: 'srv-etl-1', host_name: null }],
      },
      {
        id: 'tec-3', reference: 'TEC-3', name: 'Tomcat', family: 'middleware', declared: true, hosted: true, versions: [], version_unknown: true,
        standard_support_end: null, via: [{ asset_id: 'srv-1', asset_name: 'srv-etl-1', host_name: null }],
      },
      {
        id: 'tec-2', reference: 'TEC-2', name: 'vSphere', family: 'virtualization', declared: false, hosted: true, versions: ['8'], version_unknown: false,
        standard_support_end: '2099-10-11', via: [{ asset_id: 'srv-2', asset_name: 'srv-etl-2', host_name: 'esx-01' }],
      },
    ],
    processes: [],
    suggestions: [],
    also: { assets: 0, interfaces: 0, documents: 0 },
    ...overrides,
  };
}

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderSection(data: ApplicationRelationsData) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/applications/app-1/relations') return { data } as never;
    if (url === '/technologies/lookup') {
      return { data: { items: [{ id: 'tec-4', name: 'Java', reference: 'TEC-4', editor: 'Oracle' }, { id: 'tec-1', name: 'SQL Server', reference: 'TEC-1', editor: 'Microsoft' }] } } as never;
    }
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
  });

  it('leaves the free width to the technology name', async () => {
    renderSection(relations());
    const table = await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    const widths = [...table.querySelectorAll('col')].map((col) => (col as HTMLElement).style.width);
    expect(widths[1]).toBe('');
    const fixed = widths.filter(Boolean).reduce((sum, width) => sum + parseInt(width, 10), 0);
    expect(fixed).toBeLessThanOrEqual(660);
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

  it('declares a technology from the lookup, offering the hosted ones but not the declared ones', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderSection(relations());
    await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    const section = screen.getByRole('region', { name: 'workspace.application.relations.sections.technologies' });
    fireEvent.click(within(section).getByText('workspace.application.relations.add'));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/technologies/lookup', expect.objectContaining({ params: { limit: 30 } })));
    const option = await screen.findByRole('option', { name: /SQL Server/ });
    expect(screen.queryByRole('option', { name: /Java/ })).toBeNull();
    fireEvent.click(option);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/technologies', { id: 'tec-1' }));
  });

  it('stays read-only without the right to edit technologies', async () => {
    auth.readOnly = ['infrastructure'];
    renderSection(relations());
    const section = await screen.findByRole('region', { name: 'workspace.application.relations.sections.technologies' });
    expect(within(section).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(section).queryByRole('button', { name: /relations\.remove/ })).toBeNull();
  });

  it('hides the section when the caller cannot read technologies', async () => {
    renderSection(relations({ technologies: null }));
    await waitFor(() => {
      expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.technologies' })).toBeNull();
    });
  });
});
