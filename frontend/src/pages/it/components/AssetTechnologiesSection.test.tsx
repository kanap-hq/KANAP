import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import AssetTechnologiesSection, { type AssetTechnologyRow } from './AssetTechnologiesSection';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (field: string, code: string) => (field === 'technologyFamily' && code === 'database' ? 'Database' : code) }),
}));

const mocked = vi.mocked(api);
const K = 'workspace.asset.technologies';

const ROWS: AssetTechnologyRow[] = [
  {
    kind: 'installed', removable: true, link_id: 'l-1', technology_id: 'sql', technology_name: 'SQL Server', technology_reference: 'TEC-3',
    family: 'database', technology_version_id: 'v19', version_label: '2019', via_asset_id: null, via_asset_name: null,
    is_operating_system: true,
    standard_support_end: '2029-01-09',
    extended_support_end: '2034-01-09',
  },
  {
    kind: 'installed', removable: true, link_id: 'l-2', technology_id: 'esxi', technology_name: 'ESXi', technology_reference: 'TEC-4',
    family: 'hypervisor', technology_version_id: 'v8', version_label: '8.0', via_asset_id: null, via_asset_name: null,
    is_operating_system: false,
  },
  {
    kind: 'carried', removable: false, link_id: null, technology_id: 'vsphere', technology_name: 'vSphere', technology_reference: 'TEC-1',
    family: 'virtualization', technology_version_id: null, version_label: null, via_asset_id: 'esx', via_asset_name: 'ESX-01',
  },
];

const picker = () => within(document.querySelector('.MuiPopover-paper') as HTMLElement);

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderSection(items: AssetTechnologyRow[] = ROWS, canManage = true) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/assets/asset-1/technologies') return { data: { items } } as never;
    if (url === '/technologies/lookup') return { data: { items: [{ id: 'tomcat', name: 'Tomcat', reference: 'TEC-5', editor: 'Apache' }] } } as never;
    if (url.endsWith('/versions')) return { data: { items: [{ id: 't10', label: '10.1' }, { id: 't9', label: '9.0' }] } } as never;
    throw new Error(`unexpected GET ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/assets/AST-1/technical']}>
          <Routes>
            <Route path="*" element={<><AssetTechnologiesSection assetId="asset-1" canManage={canManage} /><Location /></>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.put.mockReset();
  mocked.patch.mockReset();
  mocked.delete.mockReset();
  mocked.post.mockResolvedValue({ data: { ok: true } } as never);
  mocked.put.mockResolvedValue({ data: { ok: true } } as never);
  mocked.patch.mockResolvedValue({ data: { ok: true } } as never);
  mocked.delete.mockResolvedValue({ data: { ok: true } } as never);
});

describe('AssetTechnologiesSection', () => {
  it('lists the installed and carried technologies with family, version and the server they come from', async () => {
    renderSection();
    const table = await screen.findByRole('table', { name: `${K}.title` });
    const rows = [...table.querySelectorAll('tbody tr')] as HTMLElement[];
    expect(rows.map((tr) => tr.querySelector('td')?.textContent)).toEqual(['TEC-3', 'TEC-4', 'TEC-1']);
    expect(within(rows[0]).getByText('Database')).toBeTruthy();
    expect(within(rows[0]).getByText(`${K}.operatingSystem`)).toBeTruthy();
    expect(within(rows[1]).queryByText(`${K}.operatingSystem`)).toBeNull();
    expect(within(rows[0]).getByText('2019')).toBeTruthy();
    expect(within(rows[2]).getByText('virtualization')).toBeTruthy();
    expect(within(rows[2]).getByTitle('workspace.technology.versionPicker.unknown').textContent).toBe('—');
    expect(within(rows[2]).getByText('ESX-01')).toBeTruthy();

    fireEvent.click(within(rows[0]).getByText('SQL Server'));
    expect(screen.getByTestId('location').textContent).toBe('/it/technologies/TEC-3');
  });

  it('shows the Via column, explained on hover, only when a technology is carried', async () => {
    renderSection();
    const table = await screen.findByRole('table', { name: `${K}.title` });
    expect(within(table).getByText(`${K}.columns.via`).getAttribute('title')).toBe(`${K}.columns.viaHint`);
  });

  it('leaves the Via column out when every technology is installed', async () => {
    renderSection([ROWS[0]]);
    const table = await screen.findByRole('table', { name: `${K}.title` });
    expect(within(table).queryByText(`${K}.columns.via`)).toBeNull();
  });

  it('removes an installed technology and never a carried one', async () => {
    renderSection();
    await screen.findByRole('table', { name: `${K}.title` });
    expect(screen.queryByRole('button', { name: `${K}.remove(name=vSphere)` })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `${K}.remove(name=SQL Server)` }));
    expect(mocked.delete).toHaveBeenCalledWith('/assets/asset-1/technologies/l-1');
  });

  it('adds a technology then one of its versions', async () => {
    renderSection();
    await screen.findByRole('table', { name: `${K}.title` });
    fireEvent.click(screen.getByText(`${K}.add`));
    fireEvent.click(await waitFor(() => picker().getByText('Tomcat')));
    fireEvent.click(await waitFor(() => picker().getByText('9.0')));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/asset-1/technologies', { technology_id: 'tomcat', technology_version_id: 't9' }));
  });

  it('adds a technology with a version created from the label typed', async () => {
    renderSection();
    await screen.findByRole('table', { name: `${K}.title` });
    fireEvent.click(screen.getByText(`${K}.add`));
    fireEvent.click(await waitFor(() => picker().getByText('Tomcat')));
    const field = await waitFor(() => picker().getByPlaceholderText('workspace.technology.versionPicker.placeholder'));
    await waitFor(() => picker().getByText('10.1'));
    fireEvent.change(field, { target: { value: '11.0' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/asset-1/technologies', { technology_id: 'tomcat', version_label: '11.0' }));
  });

  it('takes the section title of the page around it', async () => {
    mocked.get.mockImplementation(async () => ({ data: { items: ROWS } }) as never);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter>
            <AssetTechnologiesSection assetId="asset-1" canManage heading={(title) => <span data-testid="page-title">{title}</span>} />
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect((await screen.findByTestId('page-title')).textContent).toBe(`${K}.title`);
    expect(screen.getByRole('region', { name: `${K}.title` })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: `${K}.title` })).toBeNull();
  });

  it('is one line when the server carries nothing, with no add for a reader', async () => {
    renderSection([], false);
    expect(await screen.findByText(`${K}.empty`)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText(`${K}.add`)).toBeNull();
  });

  it('edits the version of an installed row from the pencil and skips carried rows', async () => {
    renderSection();
    await screen.findByRole('table', { name: `${K}.title` });
    expect(screen.queryByRole('button', { name: `${K}.editNamed(name=vSphere)` })).toBeNull();
    expect(screen.queryByRole('button', { name: `${K}.setAsOperatingSystem` })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `${K}.editNamed(name=ESXi)` }));
    fireEvent.click(await waitFor(() => picker().getByText('9.0')));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/technologies/esxi/assets/l-2', { technology_version_id: 't9' }));
  });

  it('hides Edit for a reader', async () => {
    renderSection(ROWS, false);
    await screen.findByRole('table', { name: `${K}.title` });
    expect(screen.queryByRole('button', { name: `${K}.editNamed(name=SQL Server)` })).toBeNull();
    expect(screen.queryByRole('button', { name: `${K}.remove(name=SQL Server)` })).toBeNull();
  });

  it('changes the version of an installed row and colours it with the support dates', async () => {
    renderSection();
    const version = await screen.findByRole('button', { name: `${K}.changeVersion(name=SQL Server)` });
    expect(version.getAttribute('title')).toContain('workspace.asset.technical.standardSupportEnds(date=');
    expect(version.getAttribute('title')).toContain('workspace.asset.technical.extendedSupportEnds(date=');
    fireEvent.click(version);
    fireEvent.click(await waitFor(() => picker().getByText('9.0')));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/technologies/sql/assets/l-1', { technology_version_id: 't9' }));
  });

  it('keeps a long version label in the cell title and gives the column room for a common one', async () => {
    renderSection([
      {
        kind: 'installed', removable: true, link_id: 'l-long', technology_id: 'sql', technology_name: 'SQL Server', technology_reference: 'TEC-3',
        family: 'database', technology_version_id: 'vlong', version_label: '16.99-c2check', via_asset_id: null, via_asset_name: null,
        standard_support_end: '2029-01-09',
      },
      {
        kind: 'installed', removable: true, link_id: 'l-win', technology_id: 'win', technology_name: 'Windows Server', technology_reference: 'TEC-8',
        family: 'operating_system', technology_version_id: 'v2019', version_label: '2019 (1809)', via_asset_id: null, via_asset_name: null,
      },
    ]);
    const table = await screen.findByRole('table', { name: `${K}.title` });
    const long = within(table).getByTitle(/^16\.99-c2check/);
    expect(long.getAttribute('title')).toMatch(/^16\.99-c2check · /);
    expect(long.textContent).toBe('16.99-c2check');
    expect(within(table).getByTitle('2019 (1809)').textContent).toBe('2019 (1809)');
    expect(table.querySelectorAll('col')[3].style.width).toBe('128px');
  });
});
