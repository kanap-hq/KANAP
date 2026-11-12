import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import { resetCreationStore } from '../../components/workspace/creation/creationStore';

const stableT = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' }, dataAccess: null }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'fromage' }) }));
vi.mock('../../hooks/useContractNav', () => ({
  useContractNav: () => ({ ids: [], index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('../../components/MarkdownEditor', () => ({
  default: ({ value }: { value: string }) => <textarea aria-label="markdown-editor" value={value} readOnly />,
}));
// The pickers as plain inputs: what the page does with their values is what is tested here.
vi.mock('../../components/fields/SupplierSelect', () => ({
  default: ({ label, value, onChange }: { label: string; value: string; onChange: (next: string | null) => void }) => (
    <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value || null)} />
  ),
}));
vi.mock('../../components/fields/CompanySelect', () => ({
  default: ({ label, value, onChange }: { label: string; value: string; onChange: (next: string | null) => void }) => (
    <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value || null)} />
  ),
}));
vi.mock('../../components/fields/DateEUField', () => ({
  default: ({ valueYmd, onChangeYmd }: { valueYmd: string; onChangeYmd: (next: string) => void }) => (
    <input aria-label="start-date" value={valueYmd} onChange={(event) => onChangeYmd(event.target.value)} />
  ),
}));

import api from '../../api';
import ContractWorkspacePage from './ContractWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

/** What the server stores for the contract the draft created: the amount is the one sent with it. */
const STORED = {
  id: 'c-new',
  name: 'Oracle support',
  status: 'enabled',
  disabled_at: null,
  company_id: 'co-1',
  supplier_id: 'sup-1',
  owner_user_id: null,
  start_date: '2026-01-01',
  duration_months: 24,
  auto_renewal: true,
  notice_period_months: 0,
  yearly_amount_at_signature: 0,
  currency: 'EUR',
  billing_frequency: 'annual',
  notes: null,
  created_at: '2026-11-12T10:00:00Z',
  updated_at: '2026-11-12T10:00:00Z',
  supplier_name: 'Oracle',
  company_name: 'Fromage & Co',
  owner_name: null,
};

/** Polls like waitFor, with a short failure message (a failed DOM matcher prints the whole page). */
async function until(check: () => void, ms = 1500) {
  const end = Date.now() + ms;
  for (;;) {
    try { check(); return; } catch (error) {
      if (Date.now() > end) throw error;
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 25)); });
    }
  }
}

function Where() {
  const location = useLocation();
  return <div data-testid="where">{location.pathname}</div>;
}

function renderNew() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={['/ops/contracts/new/overview']}>
            <Where />
            <Routes>
              <Route path="/ops/contracts/:id/:tab" element={<ContractWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('ContractWorkspacePage typing while the contract is created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/currency/settings') return { data: { reportingCurrency: 'EUR', defaultSpendCurrency: 'EUR', defaultCapexCurrency: 'EUR', allowedCurrencies: ['EUR', 'USD'] } };
      if (url === '/contracts/c-new') return { data: STORED };
      if (url === '/contracts/c-new/relation-counts') return { data: { budget_lines: 0, relations: 0 } };
      if (url === '/contracts/c-new/tasks') return { data: [] };
      return { data: { items: [] } };
    });
    mocked.patch.mockResolvedValue({ data: {} });
  });

  it('keeps the amount typed while the contract is written, shows it and saves it on the new contract', async () => {
    let answer: (value: unknown) => void = () => undefined;
    mocked.post.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderNew();
    const title = screen.getByRole('textbox', { name: 'common:buttons.editTitle' });
    fireEvent.change(title, { target: { value: 'Oracle support' } });
    fireEvent.blur(title);
    const drawer = screen.getByRole('complementary');
    fireEvent.change(within(drawer).getByLabelText('contracts.fields.supplier'), { target: { value: 'sup-1' } });
    fireEvent.change(within(drawer).getByLabelText('contracts.fields.company'), { target: { value: 'co-1' } });
    fireEvent.change(within(drawer).getByLabelText('start-date'), { target: { value: '2026-01-01' } });
    await waitFor(() => expect(within(drawer).getByRole('combobox', { name: 'contracts.fields.currency' })).toHaveValue('EUR · Euro'));
    const duration = within(drawer).getByRole('textbox', { name: 'contracts.fields.durationMonths' });
    fireEvent.change(duration, { target: { value: '24' } });
    fireEvent.blur(duration);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));

    // The person moves on to the amount while the contract is being written.
    const amount = within(drawer).getByRole('textbox', { name: 'contracts.fields.yearlyAmount' });
    act(() => amount.focus());
    fireEvent.change(amount, { target: { value: '12000' } });

    await act(async () => { answer({ data: { ...STORED, creation_token: 'tok' } }); });
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/ops/contracts/c-new/overview'));

    // The same field still has the focus and what was typed, and the amount is saved on the new contract.
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/contracts/c-new'));
    const shown = within(screen.getByRole('complementary')).getByRole('textbox', { name: 'contracts.fields.yearlyAmount' });
    // Short failure messages: a failed DOM matcher prints the whole page.
    await until(() => { if ((shown as HTMLInputElement).value !== '12000') throw new Error(`amount shows "${(shown as HTMLInputElement).value}"`); });
    expect(shown === amount).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    fireEvent.blur(shown);
    await until(() => { if (!mocked.patch.mock.calls.some(([url, body]) => url === '/contracts/c-new' && body?.yearly_amount_at_signature === 12000)) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
  });
});
