import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ default: { get: vi.fn() } }));

import api from '../api';
import { lookupIdsKey } from './useLookupPicker';
import { UNSCOPED_PLACEMENT, useFillOnce, useLookupLabelMatch, useOnlyCompany, useOnlyLookupValue, type PlacementStart } from './useOnlyChoice';

const apiGet = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
type Row = { id: string; name: string };
let rows: Row[];
let calls: Array<{ url: string; params: Record<string, unknown> }>;

beforeEach(() => {
  rows = [];
  calls = [];
  apiGet.mockReset();
  apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    const params = config?.params ?? {};
    calls.push({ url, params });
    const q = String(params.q ?? '').toLowerCase();
    const matches = rows.filter((row) => row.name.toLowerCase().includes(q));
    const limit = Number(params.limit);
    return { data: { items: matches.slice(0, limit), has_more: matches.length > limit } };
  });
});

function wrap(node: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
}

function Only({ placement }: { placement?: PlacementStart }) {
  const lookup = useOnlyLookupValue({ endpoint: '/companies/lookup', enabled: !placement });
  const company = useOnlyCompany(placement ?? UNSCOPED_PLACEMENT, !!placement);
  const value = placement ? company : lookup;
  return <span data-testid="only">{value === undefined ? 'pending' : String(value)}</span>;
}

describe('useOnlyLookupValue', () => {
  it('gives the one value the picker offers, from a read of two rows', async () => {
    rows = [{ id: 'c1', name: 'Fromage SA' }];
    wrap(<Only />);
    await waitFor(() => expect(screen.getByTestId('only')).toHaveTextContent('c1'));
    expect(calls).toEqual([{ url: '/companies/lookup', params: { limit: 2 } }]);
  });

  it('keeps the row found as the label of the value, so the picker does not read it again', async () => {
    rows = [{ id: 'c1', name: 'Fromage SA' }];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><Only /></QueryClientProvider>);
    await waitFor(() => expect(client.getQueryData(lookupIdsKey('/companies/lookup', ['c1']))).toEqual([{ id: 'c1', name: 'Fromage SA' }]));
  });

  it('gives nothing when the picker offers two values or none', async () => {
    rows = [{ id: 'c1', name: 'Fromage SA' }, { id: 'c2', name: 'Kaas BV' }];
    const two = wrap(<Only />);
    await waitFor(() => expect(screen.getByTestId('only')).toHaveTextContent('null'));
    two.unmount();
    rows = [];
    wrap(<Only />);
    await waitFor(() => expect(screen.getByTestId('only')).toHaveTextContent('null'));
  });

  it('gives nothing when the read is refused', async () => {
    apiGet.mockRejectedValue({ response: { status: 403, data: { code: 'lookup_search_forbidden' } } });
    wrap(<Only />);
    await waitFor(() => expect(screen.getByTestId('only')).toHaveTextContent('null'));
  });
});

describe('useOnlyCompany', () => {
  it('gives the one company of a limited access without any read', async () => {
    wrap(<Only placement={{ ready: true, companyId: 'c9', needsChoice: false }} />);
    expect(screen.getByTestId('only')).toHaveTextContent('c9');
    expect(calls).toEqual([]);
  });

  it('gives nothing when the access leaves a choice, and waits while it loads', async () => {
    const choice = wrap(<Only placement={{ ready: true, companyId: null, needsChoice: true }} />);
    expect(screen.getByTestId('only')).toHaveTextContent('null');
    choice.unmount();
    wrap(<Only placement={{ ready: false, companyId: null, needsChoice: false }} />);
    expect(screen.getByTestId('only')).toHaveTextContent('pending');
    expect(calls).toEqual([]);
  });
});

describe('useLookupLabelMatch', () => {
  function Match({ label, allowed }: { label: string; allowed?: Set<string> }) {
    const value = useLookupLabelMatch<Row>({ endpoint: '/companies/lookup', label, labelOf: (row) => row.name, allowed });
    return <span data-testid="match">{value === undefined ? 'pending' : String(value)}</span>;
  }

  it('finds the one row whose label is exactly the filter value', async () => {
    rows = [{ id: 'c1', name: 'Fromage SA' }, { id: 'c2', name: 'Fromage SA Suisse' }];
    wrap(<Match label="Fromage SA" />);
    await waitFor(() => expect(screen.getByTestId('match')).toHaveTextContent('c1'));
  });

  it('finds nothing for two rows of that label, or a row the access leaves out', async () => {
    rows = [{ id: 'c1', name: 'Fromage SA' }, { id: 'c2', name: 'Fromage SA' }];
    const twice = wrap(<Match label="Fromage SA" />);
    await waitFor(() => expect(screen.getByTestId('match')).toHaveTextContent('null'));
    twice.unmount();
    rows = [{ id: 'c1', name: 'Fromage SA' }];
    wrap(<Match label="Fromage SA" allowed={new Set(['c2'])} />);
    await waitFor(() => expect(screen.getByTestId('match')).toHaveTextContent('null'));
  });
});

describe('useFillOnce', () => {
  function Field({ value, isNew = true }: { value: string | null | undefined; isNew?: boolean }) {
    const [held, setHeld] = React.useState('');
    useFillOnce({ isNew, key: 'company', empty: !held, value, fill: setHeld });
    return (
      <>
        <span data-testid="held">{held}</span>
        <button type="button" onClick={() => setHeld('')}>clear</button>
      </>
    );
  }

  it('fills an empty field once its value is known, and never again once the person empties it', async () => {
    const view = wrap(<Field value={undefined} />);
    expect(screen.getByTestId('held')).toHaveTextContent('');
    view.rerender(<QueryClientProvider client={new QueryClient()}><Field value="c1" /></QueryClientProvider>);
    await waitFor(() => expect(screen.getByTestId('held')).toHaveTextContent('c1'));
    act(() => screen.getByRole('button', { name: 'clear' }).click());
    expect(screen.getByTestId('held')).toHaveTextContent('');
    view.rerender(<QueryClientProvider client={new QueryClient()}><Field value="c1" /></QueryClientProvider>);
    expect(screen.getByTestId('held')).toHaveTextContent('');
  });

  it('fills nothing on a record that exists', () => {
    wrap(<Field value="c1" isNew={false} />);
    expect(screen.getByTestId('held')).toHaveTextContent('');
  });
});

describe('useFillOnce under React.StrictMode, value known at mount (lot A2, E1)', () => {
  /** A page whose draft is emptied by an effect on mount, before or after the fill, as the budget line's is. */
  function Draft({ resetFirst }: { resetFirst: boolean }) {
    // The person's edits over the draft's defaults; the reset gives a new empty object, as the pages do.
    const [edits, setEdits] = React.useState<{ company?: string }>({});
    const held = edits.company ?? '';
    const reset = () => setEdits({});
    React.useEffect(() => { if (resetFirst) reset(); }, [resetFirst]);
    useFillOnce({ isNew: true, key: 'company', empty: !held, value: 'c1', fill: (company) => setEdits((prev) => ({ ...prev, company })) });
    React.useEffect(() => { if (!resetFirst) reset(); }, [resetFirst]);
    return (
      <>
        <span data-testid="held">{held}</span>
        <button type="button" onClick={() => setEdits((prev) => ({ ...prev, company: '' }))}>clear</button>
      </>
    );
  }

  it.each([true, false])('fills the field whatever the order of the effects (reset first: %s)', async (resetFirst) => {
    render(<React.StrictMode><Draft resetFirst={resetFirst} /></React.StrictMode>);
    await waitFor(() => expect(screen.getByTestId('held')).toHaveTextContent('c1'));
    act(() => screen.getByRole('button', { name: 'clear' }).click());
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(screen.getByTestId('held')).toHaveTextContent('');
  });
});
