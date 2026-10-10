import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { STATUS_SCOPE_PARAM } from '../../utils/statusScopeParams';
import type { AnalyticsAxisDetail, AnalyticsValueDetail } from '../../services/analytics';

const navigateMock = vi.hoisted(() => vi.fn());
const navParams = vi.hoisted(() => ({ last: null as null | Record<string, any> }));
const axesState = vi.hoisted(() => ({ list: [] as unknown[] }));
const levels = vi.hoisted(() => ({ value: 'member' as 'reader' | 'member' | 'admin' }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'master-data:analytics.analyticsCategoryFallback') return 'Analytics dimension';
      // Counts and dimension names show after the key, so a test sees what the sentence carries.
      const extras = [opts?.count, opts?.dimension].filter((extra) => extra !== undefined);
      return extras.length > 0 ? `${key}:${extras.join(':')}` : key;
    },
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_resource: string, level: string) => {
      const rank: Record<string, number> = { reader: 1, member: 2, manager: 3, admin: 4 };
      return rank[levels.value] >= rank[level];
    },
  }),
}));
vi.mock('../../services/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/analytics')>()),
  getAnalyticsValue: vi.fn(),
  getAnalyticsAxis: vi.fn(),
  createAnalyticsValue: vi.fn(),
  updateAnalyticsValue: vi.fn(),
  deleteAnalyticsValue: vi.fn(),
}));
vi.mock('../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useAnalyticsAxes')>();
  return {
    ...actual,
    useAnalyticsAxes: () => actual.buildAnalyticsAxes(
      axesState.list as any,
      ((key: string) => (key === 'master-data:analytics.analyticsCategoryFallback' ? 'Analytics dimension' : key)) as any,
    ),
  };
});
vi.mock('../../hooks/useAnalyticsNav', () => ({
  useAnalyticsNav: (params: Record<string, any>) => {
    navParams.last = params;
    return { ids: ['v-0', 'v-1'], index: 1, total: 2, hasPrev: true, hasNext: false, prevId: 'v-0', nextId: null };
  },
  useAnalyticsDimensionNav: () => ({ ids: [], index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));

import * as service from '../../services/analytics';
import AnalyticsWorkspacePage from './AnalyticsWorkspacePage';
import AnalyticsDimensionWorkspacePage from './AnalyticsDimensionWorkspacePage';

const mocked = service as unknown as {
  getAnalyticsValue: ReturnType<typeof vi.fn>;
  getAnalyticsAxis: ReturnType<typeof vi.fn>;
  createAnalyticsValue: ReturnType<typeof vi.fn>;
  updateAnalyticsValue: ReturnType<typeof vi.fn>;
  deleteAnalyticsValue: ReturnType<typeof vi.fn>;
};

const AXES = [
  { id: 'ax-default', code: 'default', name: null, description: null, sort_order: 0, is_default: true, status: 'enabled', disabled_at: null },
  { id: 'ax-nature', code: 'nature', name: 'Nature', description: null, sort_order: 1, is_default: false, status: 'enabled', disabled_at: null },
  { id: 'ax-order', code: 'order', name: 'Internal order', description: null, sort_order: 2, is_default: false, status: 'disabled', disabled_at: '2026-01-01T00:00:00.000Z' },
];

const VALUE: AnalyticsValueDetail = {
  id: 'v-1',
  axis_id: 'ax-nature',
  name: 'Licenses',
  description: null,
  applies_to: null,
  status: 'enabled',
  disabled_at: null,
  axis_name: 'Nature',
  axis_is_default: false,
  opex_count: 3,
  capex_count: 1,
};

function renderAt(path: string, queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <Link to="/master-data/analytics/v-2/overview?axis=ax-nature">go to v-2</Link>
          <Routes>
            <Route path="/master-data/analytics/dimensions/:id/:tab" element={<AnalyticsDimensionWorkspacePage />} />
            <Route path="/master-data/analytics/:id/:tab" element={<AnalyticsWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const usageSelect = () => screen.getByRole('combobox', { name: 'shared.lineTypeUsage.label' });

async function pickUsage(label: string) {
  fireEvent.mouseDown(usageSelect());
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: label }));
}

async function findTitle(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 1 });
  await waitFor(() => expect(heading).toHaveTextContent('Licenses'));
  return within(heading).getByText('Licenses');
}

describe('AnalyticsWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    levels.value = 'member';
    navParams.last = null;
    axesState.list = AXES;
    mocked.getAnalyticsValue.mockResolvedValue(VALUE);
    mocked.updateAnalyticsValue.mockImplementation(async (_id: string, patch: Partial<AnalyticsValueDetail>) => ({ ...VALUE, ...patch }));
  });

  it('lets a member rename the value from the title, saved on blur, with no save button', async () => {
    renderAt('/master-data/analytics/v-1/overview?axis=ax-nature');
    fireEvent.click(await findTitle());
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    const input = within(screen.getByRole('heading', { level: 1 })).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Software licenses' } });
    expect(mocked.updateAnalyticsValue).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => expect(mocked.updateAnalyticsValue).toHaveBeenCalledWith('v-1', { name: 'Software licenses' }));
  });

  it('saves the description on blur and the lifecycle on change', async () => {
    renderAt('/master-data/analytics/v-1/overview?axis=ax-nature');
    const description = await screen.findByLabelText('analytics.fields.description');
    fireEvent.change(description, { target: { value: 'Software subscriptions' } });
    fireEvent.blur(description);
    await waitFor(() => expect(mocked.updateAnalyticsValue).toHaveBeenCalledWith('v-1', { description: 'Software subscriptions' }));
    fireEvent.click(within(screen.getByRole('complementary')).getByRole('checkbox', { name: 'statuses.enabled' }));
    await waitFor(() => expect(mocked.updateAnalyticsValue).toHaveBeenCalledTimes(2));
    const [, body] = mocked.updateAnalyticsValue.mock.calls[1];
    expect(body.disabled_at).toEqual(expect.any(String));
    expect(Object.keys(body).sort()).toEqual(['disabled_at', 'status']);
  });

  it('shows the dimension read only', async () => {
    renderAt('/master-data/analytics/v-1/overview?axis=ax-nature');
    await findTitle();
    const drawer = screen.getByRole('complementary');
    expect(within(drawer).getByTestId('analytics-value-dimension')).toHaveTextContent('Nature');
    expect(within(drawer).queryByLabelText('analytics.fields.dimension')).toBeNull();
    // The one select of the drawer is "Used for".
    expect(within(drawer).getAllByRole('combobox').map((el) => el.getAttribute('aria-label'))).toEqual(['shared.lineTypeUsage.label']);
  });

  it('saves which lines may use the value on change, and clears it back to both types', async () => {
    renderAt('/master-data/analytics/v-1/overview?axis=ax-nature');
    await findTitle();
    expect(usageSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.both');
    expect(usageSelect()).not.toHaveAttribute('aria-disabled');
    expect(screen.queryByTestId('analytics-value-applies-to-conflict')).toBeNull();
    await pickUsage('master-data:shared.lineTypeUsage.opex');
    await waitFor(() => expect(mocked.updateAnalyticsValue).toHaveBeenCalledWith('v-1', { applies_to: 'opex' }));
    await waitFor(() => expect(usageSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.opex'));
    await pickUsage('master-data:shared.lineTypeUsage.both');
    await waitFor(() => expect(mocked.updateAnalyticsValue).toHaveBeenLastCalledWith('v-1', { applies_to: null }));
  });

  it('shows a refused "Used for" under the field', async () => {
    mocked.updateAnalyticsValue.mockRejectedValueOnce({
      response: { status: 400, data: { message: 'The Nature dimension is for OPEX lines only.', field: 'applies_to' } },
    });
    renderAt('/master-data/analytics/v-1/overview?axis=ax-nature');
    await findTitle();
    await pickUsage('master-data:shared.lineTypeUsage.capex');
    expect(await screen.findByRole('alert')).toHaveTextContent('The Nature dimension is for OPEX lines only.');
  });

  it('under a dimension restricted to one type, says why and offers every choice but the other type', async () => {
    axesState.list = AXES.map((axis) => (axis.id === 'ax-nature' ? { ...axis, applies_to: 'opex' } : axis));
    // A redundant restriction: the value is for OPEX lines only, as its dimension.
    mocked.getAnalyticsValue.mockResolvedValue({ ...VALUE, applies_to: 'opex' });
    renderAt('/master-data/analytics/v-1/overview?axis=ax-nature');
    await findTitle();
    expect(within(screen.getByRole('complementary')).getByText('analytics.hints.valueDimensionAppliesTo.opex:Nature')).toBeInTheDocument();
    // The CAPEX lines do not show the dimension: no conflict line about them.
    expect(screen.queryByTestId('analytics-value-applies-to-conflict')).toBeNull();
    expect(usageSelect()).not.toHaveAttribute('aria-disabled');
    fireEvent.mouseDown(usageSelect());
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: 'master-data:shared.lineTypeUsage.capex' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(listbox).getByRole('option', { name: 'master-data:shared.lineTypeUsage.opex' })).not.toHaveAttribute('aria-disabled');
    // Clearing the restriction, as the dimension's refusal asks before it changes type.
    const both = within(listbox).getByRole('option', { name: 'master-data:shared.lineTypeUsage.both' });
    expect(both).not.toHaveAttribute('aria-disabled');
    fireEvent.click(both);
    await waitFor(() => expect(mocked.updateAnalyticsValue).toHaveBeenCalledWith('v-1', { applies_to: null }));
  });

  it('says how many lines of the other type keep the value, and opens them in a new tab', async () => {
    mocked.getAnalyticsValue.mockResolvedValue({ ...VALUE, applies_to: 'opex', opex_count: 3, capex_count: 4 });
    renderAt('/master-data/analytics/v-1/overview?axis=ax-nature');
    const note = await screen.findByTestId('analytics-value-applies-to-conflict');
    expect(note).toHaveTextContent('analytics.valueAppliesToConflict.capex:4');
    const link = within(note).getByRole('link', { name: 'analytics.showLines' });
    expect(link).toHaveAttribute('target', '_blank');
    const url = new URL(link.getAttribute('href') as string, 'http://kanap.test');
    // The CAPEX list on this value of the dimension, every status, as a one-off view.
    expect(url.pathname).toBe('/ops/capex');
    expect(JSON.parse(url.searchParams.get('filters') as string)).toEqual({ 'analytics_ax-nature': { filterType: 'set', values: ['Licenses'] } });
    expect(url.searchParams.get(STATUS_SCOPE_PARAM)).toBe('all');
    expect(url.searchParams.get('from')).toBe('report');

    // The reverse choice: the OPEX lines keep it.
    await pickUsage('master-data:shared.lineTypeUsage.capex');
    await waitFor(() => expect(screen.getByTestId('analytics-value-applies-to-conflict')).toHaveTextContent('analytics.valueAppliesToConflict.opex:3'));
    const opexLink = within(screen.getByTestId('analytics-value-applies-to-conflict')).getByRole('link', { name: 'analytics.showLines' });
    expect(new URL(opexLink.getAttribute('href') as string, 'http://kanap.test').pathname).toBe('/ops/opex');

    // Both types allowed: no conflict left.
    await pickUsage('master-data:shared.lineTypeUsage.both');
    await waitFor(() => expect(screen.queryByTestId('analytics-value-applies-to-conflict')).toBeNull());
  });

  it('filters the default dimension on its list column', async () => {
    mocked.getAnalyticsValue.mockResolvedValue({ ...VALUE, axis_id: 'ax-default', axis_is_default: true, applies_to: 'capex', opex_count: 2, capex_count: 0 });
    renderAt('/master-data/analytics/v-1/overview');
    const note = await screen.findByTestId('analytics-value-applies-to-conflict');
    expect(note).toHaveTextContent('analytics.valueAppliesToConflict.opex:2');
    const url = new URL(within(note).getByRole('link').getAttribute('href') as string, 'http://kanap.test');
    expect(url.pathname).toBe('/ops/opex');
    expect(JSON.parse(url.searchParams.get('filters') as string)).toEqual({ analytics_category_name: { filterType: 'set', values: ['Licenses'] } });
  });

  it('says nothing about lines of the other type under a disabled dimension', async () => {
    mocked.getAnalyticsValue.mockResolvedValue({ ...VALUE, axis_id: 'ax-order', applies_to: 'opex', opex_count: 0, capex_count: 5 });
    renderAt('/master-data/analytics/v-1/overview?axis=ax-order');
    await findTitle();
    await waitFor(() => expect(usageSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.opex'));
    expect(screen.queryByTestId('analytics-value-applies-to-conflict')).toBeNull();
  });

  it('walks the values of its dimension and goes back to the page on it', async () => {
    renderAt('/master-data/analytics/v-1/overview?sort=name%3AASC&scope=enabled');
    await findTitle();
    // No dimension in the URL: the value's own one scopes the walk.
    await waitFor(() => expect(navParams.last?.extraParams).toEqual({ axis_id: 'ax-nature' }));
    expect(navParams.last?.statusScope).toBe('enabled');
    fireEvent.click(screen.getByRole('button', { name: 'analytics.previousValue' }));
    expect(navigateMock).toHaveBeenCalledWith('/master-data/analytics/v-0/overview?sort=name%3AASC&scope=enabled&axis=ax-nature');
    fireEvent.click(screen.getByRole('button', { name: 'analytics.title' }));
    expect(navigateMock).toHaveBeenLastCalledWith('/master-data/analytics?sort=name%3AASC&scope=enabled&axis=ax-nature');
  });

  it('keeps editing to members and deleting to admins, with the reason when lines use the value', async () => {
    levels.value = 'reader';
    const first = renderAt('/master-data/analytics/v-1/overview?axis=ax-nature');
    expect(await screen.findByLabelText('analytics.fields.description')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    expect(screen.getByTestId('analytics-value-usage')).toHaveTextContent('analytics.usage.valueBoth');
    first.unmount();

    levels.value = 'admin';
    const second = renderAt('/master-data/analytics/v-1/overview?axis=ax-nature');
    await findTitle();
    expect(screen.getByRole('button', { name: 'common:buttons.delete' })).toBeDisabled();
    expect(screen.getByTestId('analytics-value-usage')).toHaveTextContent('analytics.usage.valueBoth');
    expect(screen.getByTestId('analytics-value-usage')).not.toHaveTextContent('analytics.deleteBlocked');
    second.unmount();

    mocked.getAnalyticsValue.mockResolvedValue({ ...VALUE, opex_count: 0, capex_count: 0 });
    mocked.deleteAnalyticsValue.mockResolvedValue(undefined);
    renderAt('/master-data/analytics/v-1/overview?axis=ax-nature');
    await findTitle();
    expect(screen.queryByTestId('analytics-value-usage')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.deleteAnalyticsValue).toHaveBeenCalledWith('v-1'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/analytics?axis=ax-nature'));
  });

  it('shows a refused rename above the workspace', async () => {
    mocked.updateAnalyticsValue.mockRejectedValueOnce({
      response: { data: { message: 'A value named Hardware already exists in Nature.', field: 'name' } },
    });
    renderAt('/master-data/analytics/v-1/overview?axis=ax-nature');
    fireEvent.click(await findTitle());
    const input = within(screen.getByRole('heading', { level: 1 })).getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Hardware' } });
    fireEvent.blur(input);
    expect(await screen.findByRole('alert')).toHaveTextContent('A value named Hardware already exists in Nature.');
  });

  it('creates in the page dimension and posts it', async () => {
    mocked.createAnalyticsValue.mockResolvedValue({ ...VALUE, id: 'v-new' });
    renderAt('/master-data/analytics/new/overview?axis=ax-nature&sort=name%3AASC');
    expect(screen.queryByRole('complementary')).toBeNull();
    const dimension = screen.getByLabelText('analytics.fields.dimension');
    expect(within(dimension.parentElement as HTMLElement).getByRole('combobox')).toHaveTextContent('Nature');
    fireEvent.change(screen.getByLabelText('analytics.fields.name'), { target: { value: ' Hardware ' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.createAnalyticsValue).toHaveBeenCalledWith({
      axis_id: 'ax-nature',
      name: 'Hardware',
      description: null,
      applies_to: null,
    }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/analytics/v-new/overview?sort=name%3AASC&axis=ax-nature'));
  });

  it('offers enabled dimensions only, and falls back to the default for a disabled one', async () => {
    mocked.createAnalyticsValue.mockResolvedValue({ ...VALUE, id: 'v-new', axis_id: 'ax-default' });
    renderAt('/master-data/analytics/new/overview?axis=ax-order');
    const dimension = screen.getByLabelText('analytics.fields.dimension');
    const combobox = within(dimension.parentElement as HTMLElement).getByRole('combobox');
    expect(combobox).toHaveTextContent('Analytics dimension');
    fireEvent.mouseDown(combobox);
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Analytics dimension', 'Nature']);
    fireEvent.click(options[1]);
    fireEvent.change(screen.getByLabelText('analytics.fields.name'), { target: { value: 'Hardware' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.createAnalyticsValue).toHaveBeenCalledWith(expect.objectContaining({ axis_id: 'ax-nature' })));
  });

  it('creates a value for one type of line', async () => {
    mocked.createAnalyticsValue.mockResolvedValue({ ...VALUE, id: 'v-new', applies_to: 'capex' });
    renderAt('/master-data/analytics/new/overview?axis=ax-nature');
    expect(usageSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.both');
    await pickUsage('master-data:shared.lineTypeUsage.capex');
    fireEvent.change(screen.getByLabelText('analytics.fields.name'), { target: { value: 'Leasing' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.createAnalyticsValue).toHaveBeenCalledWith({
      axis_id: 'ax-nature',
      name: 'Leasing',
      description: null,
      applies_to: 'capex',
    }));
  });

  it('on create under a dimension restricted to one type, offers every choice but the other type', async () => {
    axesState.list = AXES.map((axis) => (axis.id === 'ax-nature' ? { ...axis, applies_to: 'capex' } : axis));
    mocked.createAnalyticsValue
      .mockRejectedValueOnce({ response: { status: 400, data: { message: 'The Nature dimension is for CAPEX lines only.', field: 'applies_to' } } })
      .mockResolvedValueOnce({ ...VALUE, id: 'v-new', axis_id: 'ax-nature', applies_to: 'capex' });
    renderAt('/master-data/analytics/new/overview?axis=ax-default');
    // The default dimension is for both types: every choice is open.
    await pickUsage('master-data:shared.lineTypeUsage.opex');
    // Nature is for CAPEX lines only: the OPEX choice falls back to both types and closes.
    const dimension = within(screen.getByLabelText('analytics.fields.dimension').parentElement as HTMLElement).getByRole('combobox');
    fireEvent.mouseDown(dimension);
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'Nature' }));
    await waitFor(() => expect(usageSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.both'));
    expect(usageSelect()).not.toHaveAttribute('aria-disabled');
    expect(screen.getByText('analytics.hints.valueDimensionAppliesTo.capex:Nature')).toBeInTheDocument();
    fireEvent.mouseDown(usageSelect());
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: 'master-data:shared.lineTypeUsage.opex' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(listbox).getByRole('option', { name: 'master-data:shared.lineTypeUsage.capex' })).not.toHaveAttribute('aria-disabled');
    expect(within(listbox).getByRole('option', { name: 'master-data:shared.lineTypeUsage.both' })).not.toHaveAttribute('aria-disabled');
    fireEvent.keyDown(listbox, { key: 'Escape' });
    fireEvent.change(screen.getByLabelText('analytics.fields.name'), { target: { value: 'Leasing' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.createAnalyticsValue).toHaveBeenCalledWith(expect.objectContaining({ axis_id: 'ax-nature', applies_to: null })));
    // A refusal on the field shows under it.
    expect(await screen.findByRole('alert')).toHaveTextContent('The Nature dimension is for CAPEX lines only.');
    // The dimension's own type stays a choice.
    await pickUsage('master-data:shared.lineTypeUsage.capex');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.createAnalyticsValue).toHaveBeenLastCalledWith(expect.objectContaining({ axis_id: 'ax-nature', applies_to: 'capex' })));
  });

  it('refuses to create without a name', async () => {
    renderAt('/master-data/analytics/new/overview?axis=ax-nature');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('analytics.messages.nameRequired')).toBeInTheDocument();
    expect(mocked.createAnalyticsValue).not.toHaveBeenCalled();
  });

  it('walks the own dimension of the value once loaded, whatever a stale link says', async () => {
    renderAt('/master-data/analytics/v-1/overview?axis=ax-order');
    await findTitle();
    await waitFor(() => expect(navParams.last?.extraParams).toEqual({ axis_id: 'ax-nature' }));
    fireEvent.click(screen.getByRole('button', { name: 'analytics.title' }));
    expect(navigateMock).toHaveBeenLastCalledWith('/master-data/analytics?axis=ax-nature');
  });

  it('refreshes the dimension counts once a value is deleted, so its Delete opens', async () => {
    levels.value = 'admin';
    // The app keeps data fresh for 30 s: only an invalidation brings the new counts.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const nature: AnalyticsAxisDetail = {
      id: 'ax-nature', code: 'nature', name: 'Nature', description: null, sort_order: 1, is_default: false,
      applies_to: null, required: false, status: 'enabled', disabled_at: null, value_count: 1, opex_count: 0, capex_count: 0,
    };
    mocked.getAnalyticsAxis.mockResolvedValue(nature);
    const first = renderAt('/master-data/analytics/dimensions/ax-nature/overview', queryClient);
    expect(await screen.findByTestId('analytics-dimension-delete-block')).toHaveTextContent('analytics.deleteBlocked.dimensionHasValues');
    expect(screen.getByRole('button', { name: 'common:buttons.delete' })).toBeDisabled();
    first.unmount();

    mocked.getAnalyticsValue.mockResolvedValue({ ...VALUE, opex_count: 0, capex_count: 0 });
    mocked.deleteAnalyticsValue.mockResolvedValue(undefined);
    const second = renderAt('/master-data/analytics/v-1/overview?axis=ax-nature', queryClient);
    await findTitle();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/analytics?axis=ax-nature'));
    second.unmount();

    mocked.getAnalyticsAxis.mockResolvedValue({ ...nature, value_count: 0 });
    renderAt('/master-data/analytics/dimensions/ax-nature/overview', queryClient);
    await waitFor(() => expect(screen.getByTestId('analytics-dimension-usage')).toHaveTextContent('analytics.usage.noValues'));
    expect(screen.queryByTestId('analytics-dimension-delete-block')).toBeNull();
    expect(screen.getByRole('button', { name: 'common:buttons.delete' })).toBeEnabled();
  });

  it('drops a late delete refusal once the user has moved to another value', async () => {
    levels.value = 'admin';
    let failDelete: (reason: unknown) => void = () => undefined;
    mocked.getAnalyticsValue.mockImplementation(async (id: string) => (
      id === 'v-2' ? { ...VALUE, id: 'v-2', name: 'Hardware' } : { ...VALUE, opex_count: 0, capex_count: 0 }
    ));
    mocked.deleteAnalyticsValue.mockImplementationOnce(() => new Promise((_resolve, reject) => { failDelete = reject; }));
    renderAt('/master-data/analytics/v-1/overview?axis=ax-nature');
    await findTitle();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.deleteAnalyticsValue).toHaveBeenCalledWith('v-1'));
    fireEvent.click(screen.getByRole('link', { name: 'go to v-2' }));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hardware'));
    failDelete({ response: { status: 409, data: { message: 'Licenses is used by 3 OPEX lines. Disable it instead.' } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Licenses is used by 3 OPEX lines. Disable it instead.')).toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
