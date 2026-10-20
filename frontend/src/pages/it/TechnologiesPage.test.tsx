import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import TechnologiesPage from './TechnologiesPage';

const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const auth = vi.hoisted(() => ({ levels: { infrastructure: 'admin' } as Record<string, string> }));
const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
const features = vi.hoisted(() => ({ vulnerabilityFeed: false }));

const stableT = (key: string, options?: { returnObjects?: boolean }) => (
  options?.returnObjects ? { intro: `${key}.intro`, items: [`${key}.a`, `${key}.b`] } : key
);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<any>()), useNavigate: () => navigate }));
const RANK: Record<string, number> = { reader: 1, member: 2, admin: 3 };
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string, level: string) => (RANK[auth.levels[resource]] ?? 0) >= RANK[level] }),
}));
vi.mock('../../api', () => ({ default: { get, post } }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features } }) }));
vi.mock('../../hooks/useListContextSearch', () => ({ useUrlFilterModel: () => ({ ready: true, model: null }) }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    settings: null,
    byField: {
      technologyFamily: [{ code: 'database', label: 'Database' }, { code: 'directory', label: 'Directory and identity' }],
      lifecycleStatus: [{ code: 'active', label: 'Active' }],
      hostingType: [{ code: 'on_prem', label: 'On-prem' }, { code: 'saas', label: 'SaaS' }],
    },
    labelFor: (_field: string, code: string) => ({ database: 'Database', on_prem: 'On-prem', saas: 'SaaS' } as Record<string, string>)[code] ?? code,
  }),
}));
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    return null;
  },
}));
vi.mock('../../components/DeleteSelectedButton', () => ({
  default: (props: Record<string, any>) => {
    deleteButton.props = props;
    return null;
  },
}));
vi.mock('./components/TechnologyCreateDialog', () => ({ default: ({ open }: { open: boolean }) => (open ? <div>create dialog</div> : null) }));

function renderPage() {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter><TechnologiesPage /></MemoryRouter>
    </ThemeProvider>,
  );
}

const column = (field: string) => (grid.props!.columns as any[]).find((col) => col.field === field);

describe('TechnologiesPage', () => {
  beforeEach(() => {
    grid.props = null;
    deleteButton.props = null;
    auth.levels = { infrastructure: 'admin' };
    features.vulnerabilityFeed = false;
    get.mockReset();
    post.mockReset();
  });

  it('lists the technologies from GET /technologies with the planned columns', () => {
    renderPage();
    expect(grid.props!.endpoint).toBe('/technologies');
    expect((grid.props!.columns as any[]).map((col) => col.field)).toEqual([
      'reference', 'name', 'family', 'editor', 'lifecycle', 'hosting_type', 'versions_in_use', 'servers', 'applications', 'it_owner_names', 'next_support_end',
    ]);
    // The secondary columns start hidden: the default set fits a 1,440 px window.
    expect((grid.props!.columns as any[]).filter((col) => col.defaultHidden).map((col) => col.field)).toEqual([
      'lifecycle', 'hosting_type', 'versions_in_use', 'it_owner_names',
    ]);
    const shown = (grid.props!.columns as any[]).filter((col) => !col.defaultHidden);
    expect(shown.reduce((sum, col) => sum + (col.width ?? col.minWidth), 0)).toBeLessThanOrEqual(1100);
    expect(column('family').valueFormatter({ value: 'database' })).toBe('Database');
    expect(column('it_owner_names').valueFormatter({ value: ['Ada Lovelace', 'Alan Turing'] })).toBe('Ada Lovelace +1');
    expect(column('hosting_type').valueFormatter({ value: 'saas' })).toBe('SaaS');
  });

  it('filters by hosting type from the catalog, with its localized names', async () => {
    renderPage();
    expect(await column('hosting_type').filterParams.getValues({})).toEqual([
      { value: 'on_prem', label: 'On-prem' },
      { value: 'saas', label: 'SaaS' },
    ]);
  });

  it('filters by family from the catalog and by editor from the editors endpoint', async () => {
    renderPage();
    const families = await column('family').filterParams.getValues({});
    expect(families).toEqual([{ value: 'database', label: 'Database' }, { value: 'directory', label: 'Directory and identity' }]);
    get.mockResolvedValueOnce({ data: { editor: ['Microsoft', 'VMware', null] } });
    const editors = await column('editor').filterParams.getValues({});
    expect(get).toHaveBeenCalledWith('/technologies/filter-values', { params: { fields: 'editor' } });
    expect(editors).toEqual([
      { value: 'Microsoft', label: 'Microsoft' },
      { value: 'VMware', label: 'VMware' },
      { value: null, label: 'common:filters.blank' },
    ]);
  });

  it('opens a row on its reference', () => {
    renderPage();
    const Cell = column('name').cellRenderer;
    render(<MemoryRouter><Cell value="SQL Server" data={{ id: 'u1', reference: 'TEC-3', name: 'SQL Server' }} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'SQL Server' });
    expect(link.getAttribute('href')).toMatch(/^\/it\/technologies\/TEC-3\/overview\?sort=name%3AASC/);
  });

  it('colours the next end of support from the shared support states', () => {
    renderPage();
    const Cell = column('next_support_end').cellRenderer;
    const theme = createAppTheme('dark');
    const soon = new Date();
    soon.setMonth(soon.getMonth() + 2);
    const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const { unmount } = render(<ThemeProvider theme={theme}><Cell value={day(soon)} data={{}} /></ThemeProvider>);
    expect(screen.getByTestId('support-end').getAttribute('data-state')).toBe('ending_soon');
    expect(getComputedStyle(screen.getByTestId('support-end')).color).toBe('rgb(240, 168, 48)'); // kanap.orange, dark
    unmount();
    render(<ThemeProvider theme={theme}><Cell value="2099-01-01" data={{}} /></ThemeProvider>);
    expect(screen.getByTestId('support-end').getAttribute('data-state')).toBe('supported');
  });

  it('says in one line that the list is empty, with the creation for a manager', async () => {
    renderPage();
    render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.emptyState}</ThemeProvider>);
    expect(screen.getByTestId('technologies-empty').textContent).toContain('pages.technologies.empty');
    const buttons = screen.getAllByRole('button', { name: 'pages.technologies.newTechnology' });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByText('create dialog')).toBeTruthy();
  });

  it('leaves the creation out of the empty list for a reader', () => {
    auth.levels = { infrastructure: 'reader' };
    renderPage();
    render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.emptyState}</ThemeProvider>);
    expect(screen.getByTestId('technologies-empty').textContent).toBe('pages.technologies.empty');
    expect(screen.queryByRole('button', { name: 'pages.technologies.newTechnology' })).toBeNull();
  });

  it('counts what a bulk delete takes with it', async () => {
    renderPage();
    post.mockResolvedValueOnce({ data: { refused: [], removes: [{ type: 'assets', total: 2 }] } });
    const result = await deleteButton.props!.checkDelete(['a']);
    expect(post).toHaveBeenCalledWith('/technologies/delete-check', { ids: ['a'] });
    expect(result.warning).toBe('pages.technologies.delete.warningCounted');
  });

  it('shows no writing action to a reader', () => {
    auth.levels = { infrastructure: 'reader' };
    renderPage();
    expect(screen.queryByRole('button', { name: 'pages.technologies.newTechnology' })).toBeNull();
    expect(deleteButton.props).toBeNull();
    expect(grid.props!.enableRowSelection).toBe(false);
  });

  it('counts the vulnerabilities to review while the feed is on, and links them to the filtered page', () => {
    features.vulnerabilityFeed = true;
    renderPage();
    const fields = (grid.props!.columns as any[]).map((col) => col.field);
    expect(fields[fields.length - 1]).toBe('vulnerabilities_to_review');
    // The default set still fits a 1,440 px window, applications included.
    const shown = (grid.props!.columns as any[]).filter((col) => !col.defaultHidden);
    expect(shown.map((col) => col.field)).toEqual(['reference', 'name', 'family', 'editor', 'servers', 'applications', 'next_support_end', 'vulnerabilities_to_review']);
    expect(column('servers').type).toBe('rightAligned');
    expect(shown.reduce((sum, col) => sum + (col.width ?? col.minWidth), 0)).toBeLessThanOrEqual(1100);
    const Cell = column('vulnerabilities_to_review').cellRenderer;
    const theme = createAppTheme('light');
    const { unmount } = render(
      <ThemeProvider theme={theme}><MemoryRouter>
        <Cell data={{ id: 'u1', reference: 'TEC-3', vulnerabilities_to_review: 5, vulnerabilities_severe: 2 }} />
      </MemoryRouter></ThemeProvider>,
    );
    const link = screen.getByTestId('vulnerabilities-to-review');
    expect(link.getAttribute('href')).toBe('/it/vulnerabilities?technology=TEC-3');
    expect(link.textContent).toBe('5 · 2');
    expect(link.getAttribute('title')).toBe('pages.technologies.vulnerabilityCount');
    expect(getComputedStyle(screen.getByTestId('vulnerabilities-severe')).color).toBe('rgb(180, 83, 9)'); // attention orange, light
    unmount();
    render(<ThemeProvider theme={theme}><MemoryRouter><Cell data={{ id: 'u2', reference: 'TEC-4', vulnerabilities_to_review: 3, vulnerabilities_severe: 0 }} /></MemoryRouter></ThemeProvider>);
    expect(screen.getByTestId('vulnerabilities-to-review').textContent).toBe('3');
    expect(screen.queryByTestId('vulnerabilities-severe')).toBeNull();
  });

  it('has no vulnerability column while the feed is off, and the editor opens the technology', () => {
    renderPage();
    expect(column('vulnerabilities_to_review')).toBeUndefined();
    const Cell = column('editor').cellRenderer;
    render(<MemoryRouter><Cell value="Oracle" data={{ id: 'u1', reference: 'TEC-3', editor: 'Oracle' }} /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'Oracle' }).getAttribute('href')).toMatch(/^\/it\/technologies\/TEC-3\/overview/);
  });

  it('leads from an editor to the vulnerabilities of that editor while the feed is on', () => {
    features.vulnerabilityFeed = true;
    renderPage();
    const Cell = column('editor').cellRenderer;
    render(<MemoryRouter><Cell value="Oracle & Co" data={{ id: 'u1', reference: 'TEC-3', editor: 'Oracle & Co' }} /></MemoryRouter>);
    expect(screen.getByTestId('editor-vulnerabilities').getAttribute('href')).toBe('/it/vulnerabilities?editor=Oracle%20%26%20Co');
  });

  it('opens the creation dialog', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'pages.technologies.newTechnology' }));
    expect(await screen.findByText('create dialog')).toBeTruthy();
  });

  describe('link files', () => {
    const menuItems = () => screen.getAllByRole('menuitem').map((item) => item.textContent);

    it('offers the import to a member, and the applications file to a reader of applications only', () => {
      auth.levels = { infrastructure: 'member' };
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'pages.technologies.importCsv' }));
      expect(menuItems()).toEqual(['pages.technologies.linkFiles.asset']);
    });

    it('offers the export without the import to a reader, with both files when applications are readable', () => {
      auth.levels = { infrastructure: 'reader', applications: 'reader' };
      renderPage();
      expect(screen.queryByRole('button', { name: 'pages.technologies.importCsv' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'pages.technologies.exportCsv' }));
      expect(menuItems()).toEqual(['pages.technologies.linkFiles.asset', 'pages.technologies.linkFiles.application']);
    });

    it('shows the import rules as a short list', async () => {
      auth.levels = { infrastructure: 'member' };
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'pages.technologies.importCsv' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'pages.technologies.linkFiles.asset' }));
      expect(await screen.findByText('pages.technologies.linkFiles.importHint.asset.intro')).toBeTruthy();
      expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
        'pages.technologies.linkFiles.importHint.asset.a',
        'pages.technologies.linkFiles.importHint.asset.b',
      ]);
    });

    it('checks the applications file with dryRun, then loads it', async () => {
      auth.levels = { infrastructure: 'member', applications: 'reader' };
      const report = { ok: true, total: 1, inserted: 1, updated: 0, unchanged: 0, errors: [], warnings: [] };
      post.mockResolvedValueOnce({ data: { ...report, dryRun: true } }).mockResolvedValueOnce({ data: { ...report, dryRun: false } });
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'pages.technologies.importCsv' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'pages.technologies.linkFiles.application' }));
      expect(await screen.findByText('pages.technologies.linkFiles.importTitle.application')).toBeTruthy();
      const input = document.querySelector('input[type="file"]') as HTMLInputElement;
      fireEvent.change(input, { target: { files: [new File(['application_reference\n'], 'apps.csv', { type: 'text/csv' })] } });
      fireEvent.click(screen.getByRole('button', { name: 'csv.preflightCheck' }));
      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      expect(post.mock.calls[0][0]).toBe('/technologies/application-links/import');
      expect(post.mock.calls[0][2]).toEqual({ params: { language: 'en', dryRun: true } });
      const load = await screen.findByRole('button', { name: 'csv.load' });
      await waitFor(() => expect((load as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(load);
      await waitFor(() => expect(post).toHaveBeenCalledTimes(2));
      expect(post.mock.calls[1][0]).toBe('/technologies/application-links/import');
      expect(post.mock.calls[1][2]).toEqual({ params: { language: 'en', dryRun: false } });
    });

    it('exports the servers file from its own route', async () => {
      auth.levels = { infrastructure: 'reader' };
      get.mockResolvedValueOnce({ data: 'asset_name\n', headers: {} });
      const createObjectURL = vi.fn(() => 'blob:x');
      Object.assign(window.URL, { createObjectURL, revokeObjectURL: vi.fn() });
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'pages.technologies.exportCsv' }));
      fireEvent.click(screen.getByRole('menuitem', { name: 'pages.technologies.linkFiles.asset' }));
      fireEvent.click(await screen.findByRole('button', { name: 'csv.exportData' }));
      await waitFor(() => expect(get).toHaveBeenCalledWith('/technologies/asset-links/export', { params: { language: 'en', scope: 'data' }, responseType: 'blob' }));
    });
  });
});
