import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('../../api', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ admin: true }));
// A budget administration reader has `budget_ops:reader`; the administrator has every level.
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: (_resource: string, level: string) => auth.admin || level === 'reader' }) }));

import api from '../../api';
import { KanapDialogProvider } from '../../components/design';
import AllocationDefaultPage from './AllocationDefaultPage';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };
const YEAR = new Date().getFullYear();

// The default split by turnover is computed in the reporting currency: the preview names each
// company's base currency next to its turnover, and names each company left out for lack of a rate.
function serve(previewWarning: unknown) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/allocation-rules/active') {
      return { data: {
        fiscal_year: YEAR, mode: 'manual_company', method: 'turnover', source: 'tenant',
        standard_mode: 'auto', standard_method: 'headcount', tenant_mode: 'manual_company', tenant_method: 'turnover',
        company_ids: ['paris', 'ny'],
        shares: [{ company_id: 'paris', allocation_pct: 66.6667 }, { company_id: 'ny', allocation_pct: 33.3333 }],
        preview_error: null,
        preview_warning: previewWarning,
      } };
    }
    if (url === '/companies') {
      return { data: { items: [
        { id: 'paris', name: 'Paris', base_currency: 'EUR', turnover_year: 70 },
        { id: 'ny', name: 'New York', base_currency: 'USD', turnover_year: 35 },
      ] } };
    }
    throw new Error(`unexpected GET ${url}`);
  });
}

async function renderPage() {
  await i18n.changeLanguage('en');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ThemeProvider theme={createAppTheme('light')}>
            <KanapDialogProvider>
              <AllocationDefaultPage />
            </KanapDialogProvider>
          </ThemeProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('AllocationDefaultPage by turnover', () => {
  beforeEach(() => { mocked.get.mockReset(); auth.admin = true; });

  it("names each company's base currency next to its turnover", async () => {
    serve(null);
    await renderPage();
    expect(await screen.findByText('35 M USD')).toBeInTheDocument();
    expect(screen.getByText('70 M EUR')).toBeInTheDocument();
    expect(screen.queryByText(/exchange rate/)).toBeNull();
  });

  it('says which company is left out when its turnover has no rate', async () => {
    serve({
      code: 'turnover_fx_missing',
      items: [{ companyId: 'ny', companyName: 'New York', currency: 'USD', year: YEAR }],
      reportingCurrency: 'EUR',
    });
    await renderPage();
    expect(await screen.findByText(
      `New York is left out of the allocation: no exchange rate from USD to EUR for ${YEAR}.`,
      { exact: false },
    )).toBeInTheDocument();
  });
});

describe('AllocationDefaultPage settings', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    mocked.delete.mockReset();
    auth.admin = true;
    serve(null);
  });

  afterEach(() => { vi.useRealTimers(); });

  const combobox = (name: string) => screen.getByRole('combobox', { name });
  /** The rule the server answers after a save of `body`. */
  const answer = (body: unknown) => ({ data: {
    fiscal_year: YEAR, mode: 'manual_company', method: 'headcount', source: 'tenant',
    standard_mode: 'auto', standard_method: 'headcount', company_ids: ['paris', 'ny'], shares: [], ...(body as object),
  } });
  const busyServer = () => Object.assign(new Error('busy'), { response: { status: 503, data: { code: 'busy' } } });

  it('names the company scope apart from the company list', async () => {
    await renderPage();
    await screen.findByText('35 M USD');
    expect(combobox('Company scope')).toHaveTextContent('Selected companies');
    expect(combobox('Companies')).toHaveTextContent('2 companies selected');
  });

  it('offers no field when the rule of the year cannot be read', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/allocation-rules/active') throw new Error('network down');
      if (url === '/companies') return { data: { items: [] } };
      throw new Error(`unexpected GET ${url}`);
    });
    await renderPage();
    expect(await screen.findByText('Could not load the default allocation method.')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Default method' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Company scope' })).not.toBeInTheDocument();
  });

  it('keeps the chosen method on screen while a busy server makes the save wait', async () => {
    let calls = 0;
    mocked.patch.mockImplementation(async (_url: string, body: unknown) => {
      calls += 1;
      if (calls === 1) throw busyServer();
      return answer(body);
    });
    await renderPage();
    await screen.findByText('35 M USD');
    fireEvent.mouseDown(combobox('Default method'));
    const option = await screen.findByRole('option', { name: 'Headcount' });
    vi.useFakeTimers();
    fireEvent.click(option);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    expect(combobox('Default method')).toHaveTextContent('Headcount');
    expect(screen.getByRole('status')).toHaveTextContent('Saving…');
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(mocked.patch).toHaveBeenCalledTimes(2);
    expect(combobox('Default method')).toHaveTextContent('Headcount');
  });

  it('shows the stored method again when the server refuses it, with the refusal under the field', async () => {
    mocked.patch.mockRejectedValue(Object.assign(new Error('Bad Request'), { response: { status: 400, data: { message: 'Refused by the server.' } } }));
    await renderPage();
    await screen.findByText('35 M USD');
    fireEvent.mouseDown(combobox('Default method'));
    fireEvent.click(await screen.findByRole('option', { name: 'Headcount' }));
    await waitFor(() => expect(combobox('Default method')).toHaveAccessibleDescription('Refused by the server.'), { timeout: 2000 });
    expect(combobox('Default method')).toHaveTextContent('Turnover');
  });

  it('keeps the year list off while a save is on its way', async () => {
    let release: (value: unknown) => void = () => undefined;
    mocked.patch.mockImplementation((_url: string, body: unknown) => new Promise((resolve) => { release = () => resolve(answer(body)); }));
    await renderPage();
    await screen.findByText('35 M USD');
    fireEvent.mouseDown(combobox('Default method'));
    fireEvent.click(await screen.findByRole('option', { name: 'Headcount' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    expect(combobox('Fiscal year')).toHaveAttribute('aria-disabled', 'true');
    await act(async () => { release(undefined); });
    await waitFor(() => expect(combobox('Fiscal year')).not.toHaveAttribute('aria-disabled', 'true'));
  });

  it('saves the method as soon as it is chosen, and says it is saved in the header', async () => {
    mocked.patch.mockImplementation(async (_url: string, body: unknown) => ({ data: {
      fiscal_year: YEAR, mode: 'manual_company', method: 'headcount', source: 'tenant',
      standard_mode: 'auto', standard_method: 'headcount', company_ids: ['paris', 'ny'], shares: [], ...(body as object),
    } }));
    await renderPage();
    await screen.findByText('35 M USD');
    fireEvent.mouseDown(combobox('Default method'));
    fireEvent.click(await screen.findByRole('option', { name: 'Headcount' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    expect(mocked.patch.mock.calls[0][1]).toEqual({ mode: 'manual_company', method: 'headcount', company_ids: ['paris', 'ny'] });
    expect(mocked.patch.mock.calls[0][2]).toEqual({ params: { year: YEAR } });
    expect(await screen.findByText('Saved')).toBeInTheDocument();
  });

  it('keeps the manual mode on screen until a company is chosen, and sends nothing', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/allocation-rules/active') return { data: { fiscal_year: YEAR, mode: 'auto', method: 'headcount', source: 'standard', standard_mode: 'auto', standard_method: 'headcount', company_ids: [], shares: [] } };
      if (url === '/companies') return { data: { items: [{ id: 'paris', name: 'Paris' }] } };
      throw new Error(`unexpected GET ${url}`);
    });
    await renderPage();
    await screen.findByText('Standard method: no override configured for this year.');
    fireEvent.mouseDown(combobox('Company scope'));
    fireEvent.click(await screen.findByRole('option', { name: 'Selected companies' }));
    expect(await screen.findByText('Select at least one company: the selection is saved when the list closes.')).toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Restore the default allocation' })).not.toBeInTheDocument();
  });

  it('restores the default allocation from the header pill, as before, without a question', async () => {
    mocked.delete.mockResolvedValue({ data: { fiscal_year: YEAR, mode: 'auto', method: 'headcount', source: 'standard', standard_mode: 'auto', standard_method: 'headcount', company_ids: [], shares: [] } });
    await renderPage();
    const restore = await screen.findByRole('button', { name: 'Restore the default allocation' });
    const heading = screen.getByRole('heading', { level: 1, name: 'Default allocation method' });
    expect(within(heading.parentElement as HTMLElement).getByRole('button', { name: 'Restore the default allocation' })).toBe(restore);
    fireEvent.click(restore);
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/allocation-rules/active', { params: { year: YEAR } }));
    expect(await screen.findByText('Standard method: no override configured for this year.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows a budget administration reader the same fields, read-only, without a pill or a notice', async () => {
    auth.admin = false;
    await renderPage();
    await screen.findByText('35 M USD');
    for (const field of [combobox('Company scope'), combobox('Companies'), combobox('Default method')]) {
      fireEvent.mouseDown(field);
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    }
    expect(combobox('Company scope')).toHaveTextContent('Selected companies');
    expect(combobox('Default method')).toHaveTextContent('Turnover');
    expect(screen.queryByRole('button', { name: 'Restore the default allocation' })).not.toBeInTheDocument();
    expect(screen.queryByText(/budget administration rights/)).not.toBeInTheDocument();
    // The year chooses what the page shows: the reader changes it.
    fireEvent.mouseDown(combobox('Fiscal year'));
    expect(await screen.findByRole('listbox')).toBeInTheDocument();
  });
});
