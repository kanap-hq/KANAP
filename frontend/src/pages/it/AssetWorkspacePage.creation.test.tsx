import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import NavigationTracker, { resetNavigationTracker } from '../../components/navigation/NavigationTracker';
import { resetCreationStore } from '../../components/workspace/creation/creationStore';
import api from '../../api';
import AssetWorkspacePage from './AssetWorkspacePage';
import { TITLE_FIELD } from '../../test/titleField';

// An asset is born complete (lot L3b of 26.11.9): its title, its type and its site are open on the
// new page, the rest is dimmed; nothing is written until the three are given, in any order, then one
// POST /assets writes it (the server gives the site's provider) and the page is the asset, with Done
// and Cancel. Create marks the type and the site still missing and puts the cursor in the first,
// without a call. Leaving writes nothing.

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => undefined } }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { vulnerabilityFeed: false } } }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: (_resource: string, level: string) => level !== 'admin' }) }));
// One object for every render, as the real hook memoises it.
const enumOptions = vi.hoisted(() => ({
  settings: {
    hostingTypes: [],
    serverKinds: [
      { code: 'physical_server', label: 'Physical server', is_physical: true },
      { code: 'virtual_machine', label: 'Virtual machine', is_physical: false },
    ],
    domains: [],
    subnets: [],
  },
  byField: {
    adminZone: [],
    serverKind: [{ code: 'physical_server', label: 'Physical server' }, { code: 'virtual_machine', label: 'Virtual machine' }],
    lifecycleStatus: [{ code: 'active', label: 'Active' }],
    serverRole: [],
    serverProvider: [{ code: 'on_prem', label: 'On premises' }],
    ipAddressType: [],
  },
  labelFor: (_field: string, code: string) => code,
}));
// The settings the page sees: `enumOptions` unless a test swaps them (a workspace catalog, settings
// still loading); a swap re-renders the page, as the real query does when they arrive.
const settingsStore = vi.hoisted(() => {
  let current: unknown = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next: unknown) => { current = next; listeners.forEach((listener) => listener()); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
});
vi.mock('../../hooks/useItOpsEnumOptions', async () => {
  const { useSyncExternalStore } = await import('react');
  return { default: () => useSyncExternalStore(settingsStore.subscribe, settingsStore.get) ?? enumOptions };
});
vi.mock('../../hooks/useAssetNav', () => ({
  useAssetNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('./editors/HardwareInfoPanel', () => ({ default: () => null }));
vi.mock('./editors/SupportInfoPanel', () => ({ default: () => null }));
vi.mock('./workspace/AssetRelationsTab', () => ({ default: () => null }));
vi.mock('./workspace/AssetDependenciesTab', () => ({ default: () => null }));
vi.mock('./components/AssetTechnologiesSection', async (importOriginal) => ({ ...(await importOriginal<any>()), default: () => null }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('../../components/fields/LocationSelect', () => ({
  default: ({ onChange, helperText }: { onChange: (value: string | null) => void; helperText?: React.ReactNode }) => (
    <>
      <input aria-label="site" />
      <button type="button" onClick={() => onChange('loc-1')}>pick-location</button>
      {helperText ? <span>{helperText}</span> : null}
    </>
  ),
}));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/MarkdownEditor', () => ({ default: () => <div data-testid="description-editor" /> }));
vi.mock('../../components/history/RecordHistoryTab', () => ({ default: () => null }));

const mocked = vi.mocked(api);
const TITLE = 'common:buttons.editTitle';
const created = {
  id: 'asset-new',
  asset_reference: 'AST-7',
  name: 'Web 1',
  kind: 'virtual_machine',
  provider: 'on_prem',
  environment: 'prod',
  status: 'active',
  is_cluster: false,
  hostname: 'web-1',
  location_id: 'loc-1',
  creation_token: 'token-1',
};
const detail = {
  ...created,
  creation_token: undefined,
  domain: '',
  admin_zone: '',
  fqdn: 'web-1',
  aliases: [],
  ip_addresses: [],
  go_live_date: null,
  end_of_life_date: null,
  notes: '',
  external_links: [],
};
// An asset written before 26.11.9 at its title, without a site.
const siteless = { ...detail, id: 'asset-old', asset_reference: 'AST-9', name: 'Old 1', location_id: null };

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function StartPage() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/it/assets/new/overview')}>new asset</button>;
}

function renderPage(entries: string[]) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/assets/by-ref/AST-7' || url === '/assets/asset-new') return { data: detail } as never;
    if (url === '/assets/by-ref/AST-9' || url === '/assets/asset-old') return { data: siteless } as never;
    if (url === '/assets/asset-new/creation') return { data: { changes: { fields: 0, children: {} } } } as never;
    if (url === '/locations') return { data: { items: [{ id: 'loc-1', location_reference: 'LOC-1', name: 'Paris' }] } } as never;
    if (url === '/locations/loc-1') return { data: { id: 'loc-1', location_reference: 'LOC-1', name: 'Paris', hosting_type: 'on_prem' } } as never;
    if (url.endsWith('/sub-items')) return { data: [] } as never;
    return { data: { items: [], outgoing: [], incoming: [] } } as never;
  });
  mocked.post.mockImplementation(async (url: string) => {
    if (url === '/assets') return { data: { ...created } } as never;
    return { data: { ok: true } } as never;
  });
  mocked.patch.mockImplementation(async (url: string, body?: unknown) => (
    { data: { ...(url === '/assets/asset-old' ? siteless : detail), ...(body as object) } }
  ) as never);
  mocked.delete.mockResolvedValue({ data: undefined } as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={entries}>
            <NavigationTracker />
            <Location />
            <Routes>
              <Route path="/start" element={<StartPage />} />
              <Route path="/it/assets" element={<div data-testid="asset-list" />} />
              <Route path="/it/assets/:id/:tab" element={<AssetWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function location() {
  return screen.getByTestId('location').textContent;
}

async function typeTitle(value: string) {
  const input = await screen.findByRole('textbox', { name: TITLE_FIELD });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

function pickSite() {
  fireEvent.click(screen.getByRole('button', { name: 'pick-location' }));
}

/** The type field of the properties panel. */
const typeField = () => screen.getByPlaceholderText<HTMLInputElement>('workspace.asset.overview.searchAssetTypes');

/** Chooses a type in the list of the type field. */
async function pickType(label = 'Virtual machine') {
  fireEvent.keyDown(typeField(), { key: 'ArrowDown' });
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

async function startNewAsset() {
  renderPage(['/start']);
  fireEvent.click(await screen.findByRole('button', { name: 'new asset' }));
  await screen.findByRole('textbox', { name: TITLE_FIELD });
}

/** A new asset given its name, its type and its site: written, and open with Done. */
async function createAsset() {
  await startNewAsset();
  await typeTitle('Web 1');
  await pickType();
  pickSite();
  await waitFor(() => expect(location()).toBe('/it/assets/AST-7/overview'));
  await screen.findByRole('button', { name: 'common:buttons.done' });
}

/** The label of a property row. */
function rowLabel(key: string): HTMLElement {
  const label = [...document.querySelectorAll<HTMLElement>('.kanap-field-label')].find((el) => el.textContent?.startsWith(key));
  if (!label) throw new Error(`no label ${key}`);
  return label;
}
const siteLabel = () => rowLabel('workspace.asset.overview.location');
const typeLabel = () => rowLabel('workspace.asset.overview.assetType');
const dimmed = (el: Element) => !!el.closest('[data-testid="creation-preview"]');
const assetPosts = () => mocked.post.mock.calls.filter(([url]) => url === '/assets');

describe('An asset born complete', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetCreationStore();
    resetNavigationTracker();
    settingsStore.set(null);
  });

  it('opens with its title, its type and its site to give, every other row dimmed and out of reach, nothing written', async () => {
    renderPage(['/it/assets/new/overview']);
    const input = await screen.findByRole('textbox', { name: TITLE_FIELD });
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common.close' })).toBeNull();
    // The site: its row of the properties panel and its menu in the metadata bar.
    expect(dimmed(screen.getByRole('textbox', { name: 'site' }))).toBe(false);
    expect(dimmed(siteLabel())).toBe(false);
    const siteMenu = screen.getByTitle('workspace.asset.meta.editLocation');
    expect(dimmed(siteMenu)).toBe(false);
    expect(siteMenu.tagName).toBe('BUTTON');
    // The type: its row, empty with no type chosen for the person, and its item in the metadata bar.
    expect(dimmed(typeField())).toBe(false);
    expect(typeField().value).toBe('');
    expect(dimmed(typeLabel())).toBe(false);
    expect(typeLabel().closest('[data-required-field]')).toBeTruthy();
    const typeMenu = screen.getByTitle('workspace.asset.meta.editAssetType');
    expect(dimmed(typeMenu)).toBe(false);
    expect(typeMenu.tagName).toBe('BUTTON');
    // With no type, the item says what it is: "not set" alone names nothing.
    expect(typeMenu.textContent).toContain('workspace.asset.overview.assetType');
    // The rest, row by row.
    for (const key of ['workspace.asset.meta.cluster', 'workspace.asset.technical.environment', 'workspace.asset.overview.lifecycle', 'workspace.asset.overview.goLiveDate']) {
      expect(dimmed(rowLabel(key))).toBe(true);
    }
    expect(dimmed(screen.getByTestId('description-editor'))).toBe(true);
    const previews = screen.getAllByTestId('creation-preview');
    expect(previews.length).toBeGreaterThan(3);
    for (const preview of previews) {
      expect(preview).toHaveAttribute('inert');
      expect(within(preview).queryAllByRole('textbox')).toHaveLength(0);
    }
    for (const tab of screen.getAllByRole('tab').slice(1)) expect(tab).toBeDisabled();
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('writes nothing for a name alone', async () => {
    await startNewAsset();
    await typeTitle('Web 1');
    fireEvent.keyDown(await screen.findByRole('textbox', { name: TITLE_FIELD }), { key: 'Tab' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.post).not.toHaveBeenCalled();
    expect(location()).toBe('/it/assets/new/overview');
  });

  it('writes nothing for a site alone', async () => {
    await startNewAsset();
    pickSite();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('writes nothing for a name and a site without a type', async () => {
    await startNewAsset();
    await typeTitle('Web 1');
    pickSite();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.post).not.toHaveBeenCalled();
    expect(location()).toBe('/it/assets/new/overview');
  });

  it('writes nothing for a name and a type without a site', async () => {
    await startNewAsset();
    await typeTitle('Web 1');
    await pickType();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.post).not.toHaveBeenCalled();
    expect(location()).toBe('/it/assets/new/overview');
  });

  it('writes the asset with the type chosen, whatever the order the three are given in', async () => {
    await startNewAsset();
    pickSite();
    await pickType('Physical server');
    expect(mocked.post).not.toHaveBeenCalled();
    await typeTitle('Web 1');
    await waitFor(() => expect(location()).toBe('/it/assets/AST-7/overview'));
    expect(assetPosts()).toHaveLength(1);
    expect(assetPosts()[0][1]).toMatchObject({ name: 'Web 1', kind: 'physical_server', location_id: 'loc-1' });
  });

  it('writes the asset when its type is chosen last, in the metadata bar', async () => {
    await startNewAsset();
    await typeTitle('Web 1');
    pickSite();
    const typeMenu = screen.getByTitle('workspace.asset.meta.editAssetType');
    fireEvent.focusOut(screen.getByRole('textbox', { name: TITLE_FIELD }), { relatedTarget: typeMenu });
    fireEvent.click(typeMenu);
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Physical server' }));
    await waitFor(() => expect(location()).toBe('/it/assets/AST-7/overview'));
    expect(assetPosts()).toHaveLength(1);
    expect(assetPosts()[0][1]).toMatchObject({ kind: 'physical_server' });
  });

  it('marks nothing when a choice in the metadata bar leaves the draft incomplete', async () => {
    await startNewAsset();
    await typeTitle('Web 1');
    const siteMenu = screen.getByTitle('workspace.asset.meta.editLocation');
    fireEvent.focusOut(screen.getByRole('textbox', { name: TITLE_FIELD }), { relatedTarget: siteMenu });
    fireEvent.click(siteMenu);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Paris/ }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(typeLabel()).not.toHaveAttribute('data-missing');
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('writes the asset once with its name and its site, then shows it with Done and Cancel', async () => {
    await createAsset();
    expect(assetPosts()).toHaveLength(1);
    expect(mocked.post).toHaveBeenCalledWith('/assets', {
      name: 'Web 1',
      kind: 'virtual_machine',
      environment: 'prod',
      status: 'active',
      is_cluster: false,
      hostname: 'web-1',
      location_id: 'loc-1',
    });
    // The provider is the site's: the server sets it, the screen names none.
    expect(assetPosts()[0][1]).not.toHaveProperty('provider');
    expect(mocked.post).not.toHaveBeenCalledWith('/assets/creation', expect.anything());
    expect(screen.queryByTestId('creation-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: TITLE })).toHaveTextContent('Web 1');
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('writes the asset when its site is chosen in the metadata bar', async () => {
    await startNewAsset();
    await typeTitle('Web 1');
    await pickType();
    const siteMenu = screen.getByTitle('workspace.asset.meta.editLocation');
    // A press on the bar takes the focus from the title: a leave of the title, which gives nothing.
    fireEvent.focusOut(screen.getByRole('textbox', { name: TITLE_FIELD }), { relatedTarget: siteMenu });
    fireEvent.click(siteMenu);
    fireEvent.click(await screen.findByRole('menuitem', { name: /Paris/ }));
    await waitFor(() => expect(location()).toBe('/it/assets/AST-7/overview'));
    expect(assetPosts()).toHaveLength(1);
    expect(assetPosts()[0][1]).toMatchObject({ name: 'Web 1', location_id: 'loc-1' });
  });

  it('writes the asset when the site is given before the name', async () => {
    await startNewAsset();
    await pickType();
    pickSite();
    await typeTitle('Web 1');
    await waitFor(() => expect(location()).toBe('/it/assets/AST-7/overview'));
    expect(assetPosts()).toHaveLength(1);
  });

  it('marks the type and the site on Create without them and puts the cursor in the type, without a call', async () => {
    await startNewAsset();
    const input = screen.getByRole('textbox', { name: TITLE_FIELD });
    fireEvent.change(input, { target: { value: 'Web 1' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(typeField()).toHaveFocus());
    expect(typeLabel()).toHaveAttribute('data-missing');
    expect(typeField()).toHaveAttribute('aria-invalid', 'true');
    expect(siteLabel()).toHaveAttribute('data-missing');
    expect(mocked.post).not.toHaveBeenCalled();
    // The type given: its mark goes; Create again goes to the site.
    await pickType();
    await waitFor(() => expect(typeLabel()).not.toHaveAttribute('data-missing'));
    expect(mocked.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'site' })).toHaveFocus());
    expect(siteLabel()).toHaveAttribute('data-missing');
    expect(screen.getByRole('textbox', { name: 'site' })).toHaveAttribute('aria-invalid', 'true');
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(location()).toBe('/it/assets/new/overview');
    // The site given: the mark goes and the asset is written.
    pickSite();
    await waitFor(() => expect(location()).toBe('/it/assets/AST-7/overview'));
    expect(assetPosts()).toHaveLength(1);
  });

  it('writes a cluster when the list asked for one, once its type is given too', async () => {
    renderPage(['/it/assets/new/overview?cluster=1']);
    await typeTitle('Web 1');
    pickSite();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.post).not.toHaveBeenCalled();
    await pickType();
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets', expect.objectContaining({ is_cluster: true, kind: 'virtual_machine', location_id: 'loc-1' })));
  });

  it('shows a refusal of the type under the type, and does not send the same draft again', async () => {
    await startNewAsset();
    mocked.post.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Invalid kind "virtual_machine"' } } });
    await typeTitle('Web 1');
    await pickType();
    pickSite();
    await waitFor(() => expect(typeLabel().closest('[data-required-field]')?.textContent).toMatch(/Invalid kind/));
    expect(screen.queryByRole('alert')).toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(assetPosts()).toHaveLength(1);
    // Another type is a new draft: written.
    await pickType('Physical server');
    await waitFor(() => expect(location()).toBe('/it/assets/AST-7/overview'));
    expect(assetPosts()[1][1]).toMatchObject({ kind: 'physical_server' });
  });

  it('shows a refusal of the name under the title, keeps the draft and does not send it again', async () => {
    await startNewAsset();
    mocked.post.mockRejectedValueOnce({ response: { status: 409, data: { code: 'asset_name_taken', message: 'An asset already has this name: AST-2', params: { ref: 'AST-2' } } } });
    await typeTitle('Web 1');
    await pickType();
    pickSite();
    expect(await screen.findByRole('alert')).toHaveTextContent(/asset_name_taken/);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(assetPosts()).toHaveLength(1);
    expect(location()).toBe('/it/assets/new/overview');
    // Another name is a new draft: written.
    await typeTitle('Web 2');
    await waitFor(() => expect(location()).toBe('/it/assets/AST-7/overview'));
    expect(assetPosts()).toHaveLength(2);
    expect(assetPosts()[1][1]).toMatchObject({ name: 'Web 2', location_id: 'loc-1' });
  });

  it('shows a refusal of the site on the site', async () => {
    await startNewAsset();
    mocked.post.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Invalid location_id' } } });
    await typeTitle('Web 1');
    await pickType();
    pickSite();
    await waitFor(() => expect(siteLabel().closest('[data-required-field]')?.textContent).toMatch(/Invalid location_id/));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(assetPosts()).toHaveLength(1);
  });

  it('leaves a new asset by the way back with nothing written and no question', async () => {
    await startNewAsset();
    await typeTitle('Web 1');
    fireEvent.click(screen.getByRole('button', { name: 'pages.assets.title' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('closes the asset on Done, back where the creation started, with no other call', async () => {
    await createAsset();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.done' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(assetPosts()).toHaveLength(1);
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('deletes the asset on Cancel just after it is written and goes back where it started', async () => {
    await createAsset();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.delete).toHaveBeenCalledWith('/assets/asset-new/creation', { data: { token: 'token-1' } });
    // The asset is gone: the page does not read it again on its way out.
    const deletedAt = mocked.delete.mock.invocationCallOrder[0];
    const readsAfter = mocked.get.mock.calls.filter(([url], i) => (
      mocked.get.mock.invocationCallOrder[i] > deletedAt && (url === '/assets/by-ref/AST-7' || url === '/assets/asset-new')
    ));
    expect(readsAfter).toEqual([]);
  });

  it('does not read the asset again when Done closes it', async () => {
    await createAsset();
    const readsBefore = mocked.get.mock.calls.filter(([url]) => url === '/assets/by-ref/AST-7').length;
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.done' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.get.mock.calls.filter(([url]) => url === '/assets/by-ref/AST-7')).toHaveLength(readsBefore);
  });

  it('opens an asset written without a site with its site marked missing, and takes one', async () => {
    renderPage(['/it/assets/AST-9/overview']);
    await screen.findByRole('button', { name: TITLE });
    await waitFor(() => expect(siteLabel()).toHaveAttribute('data-missing'));
    expect(screen.queryByTestId('creation-preview')).toBeNull();
    expect(screen.queryByRole('button', { name: 'common:buttons.done' })).toBeNull();
    pickSite();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/assets/asset-old', { location_id: 'loc-1', sub_location_id: null }));
    await waitFor(() => expect(siteLabel()).not.toHaveAttribute('data-missing'));
    // Leaving asks nothing.
    fireEvent.click(screen.getByRole('button', { name: 'pages.assets.title' }));
    await waitFor(() => expect(location()).toBe('/it/assets'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
