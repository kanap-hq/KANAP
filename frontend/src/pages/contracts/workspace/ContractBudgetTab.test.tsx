import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import ContractBudgetTab from './ContractBudgetTab';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => (opts?.count != null ? `${key}(count=${opts.count})` : key),
  i18n: { language: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => {} } }));
const auth = { readsBudget: true };
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string) => (resource === 'budget' ? auth.readsBudget : true), profile: { id: 'user-1' } }),
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../contractBudget', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../contractBudget')>()),
  useContractBudgetChoice: () => ({ year: 2026, setYear: vi.fn(), column: 'planned', setColumn: vi.fn(), columnLabel: 'Budget', columns: [] }),
}));
vi.mock('../../../components/finance/BudgetLinesRelationField', () => ({
  default: () => <div data-testid="lines-picker" />,
}));

const mocked = api as unknown as { get: ReturnType<typeof vi.fn> };

function renderTab(body: { items: unknown[]; hidden?: number }) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/contracts/c-1/budget-lines') return { data: body };
    // The coverage: never answered here, the list is under test.
    return new Promise(() => {});
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <ContractBudgetTab contractId="c-1" readOnly={false} onChanged={vi.fn()} />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const LINE = { id: 'l-1', nature: 'opex', item_number: 12, product_name: 'Licences', company_id: null, company_name: null };

describe('ContractBudgetTab, data access', () => {
  beforeEach(() => {
    auth.readsBudget = true;
    mocked.get.mockReset();
  });

  it('lists the visible lines, then counts those outside the access', async () => {
    renderTab({ items: [LINE], hidden: 2 });
    expect(await screen.findByText('Licences')).toBeTruthy();
    expect(screen.getByText('it:workspace.application.relations.outside.and(count=2)')).toBeTruthy();
    expect(screen.getByTestId('lines-picker')).toBeTruthy();
  });

  it('says only the count when no linked line is visible', async () => {
    renderTab({ items: [], hidden: 1 });
    expect(await screen.findByText('it:workspace.application.relations.outside.only(count=1)')).toBeTruthy();
    expect(screen.queryByText('contracts.budget.empty')).toBeNull();
  });

  it('gives a person without the budget right the number of lines only, without names or picker', async () => {
    auth.readsBudget = false;
    renderTab({ items: [], hidden: 3 });
    expect(await screen.findByText('it:workspace.application.relations.outside.count(count=3)')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByTestId('lines-picker')).toBeNull();
  });

  it('keeps the empty line when nothing is linked', async () => {
    renderTab({ items: [], hidden: 0 });
    expect(await screen.findByText('contracts.budget.empty')).toBeTruthy();
  });
});
