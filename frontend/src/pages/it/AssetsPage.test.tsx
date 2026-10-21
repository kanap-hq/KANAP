import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import AssetsPage from './AssetsPage';

const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const post = vi.hoisted(() => vi.fn());
const grid = vi.hoisted(() => ({ calls: [] as any[] }));
const features = vi.hoisted(() => ({ vulnerabilityFeed: false, isLoading: false }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post } }));
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
});
