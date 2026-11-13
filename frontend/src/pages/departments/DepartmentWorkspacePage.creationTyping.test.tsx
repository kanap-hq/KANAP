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
vi.mock('../../hooks/useDepartmentNav', () => ({
  useDepartmentNav: () => ({ ids: [], index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
// The company picker searches the API: a button stands in.
vi.mock('../../components/fields/CompanySelect', () => ({
  default: (props: { onChange: (v: string | null) => void }) => (
    <button type="button" onClick={() => props.onChange('company-2')}>pick company</button>
  ),
}));

import api from '../../api';
import DepartmentWorkspacePage from './DepartmentWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

/** What the server stores for the department the draft created: only what was sent with it. */
const STORED = { id: 'd-new', name: 'Finance', company_id: 'company-2', description: null, status: 'enabled', disabled_at: null };

/** The server's copy of the department: a patch changes what a read returns. */
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
          <MemoryRouter initialEntries={['/master-data/departments/new/overview']}>
            <Where />
            <Routes>
              <Route path="/master-data/departments/:id/:tab" element={<DepartmentWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('DepartmentWorkspacePage typing while the department is created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
    server = { ...STORED };
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/departments/d-new') return { data: server };
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: object) => {
      server = { ...server, ...body };
      return { data: server };
    });
  });

  /** A new department with its name and company set and its write pending: `finish` ends the write. */
  async function startWrite() {
    let answer: (value: unknown) => void = () => undefined;
    mocked.post.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderNew();
    const title = screen.getByRole('textbox', { name: 'common:buttons.editTitle' });
    fireEvent.change(title, { target: { value: 'Finance' } });
    fireEvent.blur(title);
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    const finish = async () => {
      await act(async () => { answer({ data: { ...STORED, creation_token: 'tok' } }); });
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/master-data/departments/d-new/overview'));
      await until(() => { if (!mocked.get.mock.calls.some(([url]) => url === '/departments/d-new')) throw new Error('department not read'); });
    };
    return { finish };
  }

  const patchesWith = (field: string, value: unknown) => mocked.patch.mock.calls
    .filter(([url, body]) => url === '/departments/d-new' && body?.[field] === value);

  it('saves once on the new department the description committed while the department is written', async () => {
    const { finish } = await startWrite();
    const description = screen.getByLabelText('departments.fields.description');
    act(() => description.focus());
    fireEvent.change(description, { target: { value: 'Accounting' } });
    fireEvent.blur(description);
    await finish();

    await until(() => { if (patchesWith('description', 'Accounting').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
    expect(patchesWith('description', 'Accounting')).toHaveLength(1);
    const shown = screen.getByLabelText('departments.fields.description') as HTMLTextAreaElement;
    await until(() => { if (shown.value !== 'Accounting') throw new Error(`description shows "${shown.value}"`); });
  });

  it('keeps the description being typed while the department is written: same field, same focus, saved on the new department', async () => {
    const { finish } = await startWrite();
    const description = screen.getByLabelText('departments.fields.description');
    act(() => description.focus());
    fireEvent.change(description, { target: { value: 'Acc' } });
    await finish();

    const shown = screen.getByLabelText('departments.fields.description') as HTMLTextAreaElement;
    expect(shown === description).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    fireEvent.change(shown, { target: { value: 'Accounting' } });
    await until(() => { if (shown.value !== 'Accounting') throw new Error(`description shows "${shown.value}"`); });
    fireEvent.blur(shown);
    await until(() => { if (patchesWith('description', 'Accounting').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
  });
});
