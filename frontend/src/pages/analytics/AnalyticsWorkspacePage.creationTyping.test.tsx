import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import { resetCreationStore } from '../../components/workspace/creation/creationStore';
import type { AnalyticsValueDetail } from '../../services/analytics';

const stableT = vi.hoisted(() => (key: string) => key);
const AXES = vi.hoisted(() => [
  { id: 'ax-nature', code: 'nature', name: 'Nature', description: null, sort_order: 1, is_default: false, status: 'enabled', disabled_at: null },
]);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' }, dataAccess: null }),
}));
vi.mock('../../services/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/analytics')>()),
  getAnalyticsValue: vi.fn(),
  createAnalyticsValue: vi.fn(),
  updateAnalyticsValue: vi.fn(),
}));
vi.mock('../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useAnalyticsAxes')>();
  return { ...actual, useAnalyticsAxes: () => actual.buildAnalyticsAxes(AXES as any, ((key: string) => key) as any) };
});
vi.mock('../../hooks/useAnalyticsNav', () => ({
  useAnalyticsNav: () => ({ ids: [], index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));

import * as service from '../../services/analytics';
import AnalyticsWorkspacePage from './AnalyticsWorkspacePage';

const mocked = service as unknown as {
  getAnalyticsValue: ReturnType<typeof vi.fn>;
  createAnalyticsValue: ReturnType<typeof vi.fn>;
  updateAnalyticsValue: ReturnType<typeof vi.fn>;
};

/** What the server stores for the value the draft created: only what was sent with it. */
const STORED: AnalyticsValueDetail = {
  id: 'v-new', axis_id: 'ax-nature', name: 'Hardware', description: null, applies_to: null, sort_order: 1, status: 'enabled',
  disabled_at: null, axis_name: 'Nature', axis_is_default: false, opex_count: 0, capex_count: 0,
};

/** The server's copy of the value: an update changes what a read returns. */
let server: AnalyticsValueDetail;

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
          <MemoryRouter initialEntries={['/master-data/analytics/new/overview?axis=ax-nature']}>
            <Where />
            <Routes>
              <Route path="/master-data/analytics/:id/:tab" element={<AnalyticsWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('AnalyticsWorkspacePage typing while the value is created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
    server = { ...STORED };
    mocked.getAnalyticsValue.mockImplementation(async () => server);
    mocked.updateAnalyticsValue.mockImplementation(async (_id: string, patch: Partial<AnalyticsValueDetail>) => {
      server = { ...server, ...patch };
      return server;
    });
  });

  /** A new value with its name set and its write pending: `finish` ends the write. */
  async function startWrite() {
    let answer: (value: unknown) => void = () => undefined;
    mocked.createAnalyticsValue.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderNew();
    const title = screen.getByRole('textbox', { name: 'common:buttons.editTitle' });
    fireEvent.change(title, { target: { value: 'Hardware' } });
    fireEvent.blur(title);
    await waitFor(() => expect(mocked.createAnalyticsValue).toHaveBeenCalledTimes(1));
    const finish = async () => {
      await act(async () => { answer({ ...STORED, creation_token: 'tok' }); });
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/master-data/analytics/v-new/overview'));
      await until(() => { if (mocked.getAnalyticsValue.mock.calls.length === 0) throw new Error('value not read'); });
    };
    return { finish };
  }

  const updatesWith = (field: string, value: unknown) => mocked.updateAnalyticsValue.mock.calls
    .filter(([id, body]) => id === 'v-new' && body?.[field] === value);

  it('saves once on the new value the description committed while the value is written', async () => {
    const { finish } = await startWrite();
    const description = screen.getByLabelText('analytics.fields.description');
    act(() => description.focus());
    fireEvent.change(description, { target: { value: 'Servers' } });
    fireEvent.blur(description);
    await finish();

    await until(() => { if (updatesWith('description', 'Servers').length === 0) throw new Error(`updates: ${JSON.stringify(mocked.updateAnalyticsValue.mock.calls)}`); });
    expect(updatesWith('description', 'Servers')).toHaveLength(1);
  });

  it('keeps the description being typed while the value is written: same field, same focus, saved on the new value', async () => {
    const { finish } = await startWrite();
    const description = screen.getByLabelText('analytics.fields.description');
    act(() => description.focus());
    fireEvent.change(description, { target: { value: 'Ser' } });
    await finish();

    const shown = screen.getByLabelText('analytics.fields.description') as HTMLTextAreaElement;
    expect(shown === description).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    fireEvent.change(shown, { target: { value: 'Servers' } });
    await until(() => { if (shown.value !== 'Servers') throw new Error(`description shows "${shown.value}"`); });
    fireEvent.blur(shown);
    await until(() => { if (updatesWith('description', 'Servers').length === 0) throw new Error(`updates: ${JSON.stringify(mocked.updateAnalyticsValue.mock.calls)}`); });
  });

  it('saves once on the new value the line type chosen while the value is written', async () => {
    const { finish } = await startWrite();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'shared.lineTypeUsage.label' }));
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'master-data:shared.lineTypeUsage.capex' }));
    await finish();

    await until(() => { if (updatesWith('applies_to', 'capex').length === 0) throw new Error(`updates: ${JSON.stringify(mocked.updateAnalyticsValue.mock.calls)}`); });
    expect(updatesWith('applies_to', 'capex')).toHaveLength(1);
  });
});
