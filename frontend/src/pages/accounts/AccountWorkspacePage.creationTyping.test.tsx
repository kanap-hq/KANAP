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
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../hooks/useAccountNav', () => ({
  useAccountNav: () => ({ ids: [], index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));

import api from '../../api';
import AccountWorkspacePage from './AccountWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

/** What the server stores for the account the draft created: only what was sent with it. */
const STORED = {
  id: 'a-new', coa_id: 'coa-fr', account_number: 606300, account_name: 'Hosting', native_name: null, description: null,
  consolidation_account_number: null, consolidation_account_name: null, consolidation_account_description: null,
  nature: null, status: 'enabled', disabled_at: null,
};
const COAS = [{ id: 'coa-fr', code: 'PCG', name: 'French chart', country_iso: 'FR', scope: 'COUNTRY', is_default: true, is_consolidation: false }];

/** The server's copy of the account: a patch changes what a read returns. */
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
          <MemoryRouter initialEntries={['/master-data/accounts/new/overview?selected=coa-fr']}>
            <Where />
            <Routes>
              <Route path="/master-data/accounts/:id/:tab" element={<AccountWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('AccountWorkspacePage typing while the account is created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
    server = { ...STORED };
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/accounts/a-new') return { data: server };
      if (url === '/chart-of-accounts') return { data: { items: COAS } };
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: object) => {
      server = { ...server, ...body };
      return { data: server };
    });
  });

  /** A new account with its name and number set and its write pending: `finish` ends the write. */
  async function startWrite() {
    let answer: (value: unknown) => void = () => undefined;
    mocked.post.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderNew();
    const number = await screen.findByLabelText('accounts.fields.accountNumber');
    fireEvent.change(number, { target: { value: '606300' } });
    fireEvent.blur(number);
    const title = screen.getByRole('textbox', { name: 'common:buttons.editTitle' });
    fireEvent.change(title, { target: { value: 'Hosting' } });
    fireEvent.blur(title);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    const finish = async () => {
      await act(async () => { answer({ data: { ...STORED, creation_token: 'tok' } }); });
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/master-data/accounts/a-new/overview'));
      await until(() => { if (!mocked.get.mock.calls.some(([url]) => url === '/accounts/a-new')) throw new Error('account not read'); });
    };
    return { finish };
  }

  const patchesWith = (field: string, value: unknown) => mocked.patch.mock.calls
    .filter(([url, body]) => url === '/accounts/a-new' && body?.[field] === value);

  it('saves once on the new account the native name committed while the account is written', async () => {
    const { finish } = await startWrite();
    const native = screen.getByLabelText('accounts.fields.nativeName');
    act(() => native.focus());
    fireEvent.change(native, { target: { value: 'Hébergement' } });
    fireEvent.blur(native);
    await finish();

    await until(() => { if (patchesWith('native_name', 'Hébergement').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
    expect(patchesWith('native_name', 'Hébergement')).toHaveLength(1);
    const shown = screen.getByLabelText('accounts.fields.nativeName') as HTMLInputElement;
    await until(() => { if (shown.value !== 'Hébergement') throw new Error(`native name shows "${shown.value}"`); });
  });

  it('keeps the description being typed while the account is written: same field, same focus, saved on the new account', async () => {
    const { finish } = await startWrite();
    const description = screen.getByLabelText('accounts.fields.description');
    act(() => description.focus());
    fireEvent.change(description, { target: { value: 'Ho' } });
    await finish();

    const shown = screen.getByLabelText('accounts.fields.description') as HTMLTextAreaElement;
    expect(shown === description).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    fireEvent.change(shown, { target: { value: 'Hosting costs' } });
    await until(() => { if (shown.value !== 'Hosting costs') throw new Error(`description shows "${shown.value}"`); });
    fireEvent.blur(shown);
    await until(() => { if (patchesWith('description', 'Hosting costs').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
  });
});
