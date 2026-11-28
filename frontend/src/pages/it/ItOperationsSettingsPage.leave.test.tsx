import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import ItOperationsSettingsPage from './ItOperationsSettingsPage';
import api from '../../api';
import { confirmLeave, isLeaveGuarded } from '../../hooks/leaveGuard';
import type { ItOpsSettings } from '../../services/itOpsSettings';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const patch = (api as unknown as { patch: ReturnType<typeof vi.fn> }).patch;

const stableT = (key: string, options?: Record<string, unknown>) => (options?.name ? `${key}:${options.name}` : key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true }),
}));

const pageSettings = {
  adminZones: [],
  applicationCategories: [], dataClasses: [], networkSegments: [], entities: [], serverKinds: [],
  serverProviders: [], serverRoles: [], hostingTypes: [], lifecycleStates: [], interfaceProtocols: [],
  interfaceDataCategories: [], interfaceTriggerTypes: [], interfacePatterns: [], interfaceFormats: [],
  interfaceAuthModes: [], connectionTypes: [], subnets: [], domains: [], ipAddressTypes: [],
  accessMethods: [], incidentCategories: [], technologyFamilies: [],
  businessCriticalityLevels: [], cyberCriticalityLevels: [], recoveryWaves: [],
  lockedCodes: {}, protectedCodes: {},
} as unknown as ItOpsSettings;

const wait = (ms: number) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

function renderPage() {
  return render(
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
}

/** Opens a list and adds an empty row to it; returns the list's panel. */
async function addRow(listId: string) {
  const title = await screen.findByRole('button', { name: new RegExp(`pages.settings.lists.${listId}.title`) });
  // Let the settings load first: the first load replaces the lists.
  await wait(50);
  fireEvent.click(title);
  const section = title.closest('.MuiAccordion-root') as HTMLElement;
  fireEvent.click(within(section).getByRole('button', { name: /settingsSection.addItem/ }));
  return section;
}

/**
 * Types like a keystroke in the browser, outside `act`: the editor commits its own row at once and hands the
 * page its rows in a transition, which is still pending when the page is left right after.
 */
async function typeOutsideAct(field: HTMLElement, value: string) {
  const previous = (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
  try {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setValue.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    // The keystroke's own render runs in a microtask; the transition waits for the scheduler's next task.
    await Promise.resolve();
    await Promise.resolve();
  } finally {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

const sentLists = (id: string) => patch.mock.calls.map((call) => call[1]).filter((body) => Array.isArray(body?.[id]));

describe('Saving the IT landscape lists', () => {
  beforeEach(() => {
    get.mockImplementation(async (url: string) => {
      if (url === '/it-ops/settings') return { data: pageSettings };
      if (String(url).startsWith('/locations')) return { data: { items: [] } };
      return { data: { total: 0, usage: [] } };
    });
    patch.mockImplementation(async (_url: string, body: Partial<ItOpsSettings>) => ({ data: { ...pageSettings, ...body } }));
  });

  afterEach(() => {
    get.mockReset();
    patch.mockReset();
    vi.restoreAllMocks();
  });

  it.each([
    ['connectionTypes', 'common:enumEditor.name', 'HTTPS', 'label'],
    ['subnets', 'pages.settings.placeholders.cidr', '10.0.0.0/24', 'cidr'],
    ['domains', 'common:enumEditor.name', 'corp', 'label'],
    ['accessMethods', 'enumEditor.name', 'Kiosk', 'label'],
  ])('saves the value typed last in %s, once', async (listId, field, value, key) => {
    const view = renderPage();
    const section = await addRow(listId);
    const input = listId === 'subnets'
      ? await within(section).findByPlaceholderText(field)
      : await within(section).findByRole('textbox', { name: field });
    await typeOutsideAct(input, value);
    view.unmount();
    await wait(50);
    const sent = sentLists(listId);
    expect(sent).toHaveLength(1);
    expect(sent[0][listId][0][key]).toBe(value);
    await wait(900);
    expect(sentLists(listId)).toHaveLength(1);
  }, 20000);

  it('keeps the value typed last when a row is added right after', async () => {
    renderPage();
    const section = await addRow('connectionTypes');
    await typeOutsideAct(await within(section).findByRole('textbox', { name: 'common:enumEditor.name' }), 'HTTPS');
    fireEvent.click(within(section).getByRole('button', { name: /settingsSection.addItem/ }));
    await wait(50);
    const names = within(section).getAllByRole('textbox', { name: 'common:enumEditor.name' }).map((node) => (node as HTMLInputElement).value);
    expect(names).toEqual(['', 'HTTPS']);
  }, 20000);

  it.each([
    ['sends the value typed during a save in flight once that save returns, with the code it brought', 'HTTPS', 2],
    ['sends nothing more when nothing was typed during the save in flight', null, 1],
  ])('%s', async (_name, further, expectedCalls) => {
    let release: (() => void) | undefined;
    patch.mockImplementation((_url: string, body: Partial<ItOpsSettings>) => {
      const saved = { data: { ...pageSettings, ...body, connectionTypes: (body.connectionTypes || []).map((row) => ({ ...row, code: row.code || 'http' })) } };
      if (patch.mock.calls.length > 1) return Promise.resolve(saved);
      return new Promise((resolve) => { release = () => resolve(saved); });
    });
    const view = renderPage();
    const section = await addRow('connectionTypes');
    const input = await within(section).findByRole('textbox', { name: 'common:enumEditor.name' });
    fireEvent.change(input, { target: { value: 'HTTP' } });
    await wait(900);
    expect(sentLists('connectionTypes')).toHaveLength(1);
    expect(sentLists('connectionTypes')[0].connectionTypes[0].label).toBe('HTTP');
    if (further) await typeOutsideAct(input, further);
    view.unmount();
    await wait(50);
    expect(sentLists('connectionTypes')).toHaveLength(1);
    await act(async () => { release?.(); });
    await wait(50);
    const sent = sentLists('connectionTypes');
    expect(sent).toHaveLength(expectedCalls);
    if (further) expect(sent[1].connectionTypes[0]).toMatchObject({ code: 'http', label: further });
    await wait(900);
    expect(sentLists('connectionTypes')).toHaveLength(expectedCalls);
  }, 20000);

  it('holds an in-app move while a typed value waits, and sends it first', async () => {
    renderPage();
    const section = await addRow('accessMethods');
    fireEvent.change(await within(section).findByRole('textbox', { name: 'enumEditor.name' }), { target: { value: 'Kiosk' } });
    expect(isLeaveGuarded()).toBe(true);
    let allowed = false;
    await act(async () => { allowed = await confirmLeave(); });
    expect(allowed).toBe(true);
    expect(sentLists('accessMethods')).toHaveLength(1);
    expect(sentLists('accessMethods')[0].accessMethods.map((row: { label: string }) => row.label)).toEqual(['Kiosk']);
  }, 20000);

  it('sends a list in its stored order, unsorted', async () => {
    const stored = { ...pageSettings, connectionTypes: [{ code: 'ssh', label: 'SSH', category: 'Remote', deprecated: false }, { code: 'http', label: 'HTTP', category: 'Application', deprecated: false }] };
    get.mockImplementation(async (url: string) => {
      if (url === '/it-ops/settings') return { data: stored };
      if (String(url).startsWith('/locations')) return { data: { items: [] } };
      return { data: { total: 0, usage: [] } };
    });
    patch.mockImplementation(async (_url: string, body: Partial<ItOpsSettings>) => ({ data: { ...stored, ...body } }));
    renderPage();
    const title = await screen.findByRole('button', { name: /pages.settings.lists.connectionTypes.title/ });
    await wait(50);
    fireEvent.click(title);
    const section = title.closest('.MuiAccordion-root') as HTMLElement;
    const names = await within(section).findAllByRole('textbox', { name: 'common:enumEditor.name' });
    expect(names.map((node) => (node as HTMLInputElement).value)).toEqual(['SSH', 'HTTP']);
    fireEvent.change(names[1], { target: { value: 'HTTP/2' } });
    fireEvent.blur(names[1]);
    await wait(50);
    expect(sentLists('connectionTypes')[0].connectionTypes.map((row: { code: string }) => row.code)).toEqual(['ssh', 'http']);
  }, 20000);

  it('shows the stored rows again and the refusal under the list when the server refuses a save', async () => {
    const stored = { ...pageSettings, accessMethods: [{ code: 'web', label: 'Web', deprecated: false }] };
    get.mockImplementation(async (url: string) => {
      if (url === '/it-ops/settings') return { data: stored };
      if (String(url).startsWith('/locations')) return { data: { items: [] } };
      return { data: { total: 0, usage: [] } };
    });
    patch.mockRejectedValue({ response: { status: 400, data: { message: 'Access methods: "Browser" clashes with "Web"' } } });
    renderPage();
    const title = await screen.findByRole('button', { name: /pages.settings.lists.accessMethods.title/ });
    await wait(50);
    fireEvent.click(title);
    const section = title.closest('.MuiAccordion-root') as HTMLElement;
    const name = await within(section).findByRole('textbox', { name: 'enumEditor.name' });
    fireEvent.change(name, { target: { value: 'Browser' } });
    fireEvent.blur(name);
    expect(await within(section).findByRole('alert')).toHaveTextContent('clashes with');
    expect((within(section).getByRole('textbox', { name: 'enumEditor.name' }) as HTMLInputElement).value).toBe('Web');
    expect(screen.getByRole('status')).toHaveTextContent('common:status.notSaved');
    fireEvent.change(within(section).getByRole('textbox', { name: 'enumEditor.name' }), { target: { value: 'Web app' } });
    expect(within(section).queryByRole('alert')).not.toBeInTheDocument();
  }, 20000);

  it('sends nothing when nothing was changed', async () => {
    const view = renderPage();
    await screen.findByRole('button', { name: /pages.settings.lists.connectionTypes.title/ });
    view.unmount();
    await wait(900);
    expect(patch).not.toHaveBeenCalled();
  });

  it.each([
    ['connectionTypes', 'common:enumEditor.name', 'HTTPS', 'label'],
    ['subnets', 'pages.settings.placeholders.cidr', '10.0.0.0/24', 'cidr'],
    ['accessMethods', 'enumEditor.name', 'Kiosk', 'label'],
  ])('drops a blank row of %s on leaving and saves the rest', async (listId, field, value, key) => {
    const view = renderPage();
    const section = await addRow(listId);
    const find = () => (listId === 'subnets'
      ? within(section).findAllByPlaceholderText(field)
      : within(section).findAllByRole('textbox', { name: field }));
    fireEvent.change((await find())[0], { target: { value } });
    await wait(50);
    fireEvent.click(within(section).getByRole('button', { name: /settingsSection.addItem/ }));
    expect(await find()).toHaveLength(2);
    view.unmount();
    await wait(50);
    const sent = sentLists(listId);
    expect(sent).toHaveLength(1);
    expect(sent[0][listId].map((row: Record<string, unknown>) => row[key])).toEqual([value]);
  }, 20000);

  it('still keeps a partly filled row from being saved on leaving', async () => {
    const view = renderPage();
    const section = await addRow('connectionTypes');
    fireEvent.change(await within(section).findByPlaceholderText('pages.settings.placeholders.typicalPorts'), { target: { value: '443' } });
    await wait(50);
    view.unmount();
    await wait(900);
    expect(patch).not.toHaveBeenCalled();
  }, 20000);
});
