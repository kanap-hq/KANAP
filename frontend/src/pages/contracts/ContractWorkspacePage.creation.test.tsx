import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

const navigateMock = vi.hoisted(() => vi.fn());
const stableT = vi.hoisted(() => (key: string) => key);
// The placement filter of a limited person; null for everyone else, as the hook answers.
const placement = vi.hoisted(() => ({
  placeRequired: false,
  /** Where a limited access starts a contract (`useContractPlacementDefault`). */
  start: { ready: true, companyId: null as string | null, needsChoice: false },
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
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
  default: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea aria-label="markdown-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
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
vi.mock('../../components/fields/CostCenterSelect', () => ({
  default: ({ label, value, onChange }: { label: string; value: string | null; onChange: (next: string | null) => void }) => (
    <input aria-label={label} value={value ?? ''} onChange={(event) => onChange(event.target.value || null)} />
  ),
}));
vi.mock('../../hooks/usePlacementOptions', () => ({
  useContractPlacementFilter: () => (placement.placeRequired
    ? { companyIds: new Set(['co-1']), isCostCenterAllowed: () => true, placeRequired: true }
    : null),
  useContractPlacementDefault: () => placement.start,
}));
vi.mock('../../components/fields/DateEUField', () => ({
  default: ({ valueYmd, onChangeYmd }: { valueYmd: string; onChangeYmd: (next: string) => void }) => (
    <input aria-label="start-date" value={valueYmd} onChange={(event) => onChangeYmd(event.target.value)} />
  ),
}));

import api from '../../api';
import ContractWorkspacePage from './ContractWorkspacePage';
import { TITLE_FIELD } from '../../test/titleField';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

function renderNew() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={['/ops/contracts/new/overview']}>
            <Routes>
              <Route path="/ops/contracts/:id/:tab" element={<ContractWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('ContractWorkspacePage creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    placement.placeRequired = false;
    placement.start = { ready: true, companyId: null, needsChoice: false };
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/currency/settings') return { data: { reportingCurrency: 'EUR', defaultSpendCurrency: 'EUR', defaultCapexCurrency: 'EUR', allowedCurrencies: ['EUR', 'USD'] } };
      return { data: { items: [] } };
    });
    mocked.post.mockResolvedValue({ data: { id: 'c-new', creation_token: 'tok' } });
  });

  it('creates the contract once its name and required fields are given, then opens it', async () => {
    renderNew();
    const title = screen.getByRole('textbox', { name: TITLE_FIELD });
    fireEvent.change(title, { target: { value: ' Oracle support ' } });
    fireEvent.blur(title);
    const drawer = screen.getByRole('complementary');
    fireEvent.change(within(drawer).getByLabelText('contracts.fields.supplier'), { target: { value: 'sup-1' } });
    fireEvent.change(within(drawer).getByLabelText('contracts.fields.company'), { target: { value: 'co-1' } });
    fireEvent.change(within(drawer).getByLabelText('start-date'), { target: { value: '2026-01-01' } });
    // Only the person's own typing counts in the notes: they focus the editor first.
    const notes = await screen.findByLabelText('markdown-editor');
    fireEvent.focus(notes);
    fireEvent.change(notes, { target: { value: 'Signed by the CIO' } });
    // The tenant's currency is the default, as on the former form.
    await waitFor(() => expect(within(drawer).getByRole('combobox', { name: 'contracts.fields.currency' })).toHaveValue('EUR · Euro'));
    expect(mocked.post).not.toHaveBeenCalled();

    // A keystroke creates nothing; moving on from the last required field to another field does.
    const duration = within(drawer).getByRole('textbox', { name: 'contracts.fields.durationMonths' });
    fireEvent.change(duration, { target: { value: '24' } });
    expect(mocked.post).not.toHaveBeenCalled();
    // The contract has no id yet: nothing asks for its renewal.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocked.get.mock.calls.filter(([url]) => String(url).includes('/renewal'))).toEqual([]);
    fireEvent.blur(duration, { relatedTarget: title });

    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts', {
      name: 'Oracle support',
      supplier_id: 'sup-1',
      company_id: 'co-1',
      owner_user_id: null,
      start_date: '2026-01-01',
      duration_months: 24,
      notice_period_months: 0,
      auto_renewal: true,
      yearly_amount_at_signature: 0,
      currency: 'EUR',
      billing_frequency: 'annual',
      notes: 'Signed by the CIO',
      status: 'enabled',
      disabled_at: null,
    }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/ops/contracts/c-new/overview', { replace: true }));
  });

  it('fills the one company of the workspace, and writes nothing before the name (lot A2)', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/currency/settings') return { data: { reportingCurrency: 'EUR', defaultSpendCurrency: 'EUR', defaultCapexCurrency: 'EUR', allowedCurrencies: ['EUR'] } };
      if (url === '/companies/lookup') return { data: { items: [{ id: 'co-1', name: 'Fromage SA' }], has_more: false } };
      return { data: { items: [] } };
    });
    renderNew();
    const drawer = screen.getByRole('complementary');
    await waitFor(() => expect(within(drawer).getByLabelText('contracts.fields.company')).toHaveValue('co-1'));
    // One currency allowed: the workspace's, already there.
    await waitFor(() => expect(within(drawer).getByRole('combobox', { name: 'contracts.fields.currency' })).toHaveValue('EUR · Euro'));
    fireEvent.change(within(drawer).getByLabelText('contracts.fields.supplier'), { target: { value: 'sup-1' } });
    fireEvent.change(within(drawer).getByLabelText('start-date'), { target: { value: '2026-01-01' } });
    const duration = within(drawer).getByRole('textbox', { name: 'contracts.fields.durationMonths' });
    const title = screen.getByRole('textbox', { name: TITLE_FIELD });
    fireEvent.change(duration, { target: { value: '24' } });
    fireEvent.blur(duration, { relatedTarget: title });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.post).not.toHaveBeenCalled();
    fireEvent.change(title, { target: { value: 'Oracle support' } });
    fireEvent.keyDown(title, { key: 'Enter' });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts', expect.objectContaining({ name: 'Oracle support', company_id: 'co-1', currency: 'EUR' })));
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it('fills the one company a limited access allows', async () => {
    placement.start = { ready: true, companyId: 'co-9', needsChoice: false };
    renderNew();
    await waitFor(() => expect(within(screen.getByRole('complementary')).getByLabelText('contracts.fields.company')).toHaveValue('co-9'));
    expect(mocked.get.mock.calls.filter(([url]) => url === '/companies/lookup')).toEqual([]);
  });

  it('waits for the place when the company holds only through one (limited data access)', async () => {
    placement.placeRequired = true;
    renderNew();
    // The title field of a new record: named "Edit title", or by the page's prompt.
    const title = screen.getByRole('textbox', { name: /^(common:buttons\.editTitle|contracts\.workspace\.newContract)$/ });
    fireEvent.change(title, { target: { value: 'Oracle support' } });
    fireEvent.blur(title);
    const drawer = screen.getByRole('complementary');
    fireEvent.change(within(drawer).getByLabelText('contracts.fields.supplier'), { target: { value: 'sup-1' } });
    fireEvent.change(within(drawer).getByLabelText('contracts.fields.company'), { target: { value: 'co-1' } });
    fireEvent.change(within(drawer).getByLabelText('start-date'), { target: { value: '2026-01-01' } });
    await waitFor(() => expect(within(drawer).getByRole('combobox', { name: 'contracts.fields.currency' })).toHaveValue('EUR · Euro'));
    const duration = within(drawer).getByRole('textbox', { name: 'contracts.fields.durationMonths' });
    const place = within(drawer).getByLabelText('contracts.fields.costCenter');
    fireEvent.change(duration, { target: { value: '24' } });
    fireEvent.blur(duration, { relatedTarget: place });
    // Every usual required field is given, the place is not: nothing is sent, the server would refuse it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocked.post).not.toHaveBeenCalled();

    // Moving on from the place to another field creates the contract.
    fireEvent.change(place, { target: { value: 'cc-1' } });
    fireEvent.blur(place, { relatedTarget: title });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts', expect.objectContaining({
      company_id: 'co-1',
      cost_center_id: 'cc-1',
    })));
  });

  it('keeps Ctrl+S as Create on the new page', async () => {
    renderNew();
    fireEvent.keyDown(document.body, { key: 's', ctrlKey: true });
    expect(await screen.findByText('contracts.messages.nameRequired')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();
  });
});
