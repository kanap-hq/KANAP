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
// The supplier picker searches the API: a plain input stands in.
vi.mock('../../components/fields/SupplierSelect', () => ({
  default: (props: { label?: string; value: string | null }) => <input aria-label={props.label} value={props.value ?? ''} readOnly />,
}));

import api from '../../api';
import ContactWorkspacePage from './ContactWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

/** What the server stores for the contact the draft created: only what was sent with it. */
const STORED = {
  id: 'c-new', first_name: null, last_name: null, job_title: null, email: 'alex@example.com', phone: null, mobile: null,
  country: null, notes: null, active: true, supplier_id: null, supplier_role: null, supplier_name: null,
};

/** The server's copy of the contact: a patch changes what a read returns. */
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
          <MemoryRouter initialEntries={['/master-data/contacts/new/overview']}>
            <Where />
            <Routes>
              <Route path="/master-data/contacts/:id/:tab" element={<ContactWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('ContactWorkspacePage typing while the contact is created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
    server = { ...STORED };
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/contacts/c-new') return { data: server };
      if (url.endsWith('/usages')) return { data: { total: 0, groups: [] } };
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: object) => {
      server = { ...server, ...body };
      return { data: server };
    });
  });

  /** A new contact with its email committed and its write pending: `finish` ends the write. */
  async function startWrite() {
    let answer: (value: unknown) => void = () => undefined;
    mocked.post.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderNew();
    const drawer = screen.getByRole('complementary');
    const email = within(drawer).getByLabelText('contacts.fields.email');
    fireEvent.change(email, { target: { value: 'alex@example.com' } });
    fireEvent.blur(email);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    const finish = async () => {
      await act(async () => { answer({ data: { ...STORED, creation_token: 'tok' } }); });
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/master-data/contacts/c-new/overview'));
      await until(() => { if (!mocked.get.mock.calls.some(([url]) => url === '/contacts/c-new')) throw new Error('contact not read'); });
    };
    return { drawer, finish };
  }

  const patchesWith = (field: string, value: unknown) => mocked.patch.mock.calls
    .filter(([url, body]) => url === '/contacts/c-new' && body?.[field] === value);

  it('keeps the job title being typed while the contact is written: same field, same focus, saved on the new contact', async () => {
    const { drawer, finish } = await startWrite();
    const job = within(drawer).getByLabelText('contacts.fields.jobTitle');
    act(() => job.focus());
    fireEvent.change(job, { target: { value: 'CT' } });
    await finish();

    const shown = within(screen.getByRole('complementary')).getByLabelText('contacts.fields.jobTitle') as HTMLInputElement;
    expect(shown === job).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    fireEvent.change(shown, { target: { value: 'CTO' } });
    await until(() => { if (shown.value !== 'CTO') throw new Error(`job title shows "${shown.value}"`); });
    fireEvent.blur(shown);
    await until(() => { if (patchesWith('job_title', 'CTO').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
  });

  it('saves on the new contact a field committed while the contact is written', async () => {
    const { drawer, finish } = await startWrite();
    const job = within(drawer).getByLabelText('contacts.fields.jobTitle');
    act(() => job.focus());
    fireEvent.change(job, { target: { value: 'CTO' } });
    fireEvent.blur(job);
    await finish();

    await until(() => { if (patchesWith('job_title', 'CTO').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
    // A contact is saved with its email.
    expect(patchesWith('job_title', 'CTO')[0][1]).toEqual({ email: 'alex@example.com', job_title: 'CTO' });
    const shown = within(screen.getByRole('complementary')).getByLabelText('contacts.fields.jobTitle') as HTMLInputElement;
    await until(() => { if (shown.value !== 'CTO') throw new Error(`job title shows "${shown.value}"`); });
  });

  it('saves on the new contact the notes typed while the contact is written, with the same field and focus', async () => {
    const { finish } = await startWrite();
    const notes = screen.getByLabelText('contacts.fields.notes');
    act(() => notes.focus());
    fireEvent.change(notes, { target: { value: 'Prefers email' } });
    await finish();

    // Nothing more is typed: the text scheduled on the draft is saved on the contact.
    const shown = screen.getByLabelText('contacts.fields.notes') as HTMLTextAreaElement;
    expect(shown === notes).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    expect(shown.value).toBe('Prefers email');
    fireEvent.blur(shown);
    await until(() => { if (patchesWith('notes', 'Prefers email').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
  });
});
