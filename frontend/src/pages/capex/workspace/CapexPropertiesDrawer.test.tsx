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
vi.mock('../../../components/fields/StatusLifecycleField', () => ({ default: () => null }));
vi.mock('../../../components/fields/CostCenterSelect', () => ({
  default: (p: { value: string | null; selectable?: string; onChange: (v: string | null) => void }) => (
    <div data-testid="cost-center-select" data-selectable={p.selectable}>
      {p.value ?? ''}
      <button type="button" onClick={() => p.onChange('cc-2')}>pick cost center</button>
    </div>
  ),
}));
// Two cost centers, one per company.
vi.mock('../../../hooks/useCostCenterTree', () => {
  const node = (id: string, company_id: string, company_name: string) => ({
    id, code: id.toUpperCase(), name: id, kind: 'cost_center', parent_id: null, company_id, company_name,
    owner_user_id: null, owner_name: null, status: 'enabled', disabled_at: null, sort_order: 0, depth: 0, path: id, path_ids: [id],
  });
  const nodes = [node('cc-1', 'company-1', 'First company'), node('cc-2', 'company-2', 'Second company')];
  const tree = {
    ready: true, nodes, byId: new Map(nodes.map((n) => [n.id, n])), hasAny: true,
    descendantIds: (id: string) => new Set([id]),
  };
  return { useCostCenterTree: () => tree };
});
vi.mock('../../../components/fields/AnalyticsCategorySelect', () => ({
  default: ({ value }: { value: string | null }) => <div data-testid="analytics-select">{value ?? ''}</div>,
}));

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
        analyticsCategoryId="category-1"
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
        onAnalyticsCategoryChange={noop}
        onCostCenterChange={noop}
        onRunBuildChange={noop}
        onEffectiveStartChange={noop}
        onDisabledAtChange={noop}
        onStatusChange={noop}
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

  it.each(['create', 'edit'] as const)('offers the analytics category in %s mode', (mode) => {
    renderDrawer(mode);
    expect(screen.getByText('capex.fields.analyticsCategory')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-select')).toHaveTextContent('category-1');
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
    expect(onCostCenterChange).toHaveBeenCalledWith('cc-2');
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
