import React from 'react';
import { render, screen } from '@testing-library/react';
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
vi.mock('../../../components/fields/AnalyticsCategorySelect', () => ({
  default: ({ value }: { value: string | null }) => <div data-testid="analytics-select">{value ?? ''}</div>,
}));

import CapexPropertiesDrawer from './CapexPropertiesDrawer';

const noop = () => undefined;

function renderDrawer(mode: 'create' | 'edit') {
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
        effectiveStart="2026-01-01"
        onSupplierChange={noop}
        onPayingCompanyChange={noop}
        onAccountChange={noop}
        onCurrencyChange={noop}
        onPpeTypeChange={noop}
        onInvestmentTypeChange={noop}
        onPriorityChange={noop}
        onAnalyticsCategoryChange={noop}
        onEffectiveStartChange={noop}
        onDisabledAtChange={noop}
        onStatusChange={noop}
        onOwnerItChange={noop}
        onOwnerBusinessChange={noop}
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
