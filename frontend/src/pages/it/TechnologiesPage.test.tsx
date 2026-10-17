import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
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

const stableT = (key: string) => key;
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
vi.mock('../../hooks/useListContextSearch', () => ({ useUrlFilterModel: () => ({ ready: true, model: null }) }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    settings: null,
    byField: {
      technologyFamily: [{ code: 'database', label: 'Database' }, { code: 'directory', label: 'Directory and identity' }],
      lifecycleStatus: [{ code: 'active', label: 'Active' }],
    },
    labelFor: (_field: string, code: string) => (code === 'database' ? 'Database' : code),
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
    get.mockReset();
    post.mockReset();
  });

  it('lists the technologies from GET /technologies with the planned columns', () => {
    renderPage();
    expect(grid.props!.endpoint).toBe('/technologies');
    expect((grid.props!.columns as any[]).map((col) => col.field)).toEqual([
      'reference', 'name', 'family', 'editor', 'lifecycle', 'versions_in_use', 'servers', 'applications', 'it_owner_names', 'next_support_end',
    ]);
    // The secondary columns start hidden: the default set fits a 1,440 px window.
    expect((grid.props!.columns as any[]).filter((col) => col.defaultHidden).map((col) => col.field)).toEqual([
      'lifecycle', 'versions_in_use', 'it_owner_names',
    ]);
    const shown = (grid.props!.columns as any[]).filter((col) => !col.defaultHidden);
    expect(shown.reduce((sum, col) => sum + (col.width ?? col.minWidth), 0)).toBeLessThanOrEqual(1100);
    expect(column('family').valueFormatter({ value: 'database' })).toBe('Database');
    expect(column('it_owner_names').valueFormatter({ value: ['Ada Lovelace', 'Alan Turing'] })).toBe('Ada Lovelace +1');
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

  it('opens the creation dialog', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'pages.technologies.newTechnology' }));
    expect(await screen.findByText('create dialog')).toBeTruthy();
  });
});
