import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn() } }));

import api from '../api';
import SupplierSelect from '../components/fields/SupplierSelect';
import { fetchLookupByIds } from './useLookupPicker';

const apiGet = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

/** 1,500 suppliers, as on the perf tenant: the old picker only ever saw the first 1,000. */
const SUPPLIERS = Array.from({ length: 1500 }, (_, i) => ({
  id: `sup-${String(i + 1).padStart(4, '0')}`,
  name: i === 1299 ? 'Société Générale Informatique' : `Supplier ${String(i + 1).padStart(4, '0')}`,
  erp_supplier_id: null,
  status: 'enabled',
}));
const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

type Call = { url: string; params: Record<string, unknown>; signal?: AbortSignal };
let calls: Call[];

function serveLookup() {
  apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown>; signal?: AbortSignal }) => {
    const params = config?.params ?? {};
    calls.push({ url, params, signal: config?.signal });
    if (url !== '/suppliers/lookup') throw new Error(`unexpected ${url}`);
    if (params.ids) {
      const ids = String(params.ids).split(',');
      return { data: { items: SUPPLIERS.filter((s) => ids.includes(s.id)), has_more: false } };
    }
    const q = fold(String(params.q ?? ''));
    const limit = Number(params.limit);
    const matches = SUPPLIERS.filter((s) => fold(s.name).includes(q));
    return { data: { items: matches.slice(0, limit), has_more: matches.length > limit } };
  });
}

function renderSelect(props: Partial<React.ComponentProps<typeof SupplierSelect>> = {}) {
  const onChange = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <SupplierSelect label="" value={null} onChange={onChange} {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onChange, client };
}

/** Opens the list the way a user does: focus, then press on the field. */
function openList(input: HTMLElement) {
  act(() => { input.focus(); });
  fireEvent.mouseDown(input);
}

const searches = () => calls.filter((c) => c.url === '/suppliers/lookup' && !c.params.ids);

describe('useLookupPicker (through SupplierSelect)', () => {
  beforeEach(() => {
    calls = [];
    apiGet.mockReset();
    serveLookup();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reads nothing on mount, and the first page when the list opens', async () => {
    renderSelect();
    const input = screen.getByRole('combobox');
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(calls).toHaveLength(0);

    openList(input);
    await waitFor(() => expect(searches()).toHaveLength(1));
    expect(searches()[0].params).toEqual({ limit: 30 });
    expect(await screen.findAllByRole('option')).toHaveLength(30);
  });

  it('searches once per pause in typing (250 ms), not per keystroke', async () => {
    renderSelect();
    const input = screen.getByRole('combobox');
    openList(input);
    await waitFor(() => expect(searches()).toHaveLength(1));

    for (const text of ['s', 'so', 'soc', 'soci']) fireEvent.change(input, { target: { value: text } });
    await waitFor(() => expect(searches().some((c) => c.params.q === 'soci')).toBe(true));
    // The intermediate texts never reached the server.
    expect(searches().map((c) => c.params.q)).toEqual([undefined, 'soci']);
  });

  it('finds a supplier far beyond the old 1,000-row cap, accents ignored, and returns its id', async () => {
    const { onChange } = renderSelect();
    const input = screen.getByRole('combobox');
    openList(input);
    fireEvent.change(input, { target: { value: 'societe gen' } });
    const option = await screen.findByRole('option', { name: 'Société Générale Informatique' });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith('sup-1300');
    // The picked label stays without reading the supplier again.
    expect(input).toHaveValue('Société Générale Informatique');
    expect(calls.filter((c) => c.params.ids)).toHaveLength(0);
  });

  it('cancels a search the user typed past', async () => {
    let release: () => void = () => undefined;
    apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown>; signal?: AbortSignal }) => {
      calls.push({ url, params: config?.params ?? {}, signal: config?.signal });
      if (config?.params?.q === 'slow') await new Promise<void>((resolve) => { release = resolve; });
      return { data: { items: [], has_more: false } };
    });
    renderSelect();
    const input = screen.getByRole('combobox');
    openList(input);
    fireEvent.change(input, { target: { value: 'slow' } });
    await waitFor(() => expect(searches().some((c) => c.params.q === 'slow')).toBe(true));
    const slow = searches().find((c) => c.params.q === 'slow')!;
    expect(slow.signal?.aborted).toBe(false);

    fireEvent.change(input, { target: { value: 'slower' } });
    await waitFor(() => expect(searches().some((c) => c.params.q === 'slower')).toBe(true));
    expect(slow.signal?.aborted).toBe(true);
    release();
  });

  /** The next searches wait until the test answers them (`answer()`), as on a slow server. */
  function holdSearches() {
    const served = apiGet.getMockImplementation()! as (...args: any[]) => any;
    let answer: () => void = () => undefined;
    apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown>; signal?: AbortSignal }) => {
      if (!config?.params?.ids) await new Promise<void>((resolve) => { answer = resolve; });
      return served(url, config);
    });
    return () => answer();
  }
  const optionNames = () => screen.queryAllByRole('option').map((option) => option.textContent);

  it('while the next page loads, lists only the previous matches that still hold the typed text', async () => {
    renderSelect();
    const input = screen.getByRole('combobox');
    openList(input);
    fireEvent.change(input, { target: { value: 'supplier 14' } });
    // Supplier 1400 to 1429: the first page of "supplier 14".
    await waitFor(() => expect(optionNames()).toHaveLength(30));
    const answer = holdSearches();

    fireEvent.change(input, { target: { value: 'supplier 142' } });
    // At once, before the pause in typing and while the next page loads: the rows that still match.
    const expected = Array.from({ length: 10 }, (_, i) => `Supplier ${1420 + i}`);
    expect(optionNames()).toEqual(expected);
    // The request is out (held): the rows shown are still the previous page's, narrowed.
    await waitFor(() => expect(apiGet.mock.calls.some(([, config]) => config?.params?.q === 'supplier 142')).toBe(true));
    expect(optionNames()).toEqual(expected);
    answer();
  });

  it('narrows a pending list the way the server folds the text (accents, case)', async () => {
    renderSelect();
    const input = screen.getByRole('combobox');
    openList(input);
    fireEvent.change(input, { target: { value: 'soc' } });
    expect(await screen.findByRole('option', { name: 'Société Générale Informatique' })).toBeInTheDocument();
    const answer = holdSearches();
    fireEvent.change(input, { target: { value: 'SOCIETE gen' } });
    expect(optionNames()).toEqual(['Société Générale Informatique']);
    // A text it no longer matches: nothing left to pick by mistake (Enter, a click) until the answer.
    fireEvent.change(input, { target: { value: 'societe x' } });
    expect(optionNames()).toEqual([]);
    answer();
  });

  it('ends a page that does not hold every match with a hint to type more', async () => {
    renderSelect();
    const input = screen.getByRole('combobox');
    openList(input);
    await waitFor(() => expect(optionNames()).toHaveLength(30));
    // 1,500 suppliers, 30 shown.
    expect(screen.getByText('selects.moreResults')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'societe gen' } });
    // Pending: the hint belongs to the previous page, it goes at once.
    expect(screen.queryByText('selects.moreResults')).toBeNull();
    await waitFor(() => expect(optionNames()).toEqual(['Société Générale Informatique']));
    expect(screen.queryByText('selects.moreResults')).toBeNull();
  });

  it("shows the chosen supplier's label from the caller, without any request", async () => {
    renderSelect({ value: 'sup-1300', selectedOption: SUPPLIERS[1299] });
    expect(screen.getByRole('combobox')).toHaveValue('Société Générale Informatique');
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(calls).toHaveLength(0);
  });

  it('reads the label of a chosen supplier it is not given, by id, once', async () => {
    renderSelect({ value: 'sup-1450' });
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('Supplier 1450'));
    expect(calls).toEqual([expect.objectContaining({ url: '/suppliers/lookup', params: { ids: 'sup-1450' } })]);
  });

  it('keeps what the user types while the chosen value\'s label is still loading', async () => {
    let answerLabel: () => void = () => undefined;
    const served = apiGet.getMockImplementation()! as (...args: any[]) => any;
    apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown>; signal?: AbortSignal }) => {
      if (config?.params?.ids) await new Promise<void>((resolve) => { answerLabel = resolve; });
      return served(url, config);
    });
    renderSelect({ value: 'sup-1450' });
    const input = screen.getByRole('combobox');
    expect(input).toHaveValue('…');
    openList(input);
    fireEvent.change(input, { target: { value: 'supp' } });
    // Renders follow (the search, its answer): the pending value keeps its identity, the text stays.
    await waitFor(() => expect(searches().some((c) => c.params.q === 'supp')).toBe(true));
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    expect(input).toHaveValue('supp');
    answerLabel();
  });

  it('says a chosen value is no longer available when the server does not return it, and asks once', async () => {
    renderSelect({ value: 'sup-gone' });
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('selects.valueUnavailable'));
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(calls.filter((c) => c.params.ids)).toHaveLength(1);
  });

  it('gives up on a label whose read fails twice, instead of loading forever', async () => {
    const served = apiGet.getMockImplementation()! as (...args: any[]) => any;
    apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown>; signal?: AbortSignal }) => {
      if (config?.params?.ids) {
        calls.push({ url, params: config.params });
        throw new Error('network');
      }
      return served(url, config);
    });
    renderSelect({ value: 'sup-1450' });
    expect(screen.getByRole('combobox')).toHaveValue('…');
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('selects.valueUnavailable'), { timeout: 4000 });
    // The first read and one retry.
    expect(calls.filter((c) => c.params.ids)).toHaveLength(2);
  });
});

describe('fetchLookupByIds', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (_url: string, config?: { params?: Record<string, unknown> }) => ({
      data: { items: String(config?.params?.ids).split(',').map((id) => ({ id })), has_more: false },
    }));
  });

  it('reads more than 100 ids in batches of 100 (the server refuses more)', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `id-${i}`);
    const rows = await fetchLookupByIds<{ id: string }>('/users/lookup', ids);
    expect(rows.map((row) => row.id)).toEqual(ids);
    expect(apiGet.mock.calls.map(([, config]) => String(config.params.ids).split(',').length)).toEqual([100, 100, 50]);
  });
});
