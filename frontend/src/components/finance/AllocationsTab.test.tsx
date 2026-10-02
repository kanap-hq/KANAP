import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { OPEX_FINANCE_CONFIG } from './config';
import { KanapDialogProvider } from '../design';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), put: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me' } }) }));

import api from '../../api';
import AllocationsTab, { type AllocationsTabHandle } from './AllocationsTab';
import { forgetAllocationsYear } from './allocationsCache';
import type { HeldAllocationChoice } from './heldChoices';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; put: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn> };
const YEAR = 2026;

/** The year's Budget total the server holds for the lines (a test changes it to model a Budget save). */
let plannedTotal = 1000;

/** The allocation the server holds for the lines, with the signature it was read with (a test replaces it). */
type Stored = { items: Array<{ company_id: string; department_id: string | null; allocation_pct: number }>; method: string; driver: string; base_signature: string };
let stored: Stored;

/** Two lines, each with a manual split between two companies. */
function serve() {
  plannedTotal = 1000;
  stored = {
    items: [
      { company_id: 'c-1', department_id: null, allocation_pct: 60 },
      { company_id: 'c-2', department_id: null, allocation_pct: 40 },
    ],
    method: 'manual_company',
    driver: 'headcount',
    base_signature: 'sig-1',
  };
  mocked.get.mockImplementation(async (url: string) => {
    const line = /^\/spend-items\/(item-\d)\/versions$/.exec(url);
    if (line) return { data: [{ id: `v-${line[1]}`, budget_year: YEAR, allocation_method: 'manual_company', allocation_driver: 'headcount' }] };
    if (/^\/spend-versions\/v-item-\d\/allocations$/.test(url)) {
      return { data: { ...stored, items: stored.items } };
    }
    if (/^\/spend-versions\/v-item-\d\/amounts$/.test(url)) return { data: { totals: { planned: plannedTotal } } };
    if (url === '/companies') {
      return { data: { items: [
        { id: 'c-1', name: 'Alpha Industries', headcount_year: 60 },
        { id: 'c-2', name: 'Beta Services', headcount_year: 40 },
      ] } };
    }
    if (url === '/departments') return { data: { items: [] } };
    if (url === '/allocation-rules/active') return { data: { mode: 'auto', method: 'headcount' } };
    throw new Error(`unexpected GET ${url}`);
  });
}

function renderTab(id: string, client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
        <AllocationsTab id={id} year={YEAR} onYearChange={() => undefined} config={OPEX_FINANCE_CONFIG} />
        </KanapDialogProvider>
        </ThemeProvider>
    </QueryClientProvider>,
  );
}

const reads = (pattern: RegExp) => mocked.get.mock.calls.filter(([url]) => pattern.test(url)).length;

describe('AllocationsTab on the query cache', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    serve();
  });

  it("reads the year's companies and departments once for every line", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const first = renderTab('item-1', client);
    expect(await screen.findByText('Alpha Industries')).toBeInTheDocument();
    first.unmount();
    renderTab('item-2', client);
    await waitFor(() => expect(reads(/^\/spend-versions\/v-item-2\/allocations$/)).toBe(1));
    expect(await screen.findByText('Alpha Industries')).toBeInTheDocument();
    expect(reads(/^\/companies$/)).toBe(1);
    expect(reads(/^\/departments$/)).toBe(1);
  });

  it("shows a line's allocation at once when the tab comes back", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const first = renderTab('item-1', client);
    expect(await screen.findByText('Beta Services')).toBeInTheDocument();
    const before = mocked.get.mock.calls.length;
    first.unmount();

    renderTab('item-1', client);
    // First render: the stored split, not an empty table.
    expect(screen.getByText('Alpha Industries')).toBeInTheDocument();
    expect(screen.getByText('Beta Services')).toBeInTheDocument();
    expect(mocked.get.mock.calls.length).toBe(before);
  });

  it('after a Budget save, reads the year again and never shows the amounts from before', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const first = renderTab('item-1', client);
    // 60 % of 1 000.
    expect(await screen.findByText('600')).toBeInTheDocument();
    first.unmount();

    // The Budget tab saves 2 000 for the year (what its writes do to this tab's cache).
    plannedTotal = 2000;
    forgetAllocationsYear(client, OPEX_FINANCE_CONFIG.itemsApi, 'item-1', YEAR);
    renderTab('item-1', client);
    expect(screen.queryByText('600')).toBeNull();
    expect(await screen.findByText('1 200')).toBeInTheDocument();
    expect(screen.queryByText('600')).toBeNull();
  });

  it('a failed read of the companies shows an error instead of loading for ever', async () => {
    const served = mocked.get.getMockImplementation()!;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/companies') throw new Error('network');
      return served(url, config);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
          <AllocationsTab id="item-1" year={YEAR} availableYears={[YEAR - 1, YEAR]} onYearChange={() => undefined} config={OPEX_FINANCE_CONFIG} />
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    // The years are not locked: the user can leave for another year.
    await waitFor(() => expect(screen.getByRole('tab', { name: String(YEAR - 1) })).not.toBeDisabled());
  });

  it('a failed read of the departments is not kept: the next visit reads them again', async () => {
    const served = mocked.get.getMockImplementation()!;
    let failDepartments = true;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === '/departments' && failDepartments) throw new Error('forbidden');
      return served(url, config);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
    const first = renderTab('item-1', client);
    expect(await screen.findByText('Alpha Industries')).toBeInTheDocument();
    await waitFor(() => expect(reads(/^\/departments$/)).toBe(1));
    first.unmount();

    failDepartments = false;
    renderTab('item-2', client);
    await waitFor(() => expect(reads(/^\/departments$/)).toBe(2));
  });
});

/** Someone else's allocation, answered with 409 edit_conflict (lot 3E). */
function conflictAnswer(signature: string) {
  return {
    response: {
      status: 409,
      data: {
        code: 'edit_conflict',
        message: 'Someone else changed this allocation while you were editing it.',
        conflicts: [{
          field: 'allocations',
          base: null,
          current: { method: 'manual_company', driver: 'headcount', rows: [{ company_id: 'c-2', department_id: null, allocation_pct: 100 }] },
          mine: { method: 'manual_pct', driver: 'headcount', rows: [{ company_id: 'c-1', department_id: null, allocation_pct: 50 }, { company_id: 'c-2', department_id: null, allocation_pct: 50 }] },
          labels: { base: null, current: null, mine: null },
          changed_by: { id: 'u-marie', name: 'Marie Dupont' },
          changed_at: '2026-09-30T12:02:00Z',
        }],
        base_signature: signature,
      },
    },
  };
}

describe('AllocationsTab saves (lot 3E)', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.put.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    serve();
  });

  function renderWithRef(extra: {
    held?: React.MutableRefObject<HeldAllocationChoice | null>;
    onYearChange?: (y: number) => void;
    client?: QueryClient;
  } = {}) {
    // A plain object (React.createRef is sealed): the helper adds the view's unmount and client.
    const ref: React.MutableRefObject<AllocationsTabHandle | null> = { current: null };
    const client = extra.client ?? new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
          <AllocationsTab
            ref={ref} id="item-1" year={YEAR} availableYears={[YEAR, YEAR + 1]} onYearChange={extra.onYearChange ?? (() => undefined)}
            config={OPEX_FINANCE_CONFIG} held={extra.held}
          />
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    return Object.assign(ref, { unmount: view.unmount, client });
  }
  async function flushTab(ref: React.RefObject<AllocationsTabHandle>) {
    let ok = true;
    await act(async () => { ok = (await ref.current?.flush()) ?? true; });
    return ok;
  }
  /** Picks another method in the Method select. */
  async function pickMethod(label: string) {
    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    fireEvent.click(await screen.findByRole('option', { name: label }));
  }
  const puts = () => mocked.put.mock.calls.filter(([url]) => url === '/spend-versions/v-item-1/allocations');

  it('saves method, driver and rows in one PUT, from the signature the allocation was read with', async () => {
    mocked.put.mockResolvedValue({ data: { items: stored.items, method: 'manual_pct', driver: 'headcount', base_signature: 'sig-2' } });
    const ref = renderWithRef();
    expect(await screen.findByText('Alpha Industries')).toBeInTheDocument();

    await pickMethod('opex.allocations.manualByPct');
    await flushTab(ref);
    expect(puts()).toHaveLength(1);
    expect(puts()[0][1]).toEqual({
      method: 'manual_pct',
      driver: 'headcount',
      rows: [{ company_id: 'c-1', department_id: null, allocation_pct: 60 }, { company_id: 'c-2', department_id: null, allocation_pct: 40 }],
      base_signature: 'sig-1',
    });
    // No method PATCH followed by a rows POST any more (scenario 10).
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(mocked.post).not.toHaveBeenCalled();

    // The next save starts from what this one stored.
    fireEvent.click(screen.getByRole('button', { name: 'opex.allocations.splitEqually' }));
    await flushTab(ref);
    expect(puts()).toHaveLength(2);
    expect(puts()[1][1]).toMatchObject({ method: 'manual_pct', base_signature: 'sig-2' });
  });

  it('a refused save shows who changed the allocation; Overwrite sends the user\'s again over theirs', async () => {
    mocked.put.mockRejectedValueOnce(conflictAnswer('sig-9'));
    mocked.put.mockResolvedValue({ data: { items: stored.items, method: 'manual_pct', driver: 'headcount', base_signature: 'sig-10' } });
    const ref = renderWithRef();
    expect(await screen.findByText('Alpha Industries')).toBeInTheDocument();

    await pickMethod('opex.allocations.manualByPct');
    expect(await flushTab(ref)).toBe(false);
    expect(ref.current?.isDirty()).toBe(true);
    const banner = await screen.findByRole('region');
    expect(within(banner).getByText('editConflict.allocation.title')).toBeInTheDocument();
    expect(within(banner).getByText(/editConflict\.allocation\.changedByOn/)).toBeInTheDocument();
    // Their allocation, named with the tab's own words.
    expect(within(banner).getByText('opex.allocations.manualByCompany · Beta Services 100 %')).toBeInTheDocument();
    // Nothing more is sent while the choice waits, an edit included.
    fireEvent.click(screen.getByRole('button', { name: 'opex.allocations.splitEqually' }));
    expect(await flushTab(ref)).toBe(false);
    expect(puts()).toHaveLength(1);

    fireEvent.click(within(banner).getByRole('button', { name: /editConflict\.allocation\.applyMine/ }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1][1]).toMatchObject({ method: 'manual_pct', base_signature: 'sig-9' });
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull());
    expect(await flushTab(ref)).toBe(true);
  });

  it('Reload the allocation shows the stored one and drops the user\'s', async () => {
    mocked.put.mockRejectedValueOnce(conflictAnswer('sig-9'));
    const ref = renderWithRef();
    expect(await screen.findByText('Alpha Industries')).toBeInTheDocument();

    await pickMethod('opex.allocations.manualByPct');
    expect(await flushTab(ref)).toBe(false);
    const banner = await screen.findByRole('region');
    // The server now holds Marie's allocation.
    stored = { items: [{ company_id: 'c-2', department_id: null, allocation_pct: 100 }], method: 'manual_company', driver: 'headcount', base_signature: 'sig-9' };
    fireEvent.click(within(banner).getByRole('button', { name: /editConflict\.allocation\.keepTheirs/ }));

    await waitFor(() => expect(screen.queryByText('Alpha Industries')).toBeNull());
    expect(screen.getByText('Beta Services')).toBeInTheDocument();
    expect(screen.queryByRole('region')).toBeNull();
    expect(await flushTab(ref)).toBe(true);
    expect(puts()).toHaveLength(1);
  });

  it('a tab change keeps the waiting choice: the tab comes back with the banner and the user\'s allocation', async () => {
    mocked.put.mockRejectedValueOnce(conflictAnswer('sig-9'));
    mocked.put.mockResolvedValue({ data: { items: stored.items, method: 'manual_pct', driver: 'headcount', base_signature: 'sig-10' } });
    const held = { current: null } as React.MutableRefObject<HeldAllocationChoice | null>;
    const first = renderWithRef({ held });
    expect(await screen.findByText('Alpha Industries')).toBeInTheDocument();
    await pickMethod('opex.allocations.manualByPct');
    expect(await flushTab(first)).toBe(false);
    await screen.findByRole('region');
    let moved = false;
    await act(async () => { moved = await first.current!.flush({ ignoreHeld: true }); });
    expect(moved).toBe(true);
    expect(first.current!.hasWaitingChoice()).toBe(true);
    first.unmount();
    expect(held.current?.method).toBe('manual_pct');

    const again = renderWithRef({ held, client: first.client });
    const banner = await screen.findByRole('region');
    expect(within(banner).getByText('opex.allocations.manualByCompany · Beta Services 100 %')).toBeInTheDocument();
    expect(again.current!.hasWaitingChoice()).toBe(true);
    fireEvent.click(within(banner).getByRole('button', { name: /editConflict\.allocation\.applyMine/ }));
    await waitFor(() => expect(puts()).toHaveLength(2));
    expect(puts()[1][1]).toMatchObject({ method: 'manual_pct', base_signature: 'sig-9' });
  });

  it('a year change with a choice waiting asks first, and drops it only when confirmed', async () => {
    mocked.put.mockRejectedValueOnce(conflictAnswer('sig-9'));
    const onYearChange = vi.fn();
    const ref = renderWithRef({ onYearChange });
    expect(await screen.findByText('Alpha Industries')).toBeInTheDocument();
    await pickMethod('opex.allocations.manualByPct');
    expect(await flushTab(ref)).toBe(false);
    await screen.findByRole('region');

    fireEvent.click(screen.getByRole('tab', { name: String(YEAR + 1) }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('common:editConflict.allocation.yearChange');
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:editConflict.yearChangeConfirm' }));
    await waitFor(() => expect(onYearChange).toHaveBeenCalledWith(YEAR + 1));
    expect(puts()).toHaveLength(1);
  });

  it('a conflict answer the screen cannot read is an error the user sees', async () => {
    mocked.put.mockRejectedValueOnce({ response: { status: 409, data: { code: 'edit_conflict', conflicts: [] } } });
    const ref = renderWithRef();
    expect(await screen.findByText('Alpha Industries')).toBeInTheDocument();
    await pickMethod('opex.allocations.manualByPct');
    expect(await flushTab(ref)).toBe(false);
    expect(await screen.findByRole('alert')).toHaveTextContent('errors:edit_conflict_unreadable');
    expect(screen.queryByRole('region')).toBeNull();
  });
});
