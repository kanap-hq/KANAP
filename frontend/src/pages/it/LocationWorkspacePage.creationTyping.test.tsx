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
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }) }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../hooks/useItOpsEnumOptions', () => {
  const value = {
    settings: { hostingTypes: [{ code: 'on_prem', category: 'on_prem' }] },
    byField: { hostingType: [{ code: 'on_prem', label: 'On premises' }], serverProvider: [] },
  };
  return { default: () => value, useItOpsEnumOptions: () => value };
});
vi.mock('../../hooks/useModuleItemNav', () => ({
  useLocationItemNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/fields/CompanySelect', () => ({ default: () => null }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('../../components/MarkdownEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea aria-label="markdown-editor" value={value ?? ''} onChange={(event) => onChange(event.target.value)} />
  ),
}));
vi.mock('./workspace/LocationSubItemsTable', () => ({ default: () => null }));
vi.mock('./workspace/LocationMetadataBar', () => ({ default: () => null }));
vi.mock('./workspace/LocationContactsTab', () => ({ default: () => null }));
vi.mock('./workspace/LocationRelationsTab', () => ({ default: () => null }));

import api from '../../api';
import LocationWorkspacePage from './LocationWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

/** What the server stores for the site the draft created: only what was sent with it. */
const STORED = {
  id: 'loc-new',
  location_reference: 'LOC-9',
  name: 'Lyon DC',
  hosting_type: 'on_prem',
  operating_company_id: null,
  country_iso: null,
  city: null,
  provider: null,
  region: null,
  additional_info: null,
};

/** The server's copy of the site: a patch changes what a read returns. */
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
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderNew(path = '/it/locations/new/overview') {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient()}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Where />
            <Routes>
              <Route path="/it/locations/:id/:tab" element={<LocationWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('LocationWorkspacePage typing while the site is created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreationStore();
    server = { ...STORED };
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/locations/LOC-9' || url === '/locations/loc-new') return { data: server };
      return { data: [] };
    });
    mocked.patch.mockImplementation(async (_url: string, body: object) => {
      server = { ...server, ...body };
      return { data: server };
    });
  });

  /** A new site with its name committed and its write pending: `finish` ends the write. */
  async function startWrite() {
    let answer: (value: unknown) => void = () => undefined;
    mocked.post.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    renderNew();
    const title = screen.getByRole('textbox', { name: 'common:buttons.editTitle' });
    fireEvent.change(title, { target: { value: 'Lyon DC' } });
    fireEvent.blur(title);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    const finish = async () => {
      // The create answers with the stored site, its reference included.
      await act(async () => { answer({ data: { ...STORED, creation_token: 'tok' } }); });
      await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/it/locations/LOC-9/overview'));
      // Let the page settle: it must not read the site again and replace what is typed.
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    };
    return { drawer: screen.getByRole('complementary'), finish };
  }

  const patchesWith = (field: string, value: unknown) => mocked.patch.mock.calls
    .filter(([url, body]) => url === '/locations/loc-new' && body?.[field] === value);

  it('opens the site at its reference, never at its long identifier', async () => {
    const { finish } = await startWrite();
    await finish();
    expect(screen.getByTestId('where')).toHaveTextContent('/it/locations/LOC-9/overview');
    expect(screen.getByTestId('where').textContent).not.toContain('loc-new');
  });

  it('keeps the city being typed, letter by letter, across the move to the site: same field, same focus, saved on blur', async () => {
    const { drawer, finish } = await startWrite();
    const city = within(drawer).getByPlaceholderText('workspace.location.fields.cityPlaceholder');
    act(() => city.focus());
    fireEvent.change(city, { target: { value: 'Lo' } });
    await finish();

    const shown = within(screen.getByRole('complementary')).getByPlaceholderText('workspace.location.fields.cityPlaceholder') as HTMLInputElement;
    expect(shown === city).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    // The rest of the word is typed after the move, one letter at a time: nothing interrupts it.
    for (const typed of ['Lor', 'Lori', 'Lorie', 'Lorien', 'Lorient']) {
      fireEvent.change(shown, { target: { value: typed } });
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
      expect(document.activeElement === shown).toBe(true);
      expect(shown.disabled).toBe(false);
      expect(shown.value).toBe(typed);
    }
    expect(mocked.patch).not.toHaveBeenCalled();
    fireEvent.blur(shown);
    await until(() => { if (patchesWith('city', 'Lorient').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
    expect(mocked.patch.mock.calls.filter(([, body]) => 'city' in body)).toHaveLength(1);
  });

  it('saves on the new site a city committed while the site is written', async () => {
    const { drawer, finish } = await startWrite();
    const city = within(drawer).getByPlaceholderText('workspace.location.fields.cityPlaceholder');
    act(() => city.focus());
    fireEvent.change(city, { target: { value: 'Lorient' } });
    fireEvent.blur(city);
    await finish();
    expect(patchesWith('city', 'Lorient')).toHaveLength(1);
    const shown = within(screen.getByRole('complementary')).getByPlaceholderText('workspace.location.fields.cityPlaceholder') as HTMLInputElement;
    expect(shown.value).toBe('Lorient');
  });

  it('keeps the notes typed while the site is written: same editor, same focus, saved on the new site', async () => {
    const { finish } = await startWrite();
    const notes = screen.getByLabelText('markdown-editor');
    act(() => notes.focus());
    fireEvent.change(notes, { target: { value: 'Rack 4' } });
    await finish();

    const shown = screen.getByLabelText('markdown-editor') as HTMLTextAreaElement;
    expect(shown === notes).toBe(true);
    expect(document.activeElement === shown).toBe(true);
    expect(shown.value).toBe('Rack 4');
    expect(patchesWith('additional_info', 'Rack 4')).toHaveLength(1);
    fireEvent.change(shown, { target: { value: 'Rack 4, row B' } });
    await until(() => { if (patchesWith('additional_info', 'Rack 4, row B').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); }, 3000);
  });

  it('saves the notes typed in the last second when Create is clicked, once', async () => {
    const { finish } = await startWrite();
    await finish();
    const notes = screen.getByLabelText('markdown-editor');
    fireEvent.change(notes, { target: { value: 'Rack 4' } });
    expect(patchesWith('additional_info', 'Rack 4')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await until(() => { if (patchesWith('additional_info', 'Rack 4').length === 0) throw new Error(`patches: ${JSON.stringify(mocked.patch.mock.calls)}`); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
    expect(patchesWith('additional_info', 'Rack 4')).toHaveLength(1);
    expect(server.additional_info).toBe('Rack 4');
  });

  it('saves the notes typed in the last second before the cancel counts them, and writes nothing to the deleted site', async () => {
    const { finish } = await startWrite();
    await finish();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/locations/loc-new/creation') return { data: { changes: { fields: server.additional_info ? 1 : 0, children: {} } } };
      if (url === '/locations/LOC-9' || url === '/locations/loc-new') return { data: server };
      return { data: [] };
    });
    mocked.delete.mockResolvedValue({ data: {} });
    fireEvent.change(screen.getByLabelText('markdown-editor'), { target: { value: 'Rack 4' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));
    // The notes are saved first, so the confirmation lists them.
    await screen.findByRole('dialog');
    expect(patchesWith('additional_info', 'Rack 4')).toHaveLength(1);
    expect(mocked.delete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
    expect(patchesWith('additional_info', 'Rack 4')).toHaveLength(1);
  });

  it('shows the notes typed before another tab again when the Overview tab is opened, and types on from them', async () => {
    renderNew('/it/locations/LOC-9/overview');
    const notes = await screen.findByLabelText('markdown-editor');
    fireEvent.change(notes, { target: { value: 'Rack 4' } });
    fireEvent.click(screen.getByRole('tab', { name: 'workspace.location.tabs.contacts' }));
    await until(() => { if (patchesWith('additional_info', 'Rack 4').length === 0) throw new Error('not written'); });
    await until(() => expect(screen.queryByLabelText('markdown-editor')).toBeNull());
    fireEvent.click(screen.getByRole('tab', { name: 'workspace.location.tabs.overview' }));
    const back = (await screen.findByLabelText('markdown-editor')) as HTMLTextAreaElement;
    expect(back.value).toBe('Rack 4');
    fireEvent.change(back, { target: { value: 'Rack 4, row B' } });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)); });
    expect(patchesWith('additional_info', 'Rack 4, row B')).toHaveLength(1);
  });
});
