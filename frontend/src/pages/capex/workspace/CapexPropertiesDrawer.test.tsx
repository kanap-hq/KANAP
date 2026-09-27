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
vi.mock('../../../components/fields/SupplierSelect', () => ({ default: () => null }));
vi.mock('../../../components/fields/CompanySelect', () => ({ default: () => null }));
vi.mock('../../../components/fields/AccountSelect', () => ({ default: () => null }));
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
  it.each(['create', 'edit'] as const)('offers the analytics category in %s mode', (mode) => {
    renderDrawer(mode);
    expect(screen.getByText('capex.fields.analyticsCategory')).toBeInTheDocument();
    expect(screen.getByTestId('analytics-select')).toHaveTextContent('category-1');
  });
});
