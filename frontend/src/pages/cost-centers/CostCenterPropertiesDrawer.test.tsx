import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import type { CostCenterDetail } from '../../services/costCenters';

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => {
  const t = (key: string) => key;
  return {
    initReactI18next: { type: '3rdParty', init: () => undefined },
    useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  };
});
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' }, dataAccess: { mode: 'all', nodes: [] } }),
}));
vi.mock('../../api', () => ({ default: { get: apiGet } }));
vi.mock('../../components/fields/CostCenterSelect', () => ({ default: () => null }));
vi.mock('../../components/fields/CompanySelect', () => ({ default: () => null }));

import CostCenterPropertiesDrawer from './CostCenterPropertiesDrawer';

const NODE: CostCenterDetail = {
  id: 'cc-1',
  code: 'IT-300',
  name: 'Service desk',
  kind: 'cost_center',
  parent_id: null,
  parent_code: null,
  parent_name: null,
  company_id: 'company-1',
  company_name: 'Company one',
  owner_user_id: 'user-7',
  owner_name: 'Luca Ferrari',
  status: 'enabled',
  disabled_at: null,
  sort_order: 0,
  depth: 0,
  path: 'Service desk',
  path_ids: ['cc-1'],
  description: null,
  opex_count: 0,
  capex_count: 0,
};

function renderDrawer(props: { disabled?: boolean; onOwnerChange?: (id: string | null) => void } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <CostCenterPropertiesDrawer
          node={NODE}
          kind="cost_center"
          disabled={props.disabled ?? false}
          errors={{}}
          excludeParentIds={new Set(['cc-1'])}
          onCodeCommit={vi.fn()}
          onKindChange={vi.fn()}
          onParentChange={vi.fn()}
          onCompanyChange={vi.fn()}
          onOwnerChange={props.onOwnerChange ?? vi.fn()}
          onDisabledAtChange={vi.fn()}
          onDisableNow={vi.fn()}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('CostCenterPropertiesDrawer budget holder', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (_url: string, config?: { params?: { ids?: string } }) => (
      config?.params?.ids
        ? { data: { items: [] } }
        : { data: { items: [{ id: 'user-2', first_name: 'Marco', last_name: 'Rossi' }], hasMore: false } }
    ));
  });

  it('shows the holder as a field with the current name, and saves the person picked', async () => {
    const onOwnerChange = vi.fn();
    renderDrawer({ onOwnerChange });
    const field = screen.getByRole('combobox', { name: 'costCenters.fields.owner' });
    expect(field.tagName).toBe('INPUT');
    expect(field).toHaveValue('Luca Ferrari');
    expect(field).toBeEnabled();
    fireEvent.mouseDown(field);
    fireEvent.click(await screen.findByRole('option', { name: 'Marco Rossi' }));
    expect(onOwnerChange).toHaveBeenCalledWith('user-2');
  });

  it('shows the name in a disabled field to a reader, without reading the people list', () => {
    renderDrawer({ disabled: true });
    const field = screen.getByRole('combobox', { name: 'costCenters.fields.owner' });
    expect(field).toHaveValue('Luca Ferrari');
    expect(field).toBeDisabled();
    expect(apiGet).not.toHaveBeenCalledWith('/users/lookup', expect.objectContaining({ params: expect.objectContaining({ ids: 'user-7' }) }));
  });
});
