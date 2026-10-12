import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import api from '../../api';
import BudgetTotalCell from './BudgetTotalCell';

vi.mock('../../api', () => ({ default: { get: vi.fn() } }));
vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key };
  return { useTranslation: () => translation };
});

const get = vi.mocked(api.get);
function view(children: React.ReactNode, mode: 'light' | 'dark' = 'light') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><ThemeProvider theme={createAppTheme(mode)}>{children}</ThemeProvider></QueryClientProvider>);
}
function response(opex = true, capex = false) {
  return { data: { summary: { scopes: { opex: { budget: { frozen: opex }, actual: { frozen: false } }, capex: { budget: { frozen: capex }, actual: { frozen: false } } } } } };
}

describe('BudgetTotalCell', () => {
  beforeEach(() => { get.mockReset(); get.mockResolvedValue(response()); });

  it.each(['light', 'dark'] as const)('locks only the frozen nature, leaving Total unlocked, in %s mode', async (mode) => {
    view(<>
      <BudgetTotalCell colId="yPlus1Budget" nature="opex">100</BudgetTotalCell>
      <BudgetTotalCell colId="yPlus1Budget" nature="capex">200</BudgetTotalCell>
      <BudgetTotalCell colId="yPlus1Budget">300</BudgetTotalCell>
    </>, mode);
    await waitFor(() => expect(screen.getAllByLabelText('operations.freeze.frozen')).toHaveLength(1));
    expect(screen.getByLabelText('operations.freeze.frozen').parentElement).toHaveTextContent('100');
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/freeze-states', { params: { year: new Date().getFullYear() + 1 } });
  });

  it('locks Total only when both natures are frozen', async () => {
    get.mockResolvedValue(response(true, true));
    view(<BudgetTotalCell colId="yBudget">300</BudgetTotalCell>);
    expect(await screen.findByLabelText('operations.freeze.frozen')).toBeInTheDocument();
  });

  it('maps FollowUp and FTE to the same actual freeze column', async () => {
    get.mockResolvedValue({ data: { summary: { scopes: { capex: { actual: { frozen: true } } } } } });
    view(<>
      <BudgetTotalCell colId="yMinus1FollowUp" nature="capex">100</BudgetTotalCell>
      <BudgetTotalCell colId="fte_yMinus1FollowUp" nature="capex">2.50</BudgetTotalCell>
    </>);
    await waitFor(() => expect(screen.getAllByLabelText('operations.freeze.frozen')).toHaveLength(2));
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/freeze-states', { params: { year: new Date().getFullYear() - 1 } });
  });

  it('keeps values visible without a lock when freeze state is unavailable', async () => {
    get.mockRejectedValue(new Error('offline'));
    view(<BudgetTotalCell colId="yBudget" nature="opex">100</BudgetTotalCell>);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.queryByLabelText('operations.freeze.frozen')).toBeNull();
  });
});
