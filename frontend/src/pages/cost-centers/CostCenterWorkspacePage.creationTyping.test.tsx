import React from 'react';
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
vi.mock('../../hooks/useCostCenterNav', () => ({
  useCostCenterNav: () => ({ ids: [], index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
// The pickers search the API: buttons stand in.
vi.mock('../../components/fields/CompanySelect', () => ({
  default: (props: { onChange: (v: string | null) => void }) => (
    <button type="button" onClick={() => props.onChange('company-2')}>pick company</button>
  ),
}));
vi.mock('../../components/fields/UserSelect', () => ({
  default: (props: { onChange: (v: string | null) => void }) => (
    <button type="button" onClick={() => props.onChange('user-2')}>pick owner</button>
  ),
}));
vi.mock('../../components/fields/CostCenterSelect', () => ({ default: () => <div /> }));

import api from '../../api';
import CostCenterWorkspacePage from './CostCenterWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

/** What the server stores for the cost center the draft created: only what was sent with it. */
const STORED = {
  id: 'cc-new', code: 'CC-77', name: 'Paris', kind: 'cost_center', parent_id: null, company_id: 'company-2', company_name: 'Acme',
  owner_user_id: null, owner_name: null, status: 'enabled', disabled_at: null, sort_order: 0, depth: 0,
  path: 'CC-77', path_ids: ['cc-new'], parent_code: null, parent_name: null, description: null, opex_count: 0, capex_count: 0,
};

/** The server's copy of the cost center: a patch changes what a read returns. */
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
          <MemoryRouter initialEntries={['/master-data/cost-centers/new/overview']}>
            <Where />
            <Routes>
              <Route path="/master-data/cost-centers/:id/:tab" element={<CostCenterWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('CostCenterWorkspacePage typing while the cost center is created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
    server = { ...STORED };
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/cost-centers/cc-new') return { data: server };
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: object) => {
      server = { ...server, ...body };
      return { data: server };
    });
  });

  /** A new cost center with its name, code and company set and its write pending: `finish` ends the write. */
  async function startWrite() {
    let answer: (value: unknown) => void = () => undefined;
    mocked.post.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderNew();
    const code = screen.getByLabelText('costCenters.fields.code');
    fireEvent.change(code, { target: { value: 'CC-77' } });
    fireEvent.blur(code);
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    const title = screen.getByRole('textbox', { name: 'common:buttons.editTitle' });
    fireEvent.change(title, { target: { value: 'Paris' } });
    fireEvent.blur(title);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    const finish = async () => {
      await act(async () => { answer({ data: { ...STORED, creation_token: 'tok' } }); });
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/master-data/cost-centers/cc-new/overview'));
      await until(() => { if (!mocked.get.mock.calls.some(([url]) => url === '/cost-centers/cc-new')) throw new Error('cost center not read'); });
    };
    return { finish };
  }

  const patchesWith = (field: string, value: unknown) => mocked.patch.mock.calls
    .filter(([url, body]) => url === '/cost-centers/cc-new' && body?.[field] === value);

  it('saves once on the new cost center the owner picked while the cost center is written', async () => {
    const { finish } = await startWrite();
    fireEvent.click(screen.getByRole('button', { name: 'pick owner' }));
    await finish();

    await until(() => { if (patchesWith('owner_user_id', 'user-2').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
    expect(patchesWith('owner_user_id', 'user-2')).toHaveLength(1);
  });

  it('keeps the description being typed while the cost center is written: same field, same focus, saved on the new cost center', async () => {
    const { finish } = await startWrite();
    const description = screen.getByLabelText('costCenters.fields.description');
    act(() => description.focus());
    fireEvent.change(description, { target: { value: 'Pa' } });
    await finish();

    const shown = screen.getByLabelText('costCenters.fields.description') as HTMLTextAreaElement;
    expect(shown === description).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    fireEvent.change(shown, { target: { value: 'Paris office' } });
    await until(() => { if (shown.value !== 'Paris office') throw new Error(`description shows "${shown.value}"`); });
    fireEvent.blur(shown);
    await until(() => { if (patchesWith('description', 'Paris office').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
  });

  it('keeps the code being typed while the cost center is written: same field, same focus', async () => {
    const { finish } = await startWrite();
    const code = screen.getByLabelText('costCenters.fields.code') as HTMLInputElement;
    act(() => code.focus());
    fireEvent.change(code, { target: { value: 'CC-78' } });
    await finish();

    const shown = screen.getByLabelText('costCenters.fields.code') as HTMLInputElement;
    expect(shown === code).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    expect(shown.value).toBe('CC-78');
    fireEvent.blur(shown);
    await until(() => { if (patchesWith('code', 'CC-78').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
    expect(patchesWith('code', 'CC-78')).toHaveLength(1);
  });
});
