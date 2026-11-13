import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import { resetCreationStore } from '../../components/workspace/creation/creationStore';
import type { AnalyticsAxisDetail } from '../../services/analytics';

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
  getAnalyticsAxis: vi.fn(),
  createAnalyticsAxis: vi.fn(),
  updateAnalyticsAxis: vi.fn(),
}));
vi.mock('../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useAnalyticsAxes')>();
  return { ...actual, useAnalyticsAxes: () => actual.buildAnalyticsAxes(AXES as any, ((key: string) => key) as any) };
});
vi.mock('../../hooks/useAnalyticsNav', () => ({
  useAnalyticsDimensionNav: () => ({ ids: [], index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));

import * as service from '../../services/analytics';
import AnalyticsDimensionWorkspacePage from './AnalyticsDimensionWorkspacePage';

const mocked = service as unknown as {
  getAnalyticsAxis: ReturnType<typeof vi.fn>;
  createAnalyticsAxis: ReturnType<typeof vi.fn>;
  updateAnalyticsAxis: ReturnType<typeof vi.fn>;
};

/** What the server stores for the dimension the draft created: only what was sent with it. */
const STORED: AnalyticsAxisDetail = {
  id: 'ax-new', code: 'cost-nature', name: 'Cost nature', description: null, sort_order: 3, is_default: false, applies_to: null,
  required: false, open_values: false, status: 'enabled', disabled_at: null, value_count: 0, opex_count: 0, capex_count: 0,
};

/** The server's copy of the dimension: an update changes what a read returns. */
let server: AnalyticsAxisDetail;

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
          <MemoryRouter initialEntries={['/master-data/analytics/dimensions/new/overview']}>
            <Where />
            <Routes>
              <Route path="/master-data/analytics/dimensions/:id/:tab" element={<AnalyticsDimensionWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('AnalyticsDimensionWorkspacePage typing while the dimension is created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
    server = { ...STORED };
    mocked.getAnalyticsAxis.mockImplementation(async () => server);
    mocked.updateAnalyticsAxis.mockImplementation(async (_id: string, patch: Partial<AnalyticsAxisDetail>) => {
      server = { ...server, ...patch };
      return server;
    });
  });

  /** A new dimension with its name set and its write pending: `finish` ends the write. */
  async function startWrite() {
    let answer: (value: unknown) => void = () => undefined;
    mocked.createAnalyticsAxis.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderNew();
    const title = screen.getByRole('textbox', { name: 'common:buttons.editTitle' });
    fireEvent.change(title, { target: { value: 'Cost nature' } });
    fireEvent.blur(title);
    await waitFor(() => expect(mocked.createAnalyticsAxis).toHaveBeenCalledTimes(1));
    const finish = async () => {
      await act(async () => { answer({ ...STORED, creation_token: 'tok' }); });
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/master-data/analytics/dimensions/ax-new/overview'));
      await until(() => { if (mocked.getAnalyticsAxis.mock.calls.length === 0) throw new Error('dimension not read'); });
    };
    return { finish };
  }

  const updatesWith = (field: string, value: unknown) => mocked.updateAnalyticsAxis.mock.calls
    .filter(([id, body]) => id === 'ax-new' && body?.[field] === value);

  it('saves once on the new dimension the description committed while the dimension is written', async () => {
    const { finish } = await startWrite();
    const description = screen.getByLabelText('analytics.fields.description');
    act(() => description.focus());
    fireEvent.change(description, { target: { value: 'What the money buys' } });
    fireEvent.blur(description);
    await finish();

    await until(() => { if (updatesWith('description', 'What the money buys').length === 0) throw new Error(`updates: ${JSON.stringify(mocked.updateAnalyticsAxis.mock.calls)}`); });
    expect(updatesWith('description', 'What the money buys')).toHaveLength(1);
  });

  it('keeps the description being typed while the dimension is written: same field, same focus, saved on the new dimension', async () => {
    const { finish } = await startWrite();
    const description = screen.getByLabelText('analytics.fields.description');
    act(() => description.focus());
    fireEvent.change(description, { target: { value: 'What' } });
    await finish();

    const shown = screen.getByLabelText('analytics.fields.description') as HTMLTextAreaElement;
    expect(shown === description).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    fireEvent.change(shown, { target: { value: 'What the money buys' } });
    await until(() => { if (shown.value !== 'What the money buys') throw new Error(`description shows "${shown.value}"`); });
    fireEvent.blur(shown);
    await until(() => { if (updatesWith('description', 'What the money buys').length === 0) throw new Error(`updates: ${JSON.stringify(mocked.updateAnalyticsAxis.mock.calls)}`); });
  });

  it('saves once on the new dimension the switch turned on while the dimension is written', async () => {
    const { finish } = await startWrite();
    fireEvent.click(screen.getByRole('checkbox', { name: 'analytics.fields.required' }));
    await finish();

    await until(() => { if (updatesWith('required', true).length === 0) throw new Error(`updates: ${JSON.stringify(mocked.updateAnalyticsAxis.mock.calls)}`); });
    expect(updatesWith('required', true)).toHaveLength(1);
  });

  it('keeps the code being typed while the dimension is written: same field, same focus', async () => {
    const { finish } = await startWrite();
    const code = screen.getByLabelText('analytics.fields.code') as HTMLInputElement;
    act(() => code.focus());
    fireEvent.change(code, { target: { value: 'nature-2' } });
    await finish();

    const shown = screen.getByLabelText('analytics.fields.code') as HTMLInputElement;
    expect(shown === code).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    expect(shown.value).toBe('nature-2');
    fireEvent.blur(shown);
    await until(() => { if (updatesWith('code', 'nature-2').length === 0) throw new Error(`updates: ${JSON.stringify(mocked.updateAnalyticsAxis.mock.calls)}`); });
    expect(updatesWith('code', 'nature-2')).toHaveLength(1);
  });
});
