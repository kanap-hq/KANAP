import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import AssetsPage from './AssetsPage';

const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const post = vi.hoisted(() => vi.fn());
const apiGet = vi.hoisted(() => vi.fn());
const grid = vi.hoisted(() => ({ calls: [] as any[] }));
const features = vi.hoisted(() => ({ vulnerabilityFeed: false, isLoading: false }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../api', () => ({ default: { get: apiGet, post } }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({ default: () => ({ settings: null, byField: {}, labelFor: (_field: string, code: string) => code }) }));
vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { features: { vulnerabilityFeed: features.vulnerabilityFeed } }, isLoading: features.isLoading }),
}));
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: unknown) => {
    grid.calls.push(props);
    return null;
  },
}));
vi.mock('../../components/csv', () => ({ CsvExportDialogV2: () => null, CsvImportDialogV2: () => null }));
vi.mock('../../components/DeleteSelectedButton', () => ({
  default: (props: Record<string, any>) => {
    deleteButton.props = props;
    return null;
  },
}));

function renderPage(search = '') {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter initialEntries={[`/it/assets${search}`]}><AssetsPage /></MemoryRouter>
    </ThemeProvider>,
  );
}

const lastProps = () => grid.calls[grid.calls.length - 1] as {
  columns: Array<{ field?: string; cellRenderer?: React.FC<any>; sortable?: boolean; filterParams?: any }>;
  initialState?: { filter?: { filterModel?: Record<string, unknown> } };
};

beforeEach(() => {
  apiGet.mockReset();
  apiGet.mockResolvedValue({ data: { items: [] } });
  grid.calls = [];
  features.vulnerabilityFeed = false;
  features.isLoading = false;
});

describe('AssetsPage vulnerabilities', () => {
  it('shows the vulnerabilities to review after the name while the feed is on, linked to the filtered page', async () => {
    features.vulnerabilityFeed = true;
    renderPage();
    expect(lastProps().columns.map((column) => column.field).slice(0, 3)).toEqual(['asset_reference', 'name', 'vulnerabilities_to_review']);
    const column = lastProps().columns[2];
    expect(column.sortable).not.toBe(false);
    expect((await column.filterParams.getValues()).map((option: { value: string }) => option.value)).toEqual(['severe', 'any', 'none']);
    const Cell = column.cellRenderer!;
    const theme = createAppTheme('dark');
    const { unmount } = render(
      <ThemeProvider theme={theme}><MemoryRouter>
        <Cell data={{ id: 'a-1', asset_reference: 'AST-5', vulnerabilities_to_review: 3, vulnerabilities_severe: 2 }} />
      </MemoryRouter></ThemeProvider>,
    );
    expect(screen.getByTestId('vulnerabilities-to-review').getAttribute('href')).toBe('/it/vulnerabilities?asset=AST-5');
    expect(getComputedStyle(screen.getByTestId('vulnerabilities-severe')).color).toBe('rgb(240, 168, 48)'); // attention orange, dark
    unmount();
    // A retired asset (null): an empty cell.
    const { container } = render(<MemoryRouter><Cell data={{ id: 'a-2', asset_reference: 'AST-6', vulnerabilities_to_review: null, vulnerabilities_severe: null }} /></MemoryRouter>);
    expect(container.textContent).toBe('');
  });

  it('pre-applies ?vulnerabilities= from the address, with the filters it carries', () => {
    features.vulnerabilityFeed = true;
    const filters = encodeURIComponent(JSON.stringify({ kind: { filterType: 'set', values: ['vm'] } }));
    renderPage(`?vulnerabilities=none&filters=${filters}`);
    expect(lastProps().initialState?.filter?.filterModel).toEqual({
      kind: { filterType: 'set', values: ['vm'] },
      vulnerabilities_to_review: { filterType: 'set', values: ['none'] },
    });
  });

  it('waits for the features before a vulnerabilities filter, and has no column with the feed off', () => {
    features.isLoading = true;
    renderPage('?vulnerabilities=severe');
    expect(grid.calls).toHaveLength(0);
    renderPage();
    expect(lastProps().columns.map((column) => column.field)).not.toContain('vulnerabilities_to_review');
  });
});

describe('AssetsPage delete', () => {
  it('asks the delete check before its confirmation, and names the assets in its words', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter><AssetsPage /></MemoryRouter>
      </ThemeProvider>,
    );
    const props = deleteButton.props!;
    expect(props).not.toBeNull();
    expect(props.endpoint).toBe('/assets/bulk');
    const refused = [{ id: 'a', name: 'srv-01', code: 'ASSET_IN_USE', usages: [{ type: 'app_assignments', total: 2 }] }];
    post.mockResolvedValueOnce({ data: { refused } });
    expect(await props.checkDelete(['a', 'b'])).toEqual({ refused });
    expect(post).toHaveBeenCalledWith('/assets/delete-check', { ids: ['a', 'b'] });
    expect(String(props.itemLabels.toDelete(2))).toBe('pages.assets.delete.toDelete');
    expect(String(props.itemLabels.kept(1))).toBe('pages.assets.delete.kept');
    expect(String(props.itemLabels.deleted(2))).toBe('pages.assets.delete.deleted');
  });

  it('notes, under each asset the delete takes something with, what it takes, and asks "Delete anyway"', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter><AssetsPage /></MemoryRouter>
      </ThemeProvider>,
    );
    post.mockResolvedValueOnce({
      data: {
        refused: [],
        warnings: [
          { id: 'a', name: 'srv-01', member_of: [{ id: 'c', name: 'CL-1' }], member_count: 0, relations: [], relations_total: 0 },
          { id: 'b', name: 'srv-02', member_of: [], member_count: 2, relations: [{ id: 'x', name: 'esx-01', relation_type: 'depends_on', direction: 'outgoing' }], relations_total: 1 },
        ],
      },
    });
    const check = await deleteButton.props!.checkDelete(['a', 'b', 'c']);
    expect(check.confirmLabel).toBe('common:delete.anyway');
    expect(Object.keys(check.notes)).toEqual(['a', 'b']);
    expect(check.notes.a).toBe('common:delete.assetWarning.memberOf');
    expect(check.notes.b.split('\n')).toEqual(['common:delete.assetWarning.hasMembers', 'common:delete.assetWarning.links']);
  });
});

describe('AssetsPage clusters', () => {
  const column = () => lastProps().columns.find((c) => c.field === 'cluster')!;
  const cell = (data: Record<string, unknown>) => {
    const Cell = column().cellRenderer!;
    return render(<ThemeProvider theme={createAppTheme('light')}><MemoryRouter><Cell data={{ id: 'a-1', asset_reference: 'AST-1', ...data }} /></MemoryRouter></ThemeProvider>);
  };

  it('marks a cluster with an icon and a tooltip, with no word in the cell', () => {
    renderPage();
    cell({ is_cluster: true, cluster: null });
    const mark = screen.getByRole('img', { name: 'pages.assets.columns.cluster' });
    expect(mark).toBeTruthy();
    expect(mark.closest('a')?.textContent).toBe('');
  });

  it('names the clusters of a member, and leaves a plain asset empty', () => {
    renderPage();
    const { container, unmount } = cell({ is_cluster: false, cluster: 'CL-A, CL-B' });
    expect(container.textContent).toBe('CL-A, CL-B');
    expect(screen.queryByRole('img')).toBeNull();
    unmount();
    const empty = cell({ is_cluster: false, cluster: null });
    expect(empty.container.textContent).toBe('');
  });

  it('lists the filter as names, then "is a cluster", then "no cluster"', async () => {
    renderPage();
    apiGet.mockResolvedValueOnce({ data: { cluster: ['ZZ-CL', 'AA-CL', '__cluster__', null] } });
    const options = await column().filterParams.getValues({ context: undefined });
    expect(options).toEqual([
      { value: 'AA-CL', label: 'AA-CL' },
      { value: 'ZZ-CL', label: 'ZZ-CL' },
      { value: '__cluster__', label: 'pages.assets.filters.isCluster' },
      { value: null, label: 'pages.assets.filters.noCluster' },
    ]);
  });

  it('offers a new cluster, which opens the creation with the Cluster switch asked for', () => {
    function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/assets']}>
          <Routes>
            <Route path="/it/assets" element={<AssetsPage />} />
            <Route path="/it/assets/new/overview" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'pages.assets.addAsset' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'pages.assets.addCluster' }));
    const where = screen.getByTestId('where').textContent!;
    expect(where.startsWith('/it/assets/new/overview?')).toBe(true);
    expect(new URLSearchParams(where.split('?')[1]).get('cluster')).toBe('1');
  });

  it('opens a plain asset from the same menu, without the cluster switch', () => {
    function Where() { const l = useLocation(); return <div data-testid="where">{l.pathname + l.search}</div>; }
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/assets']}>
          <Routes>
            <Route path="/it/assets" element={<AssetsPage />} />
            <Route path="/it/assets/new/overview" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'pages.assets.addAsset' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'pages.assets.addAsset' }));
    expect(new URLSearchParams(screen.getByTestId('where').textContent!.split('?')[1]).get('cluster')).toBeNull();
  });
});
