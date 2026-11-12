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
vi.mock('../../hooks/useSupplierNav', () => ({
  useSupplierNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));

import api from '../../api';
import SupplierWorkspacePage from './SupplierWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

/** What the server stores for the supplier the draft created: only what was sent with it. */
const STORED = { id: 's-new', name: 'Initech', erp_supplier_id: null, notes: null, status: 'enabled', disabled_at: null };

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
          <MemoryRouter initialEntries={['/master-data/suppliers/new/overview']}>
            <Where />
            <Routes>
              <Route path="/master-data/suppliers/:id/:tab" element={<SupplierWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** The server's copy of the supplier: a patch changes what a read returns. */
let server: typeof STORED;

describe('SupplierWorkspacePage typing while the supplier is created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
    server = { ...STORED };
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/suppliers/s-new') return { data: server };
      if (url.endsWith('/usages')) return { data: { total: 0, groups: [] } };
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: object) => {
      server = { ...server, ...body };
      return { data: server };
    });
  });

  /** A new supplier with its name committed and its write pending: `finish` ends the write. */
  async function startWrite() {
    let answer: (value: unknown) => void = () => undefined;
    mocked.post.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderNew();
    const title = screen.getByRole('textbox', { name: 'common:buttons.editTitle' });
    fireEvent.change(title, { target: { value: 'Initech' } });
    fireEvent.blur(title);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    const finish = async () => {
      await act(async () => { answer({ data: { ...STORED, creation_token: 'tok' } }); });
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/master-data/suppliers/s-new/overview'));
      await until(() => { if (!mocked.get.mock.calls.some(([url]) => url === '/suppliers/s-new')) throw new Error('supplier not read'); });
    };
    return { drawer: screen.getByRole('complementary'), finish };
  }

  const patchesWith = (field: string, value: unknown) => mocked.patch.mock.calls
    .filter(([url, body]) => url === '/suppliers/s-new' && body?.[field] === value);

  it('keeps the ERP ID being typed while the supplier is written: same field, same focus, saved on the new supplier', async () => {
    const { drawer, finish } = await startWrite();
    const erp = within(drawer).getByLabelText('suppliers.fields.erpSupplierId');
    act(() => erp.focus());
    fireEvent.change(erp, { target: { value: 'SUP-0' } });
    await finish();

    const shown = within(screen.getByRole('complementary')).getByLabelText('suppliers.fields.erpSupplierId') as HTMLInputElement;
    expect(shown === erp).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    fireEvent.change(shown, { target: { value: 'SUP-077' } });
    await until(() => { if (shown.value !== 'SUP-077') throw new Error(`ERP ID shows "${shown.value}"`); });
    fireEvent.blur(shown);
    await until(() => { if (patchesWith('erp_supplier_id', 'SUP-077').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
  });

  it('saves on the new supplier a field committed while the supplier is written', async () => {
    const { drawer, finish } = await startWrite();
    const erp = within(drawer).getByLabelText('suppliers.fields.erpSupplierId');
    act(() => erp.focus());
    fireEvent.change(erp, { target: { value: 'SUP-077' } });
    fireEvent.blur(erp);
    await finish();

    await until(() => { if (patchesWith('erp_supplier_id', 'SUP-077').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
    const shown = within(screen.getByRole('complementary')).getByLabelText('suppliers.fields.erpSupplierId') as HTMLInputElement;
    await until(() => { if (shown.value !== 'SUP-077') throw new Error(`ERP ID shows "${shown.value}"`); });
  });

  it('saves on the new supplier the notes typed while the supplier is written, with the same field and focus', async () => {
    const { finish } = await startWrite();
    const notes = screen.getByLabelText('suppliers.fields.notes');
    act(() => notes.focus());
    fireEvent.change(notes, { target: { value: 'Net 30' } });
    await finish();

    // Nothing more is typed: the text scheduled on the draft is saved on the supplier.
    const shown = screen.getByLabelText('suppliers.fields.notes') as HTMLTextAreaElement;
    expect(shown === notes).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    expect(shown.value).toBe('Net 30');
    fireEvent.blur(shown);
    await until(() => { if (patchesWith('notes', 'Net 30').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
  });
});
