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
vi.mock('../../../hooks/useCurrencySettings', () => ({ default: () => ({ data: null }) }));
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
vi.mock('../../../components/fields/AnalyticsCategorySelect', () => ({ default: () => null }));
vi.mock('../../../components/fields/UserSelect', () => ({ default: () => null }));
vi.mock('../../../components/fields/CostCenterSelect', () => ({
  default: (p: { value: string | null; selectable?: string; onChange: (v: string | null) => void }) => (
    <div data-testid="cost-center-select" data-selectable={p.selectable}>
      {p.value ?? ''}
      <button type="button" onClick={() => p.onChange('cc-2')}>pick cost center</button>
      <button type="button" onClick={() => p.onChange(null)}>clear cost center</button>
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

import SpendPropertiesDrawer from './SpendPropertiesDrawer';

const noop = () => undefined;

function renderDrawer(props: Partial<React.ComponentProps<typeof SpendPropertiesDrawer>>) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <SpendPropertiesDrawer
        supplierId=""
        payingCompanyId=""
        accountId=""
        currency="EUR"
        analyticsCategoryId=""
        costCenterId=""
        runBuild=""
        effectiveStart="2026-01-01"
        onSupplierChange={noop}
        onPayingCompanyChange={noop}
        onAccountChange={noop}
        onCurrencyChange={noop}
        onAnalyticsCategoryChange={noop}
        onCostCenterChange={noop}
        onRunBuildChange={noop}
        onEffectiveStartChange={noop}
        {...props}
      />
    </ThemeProvider>,
  );
}

describe('SpendPropertiesDrawer required pickers', () => {
  it('leaves the supplier optional and lets company and account be cleared only on create', () => {
    const { unmount } = renderDrawer({ mode: 'create' });
    expect(screen.getByTestId('supplier-select')).toHaveAttribute('data-required', 'false');
    expect(screen.getByTestId('account-select')).toHaveAttribute('data-required', 'true');
    expect(screen.getByTestId('company-select')).toHaveAttribute('data-clearable', 'true');
    expect(screen.getByTestId('account-select')).toHaveAttribute('data-clearable', 'true');
    unmount();

    renderDrawer({ mode: 'edit' });
    expect(screen.getByTestId('company-select')).toHaveAttribute('data-clearable', 'false');
    expect(screen.getByTestId('account-select')).toHaveAttribute('data-clearable', 'false');
  });
});

describe('SpendPropertiesDrawer end of validity', () => {
  it('offers one optional end date on create, as the local end of that day', () => {
    const onDisabledAtChange = vi.fn();
    renderDrawer({ mode: 'create', disabledAt: null, onDisabledAtChange });

    expect(screen.getByText('opex.fields.endOfValidity')).toBeTruthy();
    expect(screen.getByText('opex.fields.endOfValidityHint')).toBeTruthy();
    expect(screen.queryByText('opex.fields.effectiveEnd')).toBeNull();

    // Two date fields in the dates group: effective start, then end of validity.
    // The date placeholder is translated; the mocked `t` returns its key.
    const inputs = screen.getAllByPlaceholderText('labels.datePlaceholder');
    expect(inputs).toHaveLength(2);
    fireEvent.focus(inputs[1]);
    fireEvent.change(inputs[1], { target: { value: '31/12/2027' } });

    expect(onDisabledAtChange).toHaveBeenLastCalledWith(new Date(2027, 11, 31, 23, 59, 0, 0).toISOString());
  });

  it('keeps the end of validity inside the lifecycle group when editing', () => {
    renderDrawer({ mode: 'edit', disabledAt: null, onDisabledAtChange: noop, onStatusChange: noop });

    expect(screen.getAllByText('opex.fields.endOfValidity')).toHaveLength(1);
    expect(screen.queryByText('opex.fields.effectiveEnd')).toBeNull();
  });
});

describe('SpendPropertiesDrawer cost center and run or build', () => {
  it.each(['create', 'edit'] as const)('shows both rows in %s mode, the cost center picking cost centers only', (mode) => {
    renderDrawer({ mode, costCenterId: 'cc-1', payingCompanyId: 'company-1' });
    expect(screen.getByText('opex.fields.costCenter')).toBeInTheDocument();
    expect(screen.getByText('opex.fields.runBuild')).toBeInTheDocument();
    expect(screen.getByTestId('cost-center-select')).toHaveAttribute('data-selectable', 'cost_centers');
    expect(screen.getByTestId('cost-center-select')).toHaveTextContent('cc-1');
  });

  it('reports a picked cost center, and a cleared one as empty', () => {
    const onCostCenterChange = vi.fn();
    renderDrawer({ mode: 'edit', onCostCenterChange });
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    fireEvent.click(screen.getByRole('button', { name: 'clear cost center' }));
    expect(onCostCenterChange.mock.calls).toEqual([['cc-2'], ['']]);
  });

  it('says whose cost center it is when the paying company differs, and only then', () => {
    const { unmount } = renderDrawer({ mode: 'edit', costCenterId: 'cc-1', payingCompanyId: 'company-2' });
    expect(screen.getByText('opex.fields.costCenterCompanyHint')).toBeInTheDocument();
    unmount();

    renderDrawer({ mode: 'edit', costCenterId: 'cc-1', payingCompanyId: 'company-1' });
    expect(screen.queryByText('opex.fields.costCenterCompanyHint')).toBeNull();
  });

  it('offers run, build and nothing', () => {
    const onRunBuildChange = vi.fn();
    const { unmount } = renderDrawer({ mode: 'edit', runBuild: '', onRunBuildChange });
    // The select is named after its row.
    expect(screen.getByRole('combobox', { name: 'opex.fields.runBuild' })).toHaveTextContent('common:selects.notSet');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'opex.fields.runBuild' }));
    const listbox = within(screen.getByRole('listbox'));
    expect(listbox.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'common:selects.notSet', 'opex.runBuild.run', 'opex.runBuild.build',
    ]);
    fireEvent.click(listbox.getByText('opex.runBuild.build'));
    expect(onRunBuildChange).toHaveBeenLastCalledWith('build');
    unmount();

    renderDrawer({ mode: 'edit', runBuild: 'run', onRunBuildChange });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'opex.fields.runBuild' }));
    fireEvent.click(within(screen.getByRole('listbox')).getByText('common:selects.notSet'));
    expect(onRunBuildChange).toHaveBeenLastCalledWith('');
  });
});
