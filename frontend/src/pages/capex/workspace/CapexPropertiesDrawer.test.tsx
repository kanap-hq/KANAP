import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../../hooks/useCurrencySettings', () => ({ default: () => ({ data: { allowedCurrencies: ['EUR'] } }) }));
// The pickers load their options from the API; they only report the props this file checks.
vi.mock('../../../components/fields/SupplierSelect', () => ({
  default: (p: { required?: boolean }) => <div data-testid="supplier-select" data-required={String(!!p.required)} />,
}));
vi.mock('../../../components/fields/CompanySelect', () => ({
  default: (p: { disableClearable?: boolean }) => <div data-testid="company-select" data-clearable={String(!p.disableClearable)} />,
}));
vi.mock('../../../components/fields/AccountSelect', () => ({
  default: (p: { disableClearable?: boolean; required?: boolean }) => (
    <div data-testid="account-select" data-clearable={String(!p.disableClearable)} data-required={String(!!p.required)} />
  ),
}));
vi.mock('../../../components/fields/UserSelect', () => ({ default: () => null }));
vi.mock('../../../components/fields/DateEUField', () => ({ default: () => null }));
vi.mock('../../../components/fields/CostCenterSelect', () => ({
  default: (p: {
    value: string | null;
    selectable?: string;
    selectedOption?: { code: string } | null;
    onChange: (v: string | null, node: unknown) => void;
  }) => (
    <div data-testid="cost-center-select" data-selectable={p.selectable} data-known={p.selectedOption?.code ?? ''}>
      {p.value ?? ''}
      <button type="button" onClick={() => p.onChange('cc-2', { id: 'cc-2', company_id: 'company-2' })}>pick cost center</button>
    </div>
  ),
}));
// Two cost centers, one per company. The node hook as the drawer calls it: the detail's node when it
// names the id, otherwise the tree's (each such read recorded: it would load the tree).
const treeReads = vi.hoisted(() => ({ ids: [] as string[] }));
vi.mock('../../../hooks/useCostCenterTree', () => {
  const node = (id: string, company_id: string, company_name: string) => ({
    id, code: id.toUpperCase(), name: id, kind: 'cost_center', parent_id: null, company_id, company_name,
    owner_user_id: null, owner_name: null, status: 'enabled', disabled_at: null, sort_order: 0, depth: 0, path: id, path_ids: [id],
  });
  const byId = new Map([node('cc-1', 'company-1', 'First company'), node('cc-2', 'company-2', 'Second company')].map((n) => [n.id, n]));
  return {
    useCostCenterNode: (id: string | null, known?: { id: string } | null) => {
      if (!id) return null;
      if (known?.id === id) return known;
      treeReads.ids.push(id);
      return byId.get(id) ?? null;
    },
  };
});
vi.mock('../../../components/fields/AnalyticsCategorySelect', () => ({
  default: (p: { axisId: string; label?: string; value: string | null; onChange: (v: string | null) => void }) => (
    <div data-testid={`analytics-select-${p.axisId}`} data-label={p.label}>
      {p.value ?? ''}
      <button type="button" onClick={() => p.onChange(`value-${p.axisId}`)}>{`pick ${p.axisId}`}</button>
      <button type="button" onClick={() => p.onChange(null)}>{`clear ${p.axisId}`}</button>
    </div>
  ),
}));
// The tenant's dimensions, out of order on purpose: the hook's own core orders them and names the
// default, which has no name; one dimension is disabled. `failed` stands for a load that failed.
const dimensions = vi.hoisted(() => ({ failed: false }));
vi.mock('../../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../hooks/useAnalyticsAxes')>();
  const t = ((key: string) => key) as unknown as Parameters<typeof mod.buildAnalyticsAxes>[1];
  const dimension = (id: string, name: string | null, sort_order: number, extra: Record<string, unknown> = {}) => ({
    id, code: id, name, description: null, sort_order, is_default: false, status: 'enabled', disabled_at: null, ...extra,
  });
  const list = [
    dimension('activity', 'Activity', 3),
    dimension('old', 'Old', 2, { status: 'disabled', disabled_at: '2020-01-01T00:00:00.000Z' }),
    dimension('nature', 'Nature', 1),
    dimension('default', null, 0, { is_default: true }),
  ];
  return {
    ...mod,
    useAnalyticsAxes: () => (dimensions.failed ? mod.buildAnalyticsAxes([], t, true, true) : mod.buildAnalyticsAxes(list as never, t)),
  };
});

import CapexPropertiesDrawer from './CapexPropertiesDrawer';

const noop = () => undefined;

type DrawerProps = React.ComponentProps<typeof CapexPropertiesDrawer>;

function renderDrawer(mode: 'create' | 'edit', props: Partial<DrawerProps> = {}) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <CapexPropertiesDrawer
        mode={mode}
        supplierId=""
        payingCompanyId=""
        accountId=""
        currency="EUR"
        ppeType="hardware"
        investmentType="replacement"
        priority="medium"
        analyticsValues={{ default: 'category-1', old: 'category-9' }}
        costCenterId=""
        runBuild=""
        effectiveStart="2026-01-01"
        onSupplierChange={noop}
        onPayingCompanyChange={noop}
        onAccountChange={noop}
        onCurrencyChange={noop}
        onPpeTypeChange={noop}
        onInvestmentTypeChange={noop}
        onPriorityChange={noop}
        onAnalyticsValueChange={noop}
        onCostCenterChange={noop}
        onRunBuildChange={noop}
        onEffectiveStartChange={noop}
        onDisabledAtChange={noop}
        onOwnerItChange={noop}
        onOwnerBusinessChange={noop}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe('CapexPropertiesDrawer', () => {
  it('requires the account, leaves the supplier optional, and keeps required pickers set when editing', () => {
    const { unmount } = renderDrawer('create');
    expect(screen.getByTestId('supplier-select')).toHaveAttribute('data-required', 'false');
    expect(screen.getByTestId('account-select')).toHaveAttribute('data-required', 'true');
    expect(screen.getByTestId('company-select')).toHaveAttribute('data-clearable', 'true');
    unmount();

    renderDrawer('edit');
    expect(screen.getByTestId('company-select')).toHaveAttribute('data-clearable', 'false');
    expect(screen.getByTestId('account-select')).toHaveAttribute('data-clearable', 'false');
  });

  it.each(['create', 'edit'] as const)('offers one select per enabled dimension in %s mode, in dimension order, named after it', (mode) => {
    renderDrawer(mode);
    const selects = screen.getAllByTestId(/^analytics-select-/);
    expect(selects.map((el) => el.getAttribute('data-testid'))).toEqual([
      'analytics-select-default', 'analytics-select-nature', 'analytics-select-activity',
    ]);
    // The default dimension has no name yet: the translated default label names it.
    expect(selects.map((el) => el.getAttribute('data-label'))).toEqual([
      'master-data:analytics.analyticsCategoryFallback', 'Nature', 'Activity',
    ]);
    expect(screen.getByText('master-data:analytics.analyticsCategoryFallback')).toBeInTheDocument();
    expect(screen.queryByText('Old')).toBeNull();
    expect(screen.getByTestId('analytics-select-default')).toHaveTextContent('category-1');
  });

  it.each(['create', 'edit'] as const)('says so in one line when the dimensions cannot be loaded (%s)', (mode) => {
    dimensions.failed = true;
    try {
      renderDrawer(mode);
      expect(screen.getByText('shared.dimensionsLoadFailed')).toBeInTheDocument();
      expect(screen.queryAllByTestId(/^analytics-select-/)).toHaveLength(0);
      expect(screen.getByText('capex.fields.runBuild')).toBeInTheDocument();
    } finally {
      dimensions.failed = false;
    }
  });

  it('names each currency with its code and name, without a dash', () => {
    renderDrawer('edit', { currency: 'EUR' });
    expect(screen.getByDisplayValue(/^EUR · /)).toBeInTheDocument();
    expect(screen.queryByText('shared.dimensionsLoadFailed')).toBeNull();
  });

  it('reports a picked value and a cleared one with their dimension', () => {
    const onAnalyticsValueChange = vi.fn();
    renderDrawer('edit', { onAnalyticsValueChange });
    fireEvent.click(screen.getByRole('button', { name: 'pick nature' }));
    fireEvent.click(screen.getByRole('button', { name: 'clear default' }));
    expect(onAnalyticsValueChange.mock.calls).toEqual([['nature', 'value-nature'], ['default', null]]);
  });
});

describe('CapexPropertiesDrawer cost center and run or build', () => {
  it.each(['create', 'edit'] as const)('shows both rows in %s mode, the cost center picking cost centers only', (mode) => {
    renderDrawer(mode, { costCenterId: 'cc-1', payingCompanyId: 'company-1' });
    expect(screen.getByText('capex.fields.costCenter')).toBeInTheDocument();
    expect(screen.getByText('capex.fields.runBuild')).toBeInTheDocument();
    expect(screen.getByTestId('cost-center-select')).toHaveAttribute('data-selectable', 'cost_centers');
    expect(screen.getByTestId('cost-center-select')).toHaveTextContent('cc-1');
  });

  it('reports a picked cost center', () => {
    const onCostCenterChange = vi.fn();
    renderDrawer('edit', { onCostCenterChange });
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    expect(onCostCenterChange).toHaveBeenCalledWith('cc-2', { id: 'cc-2', company_id: 'company-2' });
  });

  it("reads the line's cost center from the detail: label and company without the tree", () => {
    treeReads.ids = [];
    const detail = {
      id: 'cc-9', code: 'CC-9', name: 'From the detail', kind: 'cost_center' as const, status: 'enabled' as const,
      company_id: 'company-9', company_name: 'Detail company', owner_user_id: null, owner_name: null,
    };
    renderDrawer('edit', { costCenterId: 'cc-9', payingCompanyId: 'company-1', references: { cost_center: detail } });
    expect(screen.getByTestId('cost-center-select')).toHaveAttribute('data-known', 'CC-9');
    expect(screen.getByText('capex.fields.costCenterCompanyHint')).toBeInTheDocument();
    expect(treeReads.ids).toEqual([]);
  });

  it('says whose cost center it is when the paying company differs, and only then', () => {
    const { unmount } = renderDrawer('create', { costCenterId: 'cc-1', payingCompanyId: 'company-2' });
    expect(screen.getByText('capex.fields.costCenterCompanyHint')).toBeInTheDocument();
    unmount();

    renderDrawer('create', { costCenterId: 'cc-1', payingCompanyId: 'company-1' });
    expect(screen.queryByText('capex.fields.costCenterCompanyHint')).toBeNull();
  });

  it('offers run, build and nothing', () => {
    const onRunBuildChange = vi.fn();
    renderDrawer('edit', { runBuild: 'build', onRunBuildChange });
    // The select is named after its row.
    expect(screen.getByRole('combobox', { name: 'capex.fields.runBuild' })).toHaveTextContent('capex.runBuild.build');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'capex.fields.runBuild' }));
    const listbox = within(screen.getByRole('listbox'));
    expect(listbox.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'common:selects.notSet', 'capex.runBuild.run', 'capex.runBuild.build',
    ]);
    fireEvent.click(listbox.getByText('capex.runBuild.run'));
    expect(onRunBuildChange).toHaveBeenLastCalledWith('run');
  });
});

describe('CapexPropertiesDrawer end of validity', () => {
  // Regression: the page saves the date and its derived status in one write. A second, status-only
  // write from the same pick raced it and could clear the date just picked.
  it('reports a picked end date once when editing, and no status change beside it', () => {
    const onDisabledAtChange = vi.fn();
    const onStatusChange = vi.fn();
    // A caller still wiring a status handler must not get a second write from the same pick.
    const legacy = { onStatusChange } as Partial<DrawerProps>;
    renderDrawer('edit', { status: 'enabled', disabledAt: null, onDisabledAtChange, ...legacy });

    // The calendar's native input inside the lifecycle group (the dates group has its own).
    const lifecycle = screen.getByText('capex.fields.lifecycle').parentElement as HTMLElement;
    const nativeDate = lifecycle.querySelector('input[type="date"]') as HTMLInputElement;
    fireEvent.change(nativeDate, { target: { value: '2099-12-31' } });

    expect(onDisabledAtChange.mock.calls).toEqual([[new Date(2099, 11, 31, 23, 59, 0, 0).toISOString()]]);
    expect(onStatusChange).not.toHaveBeenCalled();
  });
});
