import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import TechnologiesPage, { supportEndNear } from './TechnologiesPage';

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

  it('marks an end of support past or within twelve months', () => {
    const now = new Date('2026-10-16T12:00:00');
    expect(supportEndNear('2026-01-01', now)).toBe(true);
    expect(supportEndNear('2027-06-30', now)).toBe(true);
    expect(supportEndNear('2028-01-01', now)).toBe(false);
    expect(supportEndNear(null, now)).toBe(false);
    renderPage();
    const Cell = column('next_support_end').cellRenderer;
    render(<ThemeProvider theme={createAppTheme('light')}><Cell value="2020-01-14" data={{}} /></ThemeProvider>);
    expect(screen.getByTestId('support-end').getAttribute('data-near')).toBe('true');
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
