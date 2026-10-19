import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import ItOperationsSettingsPage, { AdminZonesEditor, autosaveBlocked, initialState, reducer, reorderById } from './ItOperationsSettingsPage';
import DomainTrustsDialog from './components/DomainTrustsDialog';
import api from '../../api';
import type { DomainOption, ItOpsSettings } from '../../services/itOpsSettings';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const patch = (api as unknown as { patch: ReturnType<typeof vi.fn> }).patch;

const stableT = (key: string, options?: Record<string, unknown>) => (options?.name ? `${key}:${options.name}` : key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { total: 0, usage: [] } })), patch: vi.fn(), post: vi.fn() } }));

function wrap(children: React.ReactNode) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <KanapDialogProvider>{children}</KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const settings = {
  adminZones: [{ code: 'tier_0', label: 'Tier 0', deprecated: false, admin_group: 'Domain admins' }],
  connectionTypes: [], subnets: [], domains: [], lockedCodes: {}, protectedCodes: {},
} as unknown as ItOpsSettings;

describe('Administration zones settings', () => {
  it('hydrates the zones and marks an attribute change as a modification', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    expect(state.enums.adminZones.map((row: any) => [row.code, row.admin_group])).toEqual([['tier_0', 'Domain admins']]);
    state = reducer(state, { type: 'setEnum', id: 'adminZones', items: state.enums.adminZones.map((row) => ({ ...row, description: 'Identity core' })) });
    expect(state.dirty.adminZones).toBe(true);
    state = reducer(state, { type: 'setEnum', id: 'adminZones', items: state.enums.adminZones.map(({ description: _d, ...row }: any) => row) });
    expect(state.dirty.adminZones).toBe(false);
  });

  it('does not resend rows the server refused until they are edited again', () => {
    let state = reducer(initialState, { type: 'hydrate', payload: settings });
    const tooLong = state.enums.adminZones.map((row) => ({ ...row, description: 'x'.repeat(2001) }));
    state = reducer(state, { type: 'setEnum', id: 'adminZones', items: tooLong });
    expect(autosaveBlocked(state, 'adminZones')).toBe(false);
    state = reducer(state, { type: 'rejected', id: 'adminZones', sent: tooLong.map(({ localId: _l, ...row }) => row) });
    expect(state.dirty.adminZones).toBe(true);
    expect(autosaveBlocked(state, 'adminZones')).toBe(true);
    expect(autosaveBlocked(state, 'domains')).toBe(false);
    const fixed = state.enums.adminZones.map((row) => ({ ...row, description: 'Identity core' }));
    state = reducer(state, { type: 'setEnum', id: 'adminZones', items: fixed });
    expect(autosaveBlocked(state, 'adminZones')).toBe(false);
  });

  it('says the first zone is the most sensitive and offers a grip on each row', () => {
    wrap(<AdminZonesEditor items={[
      { code: 'tier_0', label: 'Tier 0', deprecated: false },
      { code: 'tier_1', label: 'Tier 1', deprecated: false },
    ]} onChange={vi.fn()} />);
    expect(screen.getByText('pages.settings.lists.adminZones.orderHint')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'pages.settings.lists.adminZones.dragToReorder' })).toHaveLength(2);
  });

  it('reorders rows by their id and leaves the list untouched when nothing moves', () => {
    const items = [
      { localId: 'a', code: 'tier_2' },
      { localId: 'b', code: 'tier_0' },
      { localId: 'c', code: 'tier_1' },
    ];
    expect(reorderById(items, 'c', 'a').map((row) => row.code)).toEqual(['tier_1', 'tier_2', 'tier_0']);
    expect(reorderById(items, 'a', 'missing')).toBe(items);
    expect(reorderById(items, 'a', 'a')).toBe(items);
  });

  it('limits each field to what the server accepts', () => {
    wrap(<AdminZonesEditor items={settings.adminZones} onChange={vi.fn()} />);
    const limit = (name: string) => screen.getByRole('textbox', { name }).getAttribute('maxlength');
    expect(limit('pages.settings.columns.adminGroup Tier 0')).toBe('200');
    expect(limit('pages.settings.columns.description Tier 0')).toBe('2000');
  });

  it('marks Name as required and does not show a helper under an empty name', () => {
    wrap(<AdminZonesEditor items={[{ code: '', label: '', deprecated: false }]} onChange={vi.fn()} />);
    expect(screen.getByRole('columnheader', { name: /common:enumEditor.name/ })).toHaveTextContent('*');
    expect(screen.queryByText('common:enumEditor.nameRequired')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'common:enumEditor.name' })).toBeRequired();
  });

  it('keeps a non-alphabetical zone order on load and on reset', () => {
    const zones = [
      { code: 'zone_b', label: 'Zone B', deprecated: false },
      { code: 'zone_a', label: 'Zone A', deprecated: false },
    ];
    const payload = {
      ...settings,
      adminZones: zones,
      technologyFamilies: [
        { code: 'directory', label: 'Directory', deprecated: false },
        { code: 'database', label: 'Database', deprecated: false },
      ],
    } as ItOpsSettings;
    let state = reducer(initialState, { type: 'hydrate', payload });
    expect(state.enums.adminZones.map((row) => row.label)).toEqual(['Zone B', 'Zone A']);
    const reordered = [state.enums.adminZones[1], state.enums.adminZones[0]];
    state = reducer(state, { type: 'setEnum', id: 'adminZones', items: reordered });
    state = reducer(state, { type: 'resetEnum', id: 'adminZones' });
    expect(state.enums.adminZones.map((row) => row.label)).toEqual(['Zone B', 'Zone A']);
    expect(state.enums.technologyFamilies.map((row) => row.code)).toEqual(['database', 'directory']);
  });

  it('edits a zone in place and says when the list is empty', async () => {
    const onChange = vi.fn();
    const { unmount } = wrap(<AdminZonesEditor items={settings.adminZones} onChange={onChange} />);
    expect(screen.getByDisplayValue('Domain admins')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'pages.settings.columns.description Tier 0' }), { target: { value: 'Identity core' } });
    await vi.waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange.mock.calls[onChange.mock.calls.length - 1][0][0]).toMatchObject({ code: 'tier_0', description: 'Identity core', admin_group: 'Domain admins' });
    unmount();
    wrap(<AdminZonesEditor items={[]} onChange={vi.fn()} />);
    expect(screen.getByText('pages.settings.empty.adminZones')).toBeInTheDocument();
  });
});

describe('Domain trusts dialog', () => {
  const domains: DomainOption[] = [
    { code: 'workgroup', label: 'Workgroup', dns_suffix: '', system: true },
    { code: 'corp', label: 'Corp', dns_suffix: 'corp.example.com', trusts: [{ domain: 'lab', direction: 'two_way' }] },
    { code: 'lab', label: 'Lab', dns_suffix: 'lab.example.com' },
    { code: 'partner', label: 'Partner', dns_suffix: 'partner.example.com', trusts: [{ domain: 'corp', direction: 'outgoing' }] },
    { code: '', label: 'Unsaved', dns_suffix: '' },
  ];

  it('changes a direction, adds a trusted domain among the other saved ones, and saves', () => {
    const onSave = vi.fn();
    wrap(<DomainTrustsDialog domain={domains[1]} domains={domains} onClose={vi.fn()} onSave={onSave} />);
    expect(screen.getByText('Lab')).toBeInTheDocument();
    expect(screen.getByText('pages.settings.trusts.directionsHint')).toBeInTheDocument();
    // Partner trusts Corp: shown read only on Corp as an incoming trust.
    expect(screen.getByText('pages.settings.trusts.declaredElsewhere')).toBeInTheDocument();
    expect(screen.getByText('Partner (pages.settings.trusts.directions.incoming)')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'pages.settings.trusts.direction Lab' }));
    fireEvent.click(screen.getByRole('option', { name: 'pages.settings.trusts.directions.outgoing' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'pages.settings.trusts.add' }));
    expect(within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent)).toEqual(['Partner']);
    fireEvent.click(screen.getByRole('option', { name: 'Partner' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));
    expect(onSave).toHaveBeenCalledWith([{ domain: 'lab', direction: 'outgoing' }, { domain: 'partner', direction: 'two_way' }]);
  });

  it('saves no trusts as absent after removing the last one', () => {
    const onSave = vi.fn();
    wrap(<DomainTrustsDialog domain={domains[1]} domains={domains} onClose={vi.fn()} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: 'common:enumEditor.remove Lab' }));
    expect(screen.getByText('pages.settings.trusts.empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.save' }));
    expect(onSave).toHaveBeenCalledWith(undefined);
  });
});

const ZONE_ORDER = [
  { code: 'zone_b', label: 'Zone B', deprecated: false },
  { code: 'zone_c', label: 'Zone C', deprecated: false },
  { code: 'zone_a', label: 'Zone A', deprecated: false },
];

const pageSettings = {
  adminZones: ZONE_ORDER,
  applicationCategories: [], dataClasses: [], networkSegments: [], entities: [], serverKinds: [],
  serverProviders: [], serverRoles: [], hostingTypes: [], lifecycleStates: [], interfaceProtocols: [],
  interfaceDataCategories: [], interfaceTriggerTypes: [], interfacePatterns: [], interfaceFormats: [],
  interfaceAuthModes: [], connectionTypes: [], subnets: [], domains: [], ipAddressTypes: [],
  accessMethods: [], incidentCategories: [], technologyFamilies: [],
  businessCriticalityLevels: [], cyberCriticalityLevels: [], recoveryWaves: [],
  lockedCodes: {}, protectedCodes: {},
} as unknown as ItOpsSettings;

function adminZoneTable(): HTMLTableElement | null {
  const hint = Array.from(document.querySelectorAll('p')).find((node) => node.textContent === 'pages.settings.lists.adminZones.orderHint');
  return (hint?.closest('.MuiPaper-root')?.querySelector('table') as HTMLTableElement | undefined) ?? null;
}

function requireZoneTable() {
  const table = adminZoneTable();
  if (!table) throw new Error('administration zones table not found');
  return table;
}

function zoneLabels() {
  const table = adminZoneTable();
  if (!table) return [];
  return within(table).getAllByRole('textbox', { name: 'common:enumEditor.name' }).map((field) => (field as HTMLInputElement).value);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Picks the row up with Space, moves it once, and drops it. The keyboard sensor listens on the document. */
async function keyboardMove(handle: HTMLElement, arrow: 'ArrowUp' | 'ArrowDown') {
  handle.focus();
  await act(async () => { fireEvent.keyDown(handle, { key: ' ', code: 'Space' }); await tick(); });
  await act(async () => { fireEvent.keyDown(document, { key: arrow, code: arrow }); await tick(); });
  await act(async () => { fireEvent.keyDown(document, { key: ' ', code: 'Space' }); await tick(); });
}

describe('Administration zone order on the settings page', () => {
  afterEach(() => {
    get.mockReset();
    patch.mockReset();
    get.mockImplementation(async () => ({ data: { total: 0, usage: [] } }));
    vi.restoreAllMocks();
  });

  it('loads Zone B before Zone A, keeps that order after a description edit, and saves a drag as shown', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/it-ops/settings') return { data: pageSettings };
      if (String(url).startsWith('/locations')) return { data: { items: [] } };
      return { data: { total: 0, usage: [] } };
    });
    patch.mockImplementation(async (_url: string, body: Partial<ItOpsSettings>) => ({ data: { ...pageSettings, ...body } }));
    // jsdom lays nothing out: each table row stands 36px under the previous one, so the keyboard sensor finds it.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const index = this.tagName === 'TR' && this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : -1;
      const top = index < 0 ? 0 : index * 36;
      const height = index < 0 ? 0 : 36;
      return { x: 0, y: top, top, left: 0, width: 400, height, right: 400, bottom: top + height, toJSON() { return {}; } } as DOMRect;
    });

    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <MemoryRouter>
            <KanapDialogProvider>
              <ItOperationsSettingsPage />
            </KanapDialogProvider>
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );

    // The catalog editors stay unmounted until their section is opened.
    fireEvent.click(await screen.findByRole('button', { name: /pages.settings.lists.adminZones.title/ }));
    await waitFor(() => expect(zoneLabels()).toEqual(['Zone B', 'Zone C', 'Zone A']));
    fireEvent.change(within(requireZoneTable()).getByRole('textbox', { name: 'pages.settings.columns.description Zone B' }), { target: { value: 'Identity core' } });
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const saved = patch.mock.calls.map((call) => call[1]).find((body) => Array.isArray(body?.adminZones));
    expect(saved.adminZones.map((zone: { code: string; description?: string }) => [zone.code, zone.description ?? null])).toEqual([
      ['zone_b', 'Identity core'],
      ['zone_c', null],
      ['zone_a', null],
    ]);
    expect(zoneLabels()).toEqual(['Zone B', 'Zone C', 'Zone A']);
    // The saved list comes back without row ids, and the page mints new ones. Wait until that
    // refresh has landed: dragging across it leaves the sensor holding an id the rows no longer use.
    await screen.findByText('pages.settings.updateSuccess');
    await act(async () => { await tick(); });
    expect(zoneLabels()).toEqual(['Zone B', 'Zone C', 'Zone A']);

    const handles = within(requireZoneTable()).getAllByRole('button', { name: 'pages.settings.lists.adminZones.dragToReorder' });
    await keyboardMove(handles[2], 'ArrowUp');
    expect(zoneLabels()).toEqual(['Zone B', 'Zone A', 'Zone C']);
    await waitFor(() => expect(patch.mock.calls.filter((call) => Array.isArray(call[1]?.adminZones))).toHaveLength(2));
    const draggedBodies = patch.mock.calls.map((call) => call[1]).filter((body) => Array.isArray(body?.adminZones));
    const dragged = draggedBodies[draggedBodies.length - 1];
    expect(dragged.adminZones.map((zone: { label: string }) => zone.label)).toEqual(['Zone B', 'Zone A', 'Zone C']);
    expect(dragged.adminZones[0].description).toBe('Identity core');
  }, 20000);
});
