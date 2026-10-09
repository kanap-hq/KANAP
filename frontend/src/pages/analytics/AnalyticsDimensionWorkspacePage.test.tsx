import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import type { AnalyticsAxisDetail } from '../../services/analytics';

const navigateMock = vi.hoisted(() => vi.fn());
const axesState = vi.hoisted(() => ({ list: [] as unknown[] }));
const levels = vi.hoisted(() => ({ value: 'admin' as 'reader' | 'member' | 'admin' }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (key === 'master-data:analytics.analyticsCategoryFallback' || key === 'analytics.analyticsCategoryFallback') return 'Analytics dimension';
      return opts && 'code' in opts ? `${key}:${opts.code}` : key;
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
  getAnalyticsAxis: vi.fn(),
  createAnalyticsAxis: vi.fn(),
  updateAnalyticsAxis: vi.fn(),
  deleteAnalyticsAxis: vi.fn(),
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

import * as service from '../../services/analytics';
import AnalyticsDimensionWorkspacePage from './AnalyticsDimensionWorkspacePage';

const mocked = service as unknown as {
  getAnalyticsAxis: ReturnType<typeof vi.fn>;
  createAnalyticsAxis: ReturnType<typeof vi.fn>;
  updateAnalyticsAxis: ReturnType<typeof vi.fn>;
  deleteAnalyticsAxis: ReturnType<typeof vi.fn>;
};

const DEFAULT: AnalyticsAxisDetail = {
  id: 'ax-default',
  code: 'default',
  name: null,
  description: null,
  sort_order: 0,
  is_default: true,
  applies_to: null,
  status: 'enabled',
  disabled_at: null,
  value_count: 15,
  opex_count: 27,
  capex_count: 0,
};
const NATURE: AnalyticsAxisDetail = {
  ...DEFAULT,
  id: 'ax-nature',
  code: 'nature',
  name: 'Nature',
  sort_order: 1,
  is_default: false,
  value_count: 3,
  opex_count: 2,
  capex_count: 2,
};

const usageSelect = () => screen.getByRole('combobox', { name: 'shared.lineTypeUsage.label' });

async function pickUsage(label: string) {
  fireEvent.mouseDown(usageSelect());
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: label }));
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <Link to="/master-data/analytics/dimensions/ax-default/overview">go to the default</Link>
          <Routes>
            <Route path="/master-data/analytics/dimensions/:id/:tab" element={<AnalyticsDimensionWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('AnalyticsDimensionWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    levels.value = 'admin';
    axesState.list = [DEFAULT, NATURE];
    mocked.getAnalyticsAxis.mockImplementation(async (id: string) => (id === 'ax-default' ? DEFAULT : NATURE));
    mocked.updateAnalyticsAxis.mockImplementation(async (id: string, patch: Partial<AnalyticsAxisDetail>) => ({
      ...(id === 'ax-default' ? DEFAULT : NATURE),
      ...patch,
    }));
  });

  it('saves name, code, order and description when each field loses focus, with no save button', async () => {
    renderAt('/master-data/analytics/dimensions/ax-nature/overview');
    const code = await screen.findByLabelText('analytics.fields.code');
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    fireEvent.change(code, { target: { value: 'kind' } });
    expect(mocked.updateAnalyticsAxis).not.toHaveBeenCalled();
    fireEvent.blur(code);
    await waitFor(() => expect(mocked.updateAnalyticsAxis).toHaveBeenCalledWith('ax-nature', { code: 'kind' }));

    const order = screen.getByLabelText('analytics.fields.order');
    fireEvent.change(order, { target: { value: '3' } });
    fireEvent.blur(order);
    await waitFor(() => expect(mocked.updateAnalyticsAxis).toHaveBeenCalledWith('ax-nature', { sort_order: 3 }));

    const name = screen.getByLabelText('analytics.fields.name');
    fireEvent.change(name, { target: { value: ' Kind of cost ' } });
    fireEvent.blur(name);
    await waitFor(() => expect(mocked.updateAnalyticsAxis).toHaveBeenCalledWith('ax-nature', { name: 'Kind of cost' }));

    const description = screen.getByLabelText('analytics.fields.description');
    fireEvent.change(description, { target: { value: 'What the money buys' } });
    fireEvent.blur(description);
    await waitFor(() => expect(mocked.updateAnalyticsAxis).toHaveBeenCalledWith('ax-nature', { description: 'What the money buys' }));
  });

  it('refuses a malformed code or order under its field without saving', async () => {
    renderAt('/master-data/analytics/dimensions/ax-nature/overview');
    const code = await screen.findByLabelText('analytics.fields.code');
    fireEvent.change(code, { target: { value: 'Kind of cost' } });
    fireEvent.blur(code);
    const message = await screen.findByText('analytics.messages.codeInvalid');
    expect(code.closest('.MuiFormControl-root')).toContainElement(message);
    const order = screen.getByLabelText('analytics.fields.order');
    fireEvent.change(order, { target: { value: '1.5' } });
    fireEvent.blur(order);
    expect(await screen.findByText('analytics.messages.orderInvalid')).toBeInTheDocument();
    expect(mocked.updateAnalyticsAxis).not.toHaveBeenCalled();
  });

  it('keeps a name on the other dimensions: clearing it restores the stored one', async () => {
    renderAt('/master-data/analytics/dimensions/ax-nature/overview');
    const name = await screen.findByLabelText('analytics.fields.name');
    fireEvent.change(name, { target: { value: '  ' } });
    fireEvent.blur(name);
    await waitFor(() => expect(name).toHaveValue('Nature'));
    expect(mocked.updateAnalyticsAxis).not.toHaveBeenCalled();
  });

  it('shows the default dimension by its translated label, and clearing its name stores none', async () => {
    mocked.getAnalyticsAxis.mockResolvedValue({ ...DEFAULT, name: 'Catégorie analytique' });
    renderAt('/master-data/analytics/dimensions/ax-default/overview');
    const name = await screen.findByLabelText('analytics.fields.name');
    expect(screen.getByText('analytics.hints.codeDefault:default')).toBeInTheDocument();
    fireEvent.change(name, { target: { value: '' } });
    fireEvent.blur(name);
    await waitFor(() => expect(mocked.updateAnalyticsAxis).toHaveBeenCalledWith('ax-default', { name: null }));
  });

  it('locks the lifecycle of the default dimension with its line, shown once, and offers no Delete', async () => {
    renderAt('/master-data/analytics/dimensions/ax-default/overview');
    await screen.findByLabelText('analytics.fields.code');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Analytics dimension');
    const drawer = screen.getByRole('complementary');
    expect(within(drawer).getByRole('checkbox', { name: 'statuses.enabled' })).toBeDisabled();
    expect(within(drawer).getByTestId('analytics-dimension-locked')).toHaveTextContent('analytics.hints.defaultLocked');
    expect(screen.getAllByText('analytics.hints.defaultLocked')).toHaveLength(1);
    expect(screen.getByTestId('analytics-dimension-usage')).toHaveTextContent('analytics.usage.dimensionOne');
    expect(screen.queryByTestId('analytics-dimension-delete-block')).toBeNull();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
  });

  it('keeps what the user types while an earlier save of the same field lands', async () => {
    let finishCode: (value: AnalyticsAxisDetail) => void = () => undefined;
    let finishDescription: (value: AnalyticsAxisDetail) => void = () => undefined;
    mocked.updateAnalyticsAxis
      .mockImplementationOnce(() => new Promise((resolve) => { finishCode = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { finishDescription = resolve; }));
    renderAt('/master-data/analytics/dimensions/ax-nature/overview');
    const code = await screen.findByLabelText('analytics.fields.code');
    fireEvent.focus(code);
    fireEvent.change(code, { target: { value: 'kind' } });
    fireEvent.blur(code);
    await waitFor(() => expect(mocked.updateAnalyticsAxis).toHaveBeenCalledWith('ax-nature', { code: 'kind' }));
    fireEvent.focus(code);
    fireEvent.change(code, { target: { value: 'kind-of' } });
    finishCode({ ...NATURE, code: 'kind' });
    await waitFor(() => expect(screen.getByText('analytics.hints.code:kind')).toBeInTheDocument());
    expect(code).toHaveValue('kind-of');

    const description = screen.getByLabelText('analytics.fields.description');
    fireEvent.focus(description);
    fireEvent.change(description, { target: { value: 'What the money' } });
    fireEvent.blur(description);
    await waitFor(() => expect(mocked.updateAnalyticsAxis).toHaveBeenCalledTimes(2));
    fireEvent.focus(description);
    fireEvent.change(description, { target: { value: 'What the money buys' } });
    finishDescription({ ...NATURE, code: 'kind', description: 'What the money' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(description).toHaveValue('What the money buys');
    // Leaving the field saves what it holds.
    fireEvent.blur(description);
    await waitFor(() => expect(mocked.updateAnalyticsAxis).toHaveBeenLastCalledWith('ax-nature', { description: 'What the money buys' }));
  });

  it('drops a late delete refusal once the user has moved to another dimension', async () => {
    let failDelete: (reason: unknown) => void = () => undefined;
    mocked.getAnalyticsAxis.mockImplementation(async (id: string) => (
      id === 'ax-default' ? DEFAULT : { ...NATURE, value_count: 0, opex_count: 0, capex_count: 0 }
    ));
    mocked.deleteAnalyticsAxis.mockImplementationOnce(() => new Promise((_resolve, reject) => { failDelete = reject; }));
    renderAt('/master-data/analytics/dimensions/ax-nature/overview');
    await screen.findByLabelText('analytics.fields.code');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.deleteAnalyticsAxis).toHaveBeenCalledWith('ax-nature'));
    fireEvent.click(screen.getByRole('link', { name: 'go to the default' }));
    await waitFor(() => expect(screen.getByTestId('analytics-dimension-locked')).toBeInTheDocument());
    failDelete({ response: { status: 409, data: { message: 'Nature still has values. Delete them first.' } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Nature still has values. Delete them first.')).toBeNull();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('disables Delete while the dimension has values, and deletes an empty one', async () => {
    const { unmount } = renderAt('/master-data/analytics/dimensions/ax-nature/overview');
    expect(await screen.findByTestId('analytics-dimension-delete-block')).toHaveTextContent('analytics.deleteBlocked.dimensionHasValues');
    expect(screen.getByRole('button', { name: 'common:buttons.delete' })).toBeDisabled();
    expect(within(screen.getByRole('complementary')).getByRole('checkbox', { name: 'statuses.enabled' })).toBeEnabled();
    unmount();

    mocked.getAnalyticsAxis.mockResolvedValue({ ...NATURE, value_count: 0, opex_count: 0, capex_count: 0 });
    mocked.deleteAnalyticsAxis.mockResolvedValue(undefined);
    renderAt('/master-data/analytics/dimensions/ax-nature/overview');
    expect(await screen.findByTestId('analytics-dimension-usage')).toHaveTextContent('analytics.usage.noValues');
    expect(screen.queryByTestId('analytics-dimension-delete-block')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.deleteAnalyticsAxis).toHaveBeenCalledWith('ax-nature'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/analytics'));
  });

  it('offers no Delete to members, and no editing to readers', async () => {
    levels.value = 'member';
    const { unmount } = renderAt('/master-data/analytics/dimensions/ax-nature/overview');
    expect(await screen.findByLabelText('analytics.fields.code')).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    unmount();
    levels.value = 'reader';
    renderAt('/master-data/analytics/dimensions/ax-nature/overview');
    expect(await screen.findByLabelText('analytics.fields.code')).toBeDisabled();
  });

  it('walks the dimensions in their order and goes back to the page on this dimension', async () => {
    renderAt('/master-data/analytics/dimensions/ax-nature/overview');
    await screen.findByLabelText('analytics.fields.code');
    fireEvent.click(screen.getByRole('button', { name: 'analytics.previousDimension' }));
    expect(navigateMock).toHaveBeenCalledWith('/master-data/analytics/dimensions/ax-default/overview');
    expect(screen.getByRole('button', { name: 'analytics.nextDimension' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'analytics.title' }));
    expect(navigateMock).toHaveBeenLastCalledWith('/master-data/analytics?axis=ax-nature');
  });

  it('creates with an explicit button, the code proposed from the name and the dimension placed last', async () => {
    mocked.createAnalyticsAxis.mockResolvedValue({ ...NATURE, id: 'ax-new' });
    renderAt('/master-data/analytics/dimensions/new/overview');
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.change(screen.getByLabelText('analytics.fields.name'), { target: { value: 'Nature de coût' } });
    expect(screen.getByLabelText('analytics.fields.code')).toHaveValue('nature-de-cout');
    expect(screen.getByLabelText('analytics.fields.order')).toHaveValue('2');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.createAnalyticsAxis).toHaveBeenCalledWith({
      code: 'nature-de-cout',
      name: 'Nature de coût',
      description: null,
      sort_order: 2,
      applies_to: null,
    }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/analytics/dimensions/ax-new/overview'));
  });

  it('creates a dimension for one type of line', async () => {
    mocked.createAnalyticsAxis.mockResolvedValue({ ...NATURE, id: 'ax-new', applies_to: 'capex' });
    renderAt('/master-data/analytics/dimensions/new/overview');
    fireEvent.change(screen.getByLabelText('analytics.fields.name'), { target: { value: 'Investment type' } });
    expect(usageSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.both');
    await pickUsage('master-data:shared.lineTypeUsage.capex');
    expect(usageSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.capex');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.createAnalyticsAxis).toHaveBeenCalledWith(expect.objectContaining({
      code: 'investment-type',
      applies_to: 'capex',
    })));
  });

  it('saves what the dimension is used for at once, and says which lines keep a hidden value', async () => {
    renderAt('/master-data/analytics/dimensions/ax-nature/overview');
    await screen.findByLabelText('analytics.fields.code');
    expect(usageSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.both');
    expect(screen.queryByTestId('analytics-dimension-applies-to-conflict')).toBeNull();

    await pickUsage('master-data:shared.lineTypeUsage.opex');
    await waitFor(() => expect(mocked.updateAnalyticsAxis).toHaveBeenCalledWith('ax-nature', { applies_to: 'opex' }));
    // The 2 CAPEX lines keep their value, hidden.
    expect(await screen.findByTestId('analytics-dimension-applies-to-conflict')).toHaveTextContent('analytics.appliesToConflict.capex');
    expect(usageSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.opex');

    await pickUsage('master-data:shared.lineTypeUsage.capex');
    await waitFor(() => expect(mocked.updateAnalyticsAxis).toHaveBeenLastCalledWith('ax-nature', { applies_to: 'capex' }));
    await waitFor(() => expect(screen.getByTestId('analytics-dimension-applies-to-conflict')).toHaveTextContent('analytics.appliesToConflict.opex'));

    // Both types again: null clears it, and no line hides a value.
    await pickUsage('master-data:shared.lineTypeUsage.both');
    await waitFor(() => expect(mocked.updateAnalyticsAxis).toHaveBeenLastCalledWith('ax-nature', { applies_to: null }));
    await waitFor(() => expect(screen.queryByTestId('analytics-dimension-applies-to-conflict')).toBeNull());
  });

  it('says nothing when no line of the other type has a value', async () => {
    mocked.getAnalyticsAxis.mockResolvedValue({ ...NATURE, applies_to: 'opex', opex_count: 5, capex_count: 0 });
    renderAt('/master-data/analytics/dimensions/ax-nature/overview');
    await screen.findByLabelText('analytics.fields.code');
    expect(usageSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.opex');
    expect(screen.queryByTestId('analytics-dimension-applies-to-conflict')).toBeNull();
  });

  it('shows a refusal of the choice under the field', async () => {
    mocked.updateAnalyticsAxis.mockRejectedValueOnce({
      response: { status: 400, data: { message: 'The default dimension applies to OPEX and CAPEX lines.', field: 'applies_to' } },
    });
    renderAt('/master-data/analytics/dimensions/ax-nature/overview');
    await screen.findByLabelText('analytics.fields.code');
    await pickUsage('master-data:shared.lineTypeUsage.opex');
    expect(await screen.findByRole('alert')).toHaveTextContent('The default dimension applies to OPEX and CAPEX lines.');
    expect(usageSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.both');
  });

  it('keeps the default dimension on both types, with its reason', async () => {
    renderAt('/master-data/analytics/dimensions/ax-default/overview');
    await screen.findByLabelText('analytics.fields.code');
    const drawer = screen.getByRole('complementary');
    expect(usageSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.both');
    expect(usageSelect()).toHaveAttribute('aria-disabled', 'true');
    expect(within(drawer).getByText('analytics.hints.appliesToDefault')).toBeInTheDocument();
  });

  it('keeps a code the user typed, and places a create refusal under its field', async () => {
    mocked.createAnalyticsAxis.mockRejectedValueOnce({
      response: { data: { message: 'A dimension with code nature already exists.', field: 'code' } },
    });
    renderAt('/master-data/analytics/dimensions/new/overview');
    const code = screen.getByLabelText('analytics.fields.code');
    fireEvent.change(code, { target: { value: 'nature' } });
    fireEvent.change(screen.getByLabelText('analytics.fields.name'), { target: { value: 'Cost nature' } });
    expect(code).toHaveValue('nature');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    const message = await screen.findByText('A dimension with code nature already exists.');
    expect(code.closest('.MuiFormControl-root')).toContainElement(message);
  });

  it('refuses to create without a name', async () => {
    renderAt('/master-data/analytics/dimensions/new/overview');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('analytics.messages.nameRequired')).toBeInTheDocument();
    expect(await screen.findByText('analytics.messages.codeRequired')).toBeInTheDocument();
    expect(mocked.createAnalyticsAxis).not.toHaveBeenCalled();
  });
});
