import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
vi.mock('../../auth/dataAccess', () => ({ useDataAccessAdmin: () => false }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../hooks/useCompanyNav', () => ({
  useCompanyNav: () => ({ ids: [], index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: () => ({ items: [], addToRecent: vi.fn(), clearRecent: vi.fn() }),
}));

import api from '../../api';
import CompanyWorkspacePage from './CompanyWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

/** What the server stores for the company the draft created: only what was sent with it. */
const STORED = {
  id: 'co-new', name: 'Acme Germany', coa_id: 'coa-de', country_iso: 'DE', base_currency: 'EUR', city: 'Berlin', address1: null,
  address2: null, postal_code: null, state: null, reg_number: null, vat_number: null, notes: null, status: 'enabled', disabled_at: null,
};
const COAS = [
  { id: 'coa-de', code: 'COA-DE', name: 'German chart', country_iso: 'DE', scope: 'COUNTRY', is_default: true, is_global_default: false },
];

/** The server's copy of the company: a patch changes what a read returns. */
let server: typeof STORED;

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
          <MemoryRouter initialEntries={['/master-data/companies/new/overview']}>
            <Where />
            <Routes>
              <Route path="/master-data/companies/:id/:tab" element={<CompanyWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('CompanyWorkspacePage typing while the company is created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
    server = { ...STORED };
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/companies/co-new') return { data: server };
      if (url === '/chart-of-accounts') return { data: { items: COAS } };
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: object) => {
      server = { ...server, ...body };
      return { data: server };
    });
  });

  /** A new company with its name, country, currency and city set and its write pending: `finish` ends the write. */
  async function startWrite() {
    let answer: (value: unknown) => void = () => undefined;
    mocked.post.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderNew();
    const title = screen.getByRole('textbox', { name: 'common:buttons.editTitle' });
    fireEvent.change(title, { target: { value: 'Acme Germany' } });
    fireEvent.blur(title);
    const country = await screen.findByLabelText('companies.fields.country');
    fireEvent.change(country, { target: { value: 'Germ' } });
    fireEvent.click(await screen.findByRole('option', { name: 'Germany (DE)' }));
    const city = screen.getByLabelText('companies.fields.city');
    fireEvent.change(city, { target: { value: 'Berlin' } });
    fireEvent.blur(city);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    const finish = async () => {
      await act(async () => { answer({ data: { ...STORED, creation_token: 'tok' } }); });
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/master-data/companies/co-new/overview'));
      await until(() => { if (!mocked.get.mock.calls.some(([url]) => url === '/companies/co-new')) throw new Error('company not read'); });
    };
    return { finish };
  }

  const patchesWith = (field: string, value: unknown) => mocked.patch.mock.calls
    .filter(([url, body]) => url === '/companies/co-new' && body?.[field] === value);

  it('saves once on the new company the VAT number committed while the company is written', async () => {
    const { finish } = await startWrite();
    const vat = screen.getByLabelText('companies.fields.vatNumber');
    act(() => vat.focus());
    fireEvent.change(vat, { target: { value: 'DE123' } });
    fireEvent.blur(vat);
    await finish();

    await until(() => { if (patchesWith('vat_number', 'DE123').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
    expect(patchesWith('vat_number', 'DE123')).toHaveLength(1);
    const shown = screen.getByLabelText('companies.fields.vatNumber') as HTMLInputElement;
    await until(() => { if (shown.value !== 'DE123') throw new Error(`VAT number shows "${shown.value}"`); });
  });

  it('keeps the notes being typed while the company is written: same field, same focus, saved on the new company', async () => {
    const { finish } = await startWrite();
    const notes = screen.getByLabelText('companies.fields.notes');
    act(() => notes.focus());
    fireEvent.change(notes, { target: { value: 'Ma' } });
    await finish();

    const shown = screen.getByLabelText('companies.fields.notes') as HTMLTextAreaElement;
    expect(shown === notes).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    fireEvent.change(shown, { target: { value: 'Main entity' } });
    await until(() => { if (shown.value !== 'Main entity') throw new Error(`notes show "${shown.value}"`); });
    fireEvent.blur(shown);
    await until(() => { if (patchesWith('notes', 'Main entity').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
  });
});
