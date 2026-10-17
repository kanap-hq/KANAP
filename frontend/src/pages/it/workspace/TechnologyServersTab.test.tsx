import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import TechnologyServersTab, { countServers, type TechnologyServerRow } from './TechnologyServersTab';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

const mocked = vi.mocked(api);
const S = 'workspace.technology.servers';

const row = (overrides: Partial<TechnologyServerRow>): TechnologyServerRow => ({
  link_id: null, kind: 'installed', asset_id: 'a', asset_name: 'A', asset_reference: null, asset_status: 'active',
  environment: 'prod', operating_system_label: null, via_asset_id: null, via_asset_name: null,
  technology_version_id: null, version_label: null, notes: null, ...overrides,
});

const ROWS: TechnologyServerRow[] = [
  row({ link_id: 'l-1', asset_id: 'db1', asset_name: 'PAR-DB-01', asset_reference: 'AST-1', operating_system_label: 'Windows Server 2019', technology_version_id: 'v19', version_label: '2019', notes: 'Main instance' }),
  row({ link_id: 'l-2', asset_id: 'db2', asset_name: 'PAR-DB-02', asset_reference: 'AST-2', environment: 'pre_prod' }),
  row({ link_id: 'l-3', asset_id: 'old', asset_name: 'PAR-DB-OLD', asset_reference: 'AST-3', asset_status: 'retired', technology_version_id: 'v12', version_label: '2012' }),
  row({ kind: 'carried', asset_id: 'vm1', asset_name: 'PAR-VM-01', asset_reference: 'AST-4', via_asset_id: 'db1', via_asset_name: 'PAR-DB-01', technology_version_id: 'v19', version_label: '2019' }),
];
const VERSIONS = [{ id: 'v22', label: '2022' }, { id: 'v19', label: '2019' }, { id: 'v12', label: '2012' }];

/** The open picker: queries stay inside it (the whole page is slow to search by role). */
const picker = () => within(document.querySelector('.MuiPopover-paper') as HTMLElement);
const pickAsset = async () => {
  fireEvent.click(screen.getByText(`${S}.add`));
  const option = await waitFor(() => picker().getByText('PAR-DB-09'));
  fireEvent.click(option);
  return waitFor(() => picker().getByPlaceholderText('workspace.technology.versionPicker.placeholder'));
};

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderTab(items: TechnologyServerRow[] = ROWS, canManage = true) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/technologies/tech-1/assets') return { data: { items } } as never;
    if (url === '/assets') return { data: { items: [{ id: 'db9', name: 'PAR-DB-09', asset_reference: 'AST-9', environment: 'prod' }] } } as never;
    throw new Error(`unexpected GET ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/technologies/TEC-3/servers']}>
          <Routes>
            <Route path="*" element={<><TechnologyServersTab technologyId="tech-1" versions={VERSIONS} canManage={canManage} /><Location /></>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.patch.mockReset();
  mocked.delete.mockReset();
  mocked.post.mockResolvedValue({ data: { ok: true } } as never);
  mocked.patch.mockResolvedValue({ data: { ok: true } } as never);
  mocked.delete.mockResolvedValue({ data: { ok: true } } as never);
});

describe('TechnologyServersTab', () => {
  it('lists the direct and deduced servers with environment, system, version and the server they come through', async () => {
    renderTab();
    const table = await screen.findByRole('table', { name: `${S}.title` });
    const rows = [...table.querySelectorAll('tbody tr')] as HTMLElement[];
    expect(rows.map((tr) => tr.querySelector('td')?.textContent)).toEqual(['AST-1', 'AST-2', 'AST-3', 'AST-4']);
    const first = within(rows[0]);
    expect(first.getByText('PAR-DB-01')).toBeTruthy();
    expect(first.getByText('enums.environment.prod')).toBeTruthy();
    expect(first.getByText('Windows Server 2019')).toBeTruthy();
    expect(first.getByText('2019')).toBeTruthy();
    // An unknown version is a greyed dash, worded on hover.
    expect(within(rows[1]).getByTitle('workspace.technology.versionPicker.unknown').textContent).toBe('—');
    expect(within(rows[1]).getByText('enums.environment.preProd')).toBeTruthy();
    // The deduced row names the server it is installed on.
    expect(within(rows[3]).getByText('PAR-DB-01')).toBeTruthy();

    fireEvent.click(first.getByText('PAR-DB-01'));
    expect(screen.getByTestId('location').textContent).toBe('/it/assets/AST-1/overview');
  });

  it('shows a retired server in tertiary text, removable, and leaves it out of the total and the badge', async () => {
    renderTab();
    const table = await screen.findByRole('table', { name: `${S}.title` });
    const retired = screen.getByText(/PAR-DB-OLD/).closest('tr') as HTMLElement;
    expect(retired.textContent).toContain(`${S}.retiredShort`);
    expect(within(retired).getByRole('button', { name: `${S}.remove(name=PAR-DB-OLD)` })).toBeTruthy();
    // Three servers in service: the two installed and the one carried.
    expect(table.querySelector('tfoot')?.textContent).toContain(`${S}.serverCount(count=3)`);
    // The badge says the same number.
    expect(countServers(ROWS)).toBe(3);
  });

  it('removes a direct link and refuses to remove a deduced one', async () => {
    renderTab();
    await screen.findByRole('table', { name: `${S}.title` });
    expect(screen.queryByRole('button', { name: `${S}.remove(name=PAR-VM-01)` })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: `${S}.remove(name=PAR-DB-02)` }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/technologies/tech-1/assets/l-2'));
    // A deduced row has no version to change either.
    expect(screen.queryByRole('button', { name: `${S}.changeVersion(name=PAR-VM-01)` })).toBeNull();
  });

  it('adds a server with a version created from the label typed', async () => {
    renderTab();
    await screen.findByRole('table', { name: `${S}.title` });
    const field = await pickAsset();
    expect(picker().getByText('workspace.technology.versionPicker.unknown')).toBeTruthy();
    fireEvent.change(field, { target: { value: '2025 CU1' } });
    fireEvent.click(picker().getByText('workspace.technology.versionPicker.create(label=2025 CU1)'));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/technologies/tech-1/assets', { asset_id: 'db9', version_label: '2025 CU1' }));
  });

  it('adds a server with an existing version or none', async () => {
    renderTab();
    await screen.findByRole('table', { name: `${S}.title` });
    const field = await pickAsset();
    // A label typed that exists picks that version.
    fireEvent.change(field, { target: { value: '2022' } });
    expect(picker().queryByText(/versionPicker\.create/)).toBeNull();
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/technologies/tech-1/assets', { asset_id: 'db9', technology_version_id: 'v22' }));

    await waitFor(() => expect(document.querySelector('.MuiPopover-paper')).toBeNull());
    await pickAsset();
    fireEvent.click(picker().getByText('workspace.technology.versionPicker.unknown'));
    await waitFor(() => expect(mocked.post).toHaveBeenLastCalledWith('/technologies/tech-1/assets', { asset_id: 'db9', technology_version_id: null }));
  });

  it('takes the first matching version on Enter and creates nothing while one matches', async () => {
    renderTab();
    await screen.findByRole('table', { name: `${S}.title` });
    const field = await pickAsset();
    fireEvent.change(field, { target: { value: '201' } });
    // Typing filters; "Add version" stays offered for an explicit click.
    expect(picker().queryByText('2022')).toBeNull();
    expect(picker().getByText('workspace.technology.versionPicker.create(label=201)')).toBeTruthy();
    fireEvent.keyDown(field, { key: 'Enter' });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/technologies/tech-1/assets', { asset_id: 'db9', technology_version_id: 'v19' }));
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it('changes the version and the notes of a direct link in place', async () => {
    renderTab();
    await screen.findByRole('table', { name: `${S}.title` });
    fireEvent.click(screen.getByRole('button', { name: `${S}.changeVersion(name=PAR-DB-01)` }));
    expect(picker().getByText('2019').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(picker().getByText('2022'));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/technologies/tech-1/assets/l-1', { technology_version_id: 'v22' }));
    // Choosing a version does not open the server.
    expect(screen.getByTestId('location').textContent).toBe('/it/technologies/TEC-3/servers');

    const notes = screen.getByLabelText(`${S}.notesOf(name=PAR-DB-02)`);
    fireEvent.change(notes, { target: { value: 'Failover node' } });
    fireEvent.blur(notes);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/technologies/tech-1/assets/l-2', { notes: 'Failover node' }));
  });

  it('saves a note and then a version of the same link one after the other', async () => {
    let answer: () => void = () => undefined;
    mocked.patch.mockReturnValueOnce(new Promise((resolve) => { answer = () => resolve({ data: { ok: true } }); }) as never);
    renderTab();
    await screen.findByRole('table', { name: `${S}.title` });
    const notes = screen.getByLabelText(`${S}.notesOf(name=PAR-DB-01)`);
    fireEvent.change(notes, { target: { value: 'Primary' } });
    fireEvent.blur(notes);
    fireEvent.click(screen.getByRole('button', { name: `${S}.changeVersion(name=PAR-DB-01)` }));
    fireEvent.click(picker().getByText('2022'));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    expect(mocked.patch).toHaveBeenCalledWith('/technologies/tech-1/assets/l-1', { notes: 'Primary' });
    answer();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    expect(mocked.patch).toHaveBeenLastCalledWith('/technologies/tech-1/assets/l-1', { technology_version_id: 'v22' });
  });

  it('removes a link after its pending note, and says nothing when the link is already gone', async () => {
    let answer: () => void = () => undefined;
    mocked.patch.mockReturnValueOnce(new Promise((_, reject) => { answer = () => reject({ response: { status: 404, data: { message: 'Link not found' } } }); }) as never);
    renderTab();
    await screen.findByRole('table', { name: `${S}.title` });
    const notes = screen.getByLabelText(`${S}.notesOf(name=PAR-DB-02)`);
    fireEvent.change(notes, { target: { value: 'Old node' } });
    fireEvent.blur(notes);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: `${S}.remove(name=PAR-DB-02)` }));
    // The row leaves at once; the delete waits for the note.
    await waitFor(() => expect(screen.queryByText('PAR-DB-02')).toBeNull());
    expect(mocked.delete).not.toHaveBeenCalled();
    answer();
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/technologies/tech-1/assets/l-2'));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows no writing control to a reader', async () => {
    renderTab(ROWS, false);
    await screen.findByRole('table', { name: `${S}.title` });
    expect(screen.queryByText(`${S}.add`)).toBeNull();
    expect(screen.queryByRole('button', { name: /servers\.remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /changeVersion/ })).toBeNull();
    expect(screen.getByText('Main instance')).toBeTruthy();
  });

  it('says in one line that no server carries the technology', async () => {
    renderTab([]);
    expect(await screen.findByText(`${S}.empty`)).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
