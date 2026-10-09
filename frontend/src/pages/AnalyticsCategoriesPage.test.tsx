import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

const axesState = vi.hoisted(() => ({ list: [] as unknown[], ready: true, isError: false }));
const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const levels = vi.hoisted(() => ({ value: 'admin' as 'reader' | 'member' | 'admin' | null }));
const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts && 'name' in opts ? `${key}:${opts.name}` : key),
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_resource: string, level: string) => {
      const rank: Record<string, number> = { reader: 1, member: 2, manager: 3, admin: 4 };
      return levels.value != null && rank[levels.value] >= rank[level];
    },
  }),
}));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })) } }));
vi.mock('../hooks/useAnalyticsAxes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useAnalyticsAxes')>();
  return {
    ...actual,
    useAnalyticsAxes: () => actual.buildAnalyticsAxes(
      axesState.list as any,
      ((key: string) => (key === 'master-data:analytics.analyticsCategoryFallback' ? 'Analytics dimension' : key)) as any,
      axesState.ready,
      axesState.isError,
    ),
  };
});
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    return <div data-testid="grid" />;
  },
}));

import AnalyticsCategoriesPage from './AnalyticsCategoriesPage';

const DEFAULT = { id: 'ax-default', code: 'default', name: null, description: null, sort_order: 0, is_default: true, status: 'enabled', disabled_at: null };
const NATURE = { id: 'ax-nature', code: 'nature', name: 'Nature', description: null, sort_order: 1, is_default: false, status: 'enabled', disabled_at: null };
const ORDER = { id: 'ax-order', code: 'order', name: 'Internal order', description: null, sort_order: 2, is_default: false, status: 'disabled', disabled_at: '2026-01-01T00:00:00.000Z' };

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.search}</div>;
}

function renderPage(path = '/master-data/analytics') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <AnalyticsCategoriesPage />
          <LocationProbe />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function chips(): HTMLElement[] {
  return within(screen.getByRole('group', { name: 'analytics.dimensionsLabel' }))
    .getAllByRole('button')
    .filter((el) => el.hasAttribute('aria-pressed'));
}

describe('AnalyticsCategoriesPage', () => {
  beforeEach(() => {
    axesState.list = [DEFAULT, NATURE, ORDER];
    axesState.ready = true;
    axesState.isError = false;
    levels.value = 'admin';
    grid.props = null;
    navigateMock.mockReset();
  });

  it('shows one chip per dimension in order, the unnamed default by its translated label, a disabled one marked', () => {
    renderPage();
    expect(chips().map((c) => c.textContent)).toEqual(['Analytics dimension', 'Nature', 'Internal orderanalytics.disabledMark']);
    // The accessible name separates the mark from the name.
    expect(screen.getByRole('button', { name: 'analytics.markedDimension:Internal order' })).toBe(chips()[2]);
    expect(screen.getByRole('button', { name: 'Nature' })).toBe(chips()[1]);
  });

  it('marks a dimension used for one type of line only, next to a disabled mark', () => {
    axesState.list = [DEFAULT, { ...NATURE, applies_to: 'capex' }, { ...ORDER, applies_to: 'opex' }];
    renderPage();
    expect(chips().map((c) => c.textContent)).toEqual([
      'Analytics dimension',
      'Naturemaster-data:shared.lineTypeUsage.capex',
      'Internal orderanalytics.disabledMark · master-data:shared.lineTypeUsage.opex',
    ]);
    expect(screen.getByRole('button', { name: 'analytics.markedDimension:Nature' })).toBe(chips()[1]);
  });

  it('disables New value on a disabled dimension, with the reason', () => {
    const first = renderPage('/master-data/analytics?axis=ax-order');
    expect(screen.getByRole('button', { name: 'analytics.newValue' })).toBeDisabled();
    expect(screen.getByLabelText('analytics.enableToAddValues')).toContainElement(screen.getByRole('button', { name: 'analytics.newValue' }));
    first.unmount();
    renderPage('/master-data/analytics?axis=ax-nature');
    expect(screen.getByRole('button', { name: 'analytics.newValue' })).toBeEnabled();
    expect(screen.queryByLabelText('analytics.enableToAddValues')).toBeNull();
  });

  it('lists the default dimension values when the URL names none', () => {
    renderPage();
    expect(chips()[0]).toHaveAttribute('aria-pressed', 'true');
    expect(grid.props?.endpoint).toBe('/analytics-categories');
    expect(grid.props?.extraParams).toEqual({ axis_id: 'ax-default' });
    expect(grid.props?.columnPreferencesKey).toBe('analytics-values');
    expect(grid.props?.statusScopeConfig).toEqual({ defaultScope: 'enabled' });
    expect((grid.props?.columns as Array<{ field: string }>).map((c) => c.field)).toEqual(['name', 'description', 'status', 'applies_to', 'updated_at']);
  });

  it('shows which lines may use each value, with a set filter on the three choices', () => {
    renderPage();
    const column = (grid.props?.columns as Array<any>).find((col) => col.field === 'applies_to');
    expect(column.headerName).toBe('shared.lineTypeUsage.label');
    expect(column.defaultHidden).toBeFalsy();
    // The blank value is the default: a value for OPEX and CAPEX lines.
    expect(column.filterParams).toEqual({
      values: [
        { value: null, label: 'master-data:shared.lineTypeUsage.both' },
        { value: 'opex', label: 'master-data:shared.lineTypeUsage.opex' },
        { value: 'capex', label: 'master-data:shared.lineTypeUsage.capex' },
      ],
      searchable: false,
    });
    expect([null, 'opex', 'capex'].map((value) => column.valueFormatter({ value }))).toEqual([
      'master-data:shared.lineTypeUsage.both',
      'master-data:shared.lineTypeUsage.opex',
      'master-data:shared.lineTypeUsage.capex',
    ]);
  });

  it('lists the dimension named by ?axis=, and writes the chosen chip into the URL', () => {
    renderPage('/master-data/analytics?axis=ax-nature&sort=name%3AASC');
    expect(grid.props?.extraParams).toEqual({ axis_id: 'ax-nature' });
    expect(chips()[1]).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(chips()[2]);
    expect(screen.getByTestId('location').textContent).toContain('axis=ax-order');
    expect(screen.getByTestId('location').textContent).toContain('sort=name%3AASC');
    expect(grid.props?.extraParams).toEqual({ axis_id: 'ax-order' });
  });

  it('falls back to the default dimension for an unknown ?axis=', () => {
    renderPage('/master-data/analytics?axis=nope');
    expect(grid.props?.extraParams).toEqual({ axis_id: 'ax-default' });
  });

  it('opens the selected dimension from its edit button, and a new value inside it', () => {
    renderPage('/master-data/analytics?axis=ax-nature');
    const edit = screen.getByRole('button', { name: 'analytics.editDimension:Nature' });
    // One Edit button on the right of the band acts on the selected dimension, outside the toggles.
    expect(edit).toHaveTextContent('common:buttons.edit');
    expect(chips()).not.toContain(edit);
    expect(screen.queryByRole('button', { name: /analytics\.(edit|open)Dimension:(Analytics dimension|Internal order)/ })).toBeNull();
    fireEvent.click(edit);
    expect(navigateMock).toHaveBeenCalledWith('/master-data/analytics/dimensions/ax-nature/overview');
    fireEvent.click(screen.getByRole('button', { name: 'analytics.newValue' }));
    const target = navigateMock.mock.calls[1][0] as string;
    expect(target.startsWith('/master-data/analytics/new/overview?')).toBe(true);
    expect(new URLSearchParams(target.split('?')[1]).get('axis')).toBe('ax-nature');
    // The rows open the value with the same dimension in the list context.
    const href = (grid.props?.columns as Array<any>)[0].cellRenderer({ data: { id: 'v-1' } }).props.getHref({ id: 'v-1' });
    expect(href).toMatch(/^\/master-data\/analytics\/v-1\/overview\?/);
    expect(new URLSearchParams(href.split('?')[1]).get('axis')).toBe('ax-nature');
  });

  it('with one dimension, shows today\'s page plus its chip', () => {
    axesState.list = [DEFAULT];
    renderPage();
    expect(chips()).toHaveLength(1);
    expect(grid.props?.extraParams).toEqual({ axis_id: 'ax-default' });
  });

  it('offers New value and New dimension to members, CSV and delete to admins only', () => {
    levels.value = 'reader';
    const first = renderPage();
    expect(screen.queryByRole('button', { name: 'analytics.newValue' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'analytics.newDimension' })).toBeNull();
    // Readers only open the dimension, and the button says so.
    expect(screen.getByRole('button', { name: 'analytics.openDimension:Analytics dimension' })).toHaveTextContent('common:buttons.open');
    expect(screen.queryByRole('button', { name: 'analytics.editDimension:Analytics dimension' })).toBeNull();
    first.unmount();

    levels.value = 'member';
    const second = renderPage();
    expect(screen.getByRole('button', { name: 'analytics.newValue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'analytics.newDimension' })).toHaveTextContent('coa.chipBar.newChip');
    fireEvent.click(screen.getByRole('button', { name: 'analytics.newDimension' }));
    expect(navigateMock).toHaveBeenCalledWith('/master-data/analytics/dimensions/new/overview');
    expect(screen.queryByRole('button', { name: 'shared.labels.importCsv' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'shared.labels.exportCsv' })).toBeNull();
    expect(grid.props?.enableRowSelection).toBe(false);
    second.unmount();

    levels.value = 'admin';
    renderPage();
    // The actions on the values sit on the context line under the band, after the dimension's name.
    const context = screen.getByTestId('analytics-context');
    expect(context).toHaveTextContent('Analytics dimension');
    expect(within(context).getByRole('button', { name: 'analytics.newValue' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'shared.labels.importCsv' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'shared.labels.exportCsv' })).toBeInTheDocument();
    expect(grid.props?.enableRowSelection).toBe(true);
  });

  it('waits for the dimensions before listing, and says when they failed to load', () => {
    axesState.ready = false;
    const first = renderPage();
    expect(screen.queryByTestId('grid')).toBeNull();
    first.unmount();
    axesState.ready = true;
    axesState.isError = true;
    axesState.list = [];
    renderPage();
    expect(screen.queryByTestId('grid')).toBeNull();
    expect(screen.getByText('analytics.messages.dimensionsLoadFailed')).toBeInTheDocument();
  });

  it('refuses users without access', () => {
    levels.value = null;
    renderPage();
    expect(screen.queryByTestId('grid')).toBeNull();
  });
});
