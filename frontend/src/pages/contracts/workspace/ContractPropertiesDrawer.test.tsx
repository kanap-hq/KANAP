import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  };
});
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' }, dataAccess: { mode: 'all', nodes: [] } }),
}));
vi.mock('../../../api', () => ({ default: { get: apiGet } }));
vi.mock('../../../components/fields/SupplierSelect', () => ({ default: () => null }));
vi.mock('../../../components/fields/CompanySelect', () => ({ default: () => null }));
vi.mock('../../../components/fields/CostCenterSelect', () => ({ default: () => null }));
vi.mock('../../../components/fields/DateEUField', () => ({ default: () => null }));
vi.mock('../../../components/fields/StatusLifecycleField', () => ({ default: () => null }));
vi.mock('./ContractFields', () => ({ BillingField: () => null, CurrencyField: () => null, NumberField: () => null, RenewalField: () => null }));
vi.mock('../../../hooks/useCostCenterTree', () => ({ useCostCenterNode: () => null }));
vi.mock('../../../hooks/usePlacementOptions', () => ({ useContractPlacementFilter: () => null }));

import ContractPropertiesDrawer, { type ContractFormValues } from './ContractPropertiesDrawer';

const VALUES: ContractFormValues = {
  supplier_id: 'supplier-1',
  company_id: 'company-1',
  cost_center_id: '',
  owner_user_id: 'user-7',
  start_date: '2026-01-01',
  duration_months: 12,
  notice_period_months: 3,
  auto_renewal: false,
  yearly_amount_at_signature: 1000,
  currency: 'EUR',
  billing_frequency: 'annual' as ContractFormValues['billing_frequency'],
  status: 'enabled',
  disabled_at: null,
  created_at: null,
  updated_at: null,
};

function renderDrawer(props: { disabled?: boolean; onPatch?: (patch: unknown) => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <ContractPropertiesDrawer
          values={VALUES}
          names={{ supplier: null, company: null, owner: 'Luca Ferrari' }}
          disabled={props.disabled ?? false}
          onPatch={props.onPatch ?? vi.fn()}
          onTyped={vi.fn()}
          onCommit={vi.fn()}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('ContractPropertiesDrawer owner', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (_url: string, config?: { params?: { ids?: string } }) => (
      config?.params?.ids
        ? { data: { items: [] } }
        : { data: { items: [{ id: 'user-2', first_name: 'Marco', last_name: 'Rossi' }], hasMore: false } }
    ));
  });

  it('shows the owner as a field with the current name, and saves the person picked', async () => {
    const onPatch = vi.fn();
    renderDrawer({ onPatch });
    const field = screen.getByRole('combobox', { name: 'contracts.fields.owner' });
    expect(field).toHaveValue('Luca Ferrari');
    fireEvent.mouseDown(field);
    fireEvent.click(await screen.findByRole('option', { name: 'Marco Rossi' }));
    expect(onPatch).toHaveBeenCalledWith({ owner_user_id: 'user-2' });
  });

  it('shows the name in a disabled field to a reader', () => {
    renderDrawer({ disabled: true });
    const field = screen.getByRole('combobox', { name: 'contracts.fields.owner' });
    expect(field).toHaveValue('Luca Ferrari');
    expect(field).toBeDisabled();
  });
});
