import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
import api from '../../api';
import BudgetListRedirect, { budgetListRedirectSearch } from './listRedirect';
import { resetListContextCache } from '../../lib/listContext';
const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
const set = (values: string[]) => ({ filterType: 'set', values });
const state = (params: Record<string, string>) => new URLSearchParams(params).toString();
const filtersOf = (search: string) => JSON.parse(new URLSearchParams(search).get('filters')!);

beforeEach(() => {
  resetListContextCache();
  mocked.get.mockReset();
  mocked.post.mockReset();
});

describe.each(['opex', 'capex'] as const)('legacy %s list', (nature) => {
  it('adds the nature and keeps every other URL parameter', async () => {
    const filters = { supplier_name: set(['Acme']) };
    const search = await budgetListRedirectSearch(state({ filters: JSON.stringify(filters), sort: 'supplier_name:ASC', q: 'cloud', statusScope: 'all', from: 'report', year: '2028', custom: 'yes' }), nature);
    expect(filtersOf(search)).toEqual({ ...filters, nature: set([nature]) });
    expect(Object.fromEntries(new URLSearchParams(search))).toMatchObject({ sort: 'supplier_name:ASC', q: 'cloud', statusScope: 'all', from: 'report', year: '2028', custom: 'yes' });
  });

  it('loads and rewrites a saved context under budget-lines, including explicit filters', async () => {
    mocked.get.mockResolvedValue({ data: { list: nature === 'opex' ? 'spend-items' : 'capex-items', state: { filters: { description: set(['Servers']), item_number: set(['12']), supplier_name: set(['Acme']) } } } });
    mocked.post.mockResolvedValue({ data: { id: 'new-context' } });
    const search = await budgetListRedirectSearch(state({ ctx: 'old-context', sort: 'description:ASC', statusScope: 'all', filters: JSON.stringify({ supplier_name: set(['Other']) }) }), nature);
    const expected = nature === 'capex'
      ? { product_name: set(['Servers']), supplier_name: set(['Other']), nature: set(['capex']) }
      : { description: set(['Servers']), item_number: set(['12']), supplier_name: set(['Other']), nature: set(['opex']) };
    expect(mocked.post).toHaveBeenCalledWith('/list-contexts', { list: 'budget-lines', state: { filters: expected } });
    expect(new URLSearchParams(search).get('ctx')).toBe('new-context');
    expect(new URLSearchParams(search).has('filters')).toBe(false);
    expect(new URLSearchParams(search).get('sort')).toBe(nature === 'capex' ? 'product_name:ASC' : 'description:ASC');
    expect(new URLSearchParams(search).get('statusScope')).toBe('all');
  });

  it('drops an unreadable ctx and redirects with the nature and remaining state', async () => {
    mocked.get.mockRejectedValue(new Error('missing'));
    const search = await budgetListRedirectSearch(state({ ctx: 'gone', q: 'kept', year: '2027' }), nature);
    expect(new URLSearchParams(search).has('ctx')).toBe(false);
    expect(filtersOf(search)).toEqual({ nature: set([nature]) });
    expect(new URLSearchParams(search).get('q')).toBe('kept');
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('ignores a ctx belonging to another list', async () => {
    mocked.get.mockResolvedValue({ data: { list: 'users', state: { filters: { email: set(['someone']) } } } });
    const search = await budgetListRedirectSearch('ctx=wrong', nature);
    expect(filtersOf(search)).toEqual({ nature: set([nature]) });
    expect(mocked.post).not.toHaveBeenCalled();
  });
});

it('CAPEX renames title filters and sort and drops CPX-number filters and exact CPX searches', async () => {
  const search = await budgetListRedirectSearch(state({ filters: JSON.stringify({ description: set(['Servers']), item_number: set(['12']), notes: set(['Note']) }), sort: 'description:DESC', q: 'CPX-12' }), 'capex');
  expect(filtersOf(search)).toEqual({ product_name: set(['Servers']), notes: set(['Note']), nature: set(['capex']) });
  expect(new URLSearchParams(search).get('sort')).toBe('product_name:DESC');
  expect(new URLSearchParams(search).has('q')).toBe(false);
  expect(new URLSearchParams(await budgetListRedirectSearch('sort=item_number:ASC&q=CPX-1', 'capex')).has('sort')).toBe(false);
  expect(new URLSearchParams(await budgetListRedirectSearch('q=CPX-services', 'capex')).get('q')).toBe('CPX-services');
});

it('OPEX keeps its description, number filters and searches', async () => {
  const search = await budgetListRedirectSearch(state({ filters: JSON.stringify({ description: set(['Details']), item_number: set(['12']) }), sort: 'item_number:ASC', q: 'OPX-12' }), 'opex');
  expect(filtersOf(search)).toEqual({ description: set(['Details']), item_number: set(['12']), nature: set(['opex']) });
  expect(new URLSearchParams(search).get('q')).toBe('OPX-12');
  expect(new URLSearchParams(search).get('sort')).toBe('item_number:ASC');
});

it('redirects with replace so Back returns to the preceding page', async () => {
  let location = '';
  let back: (() => void) | undefined;
  function Probe() {
    const loc = useLocation();
    const navigate = useNavigate();
    location = loc.pathname + loc.search;
    back = () => navigate(-1);
    return null;
  }
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/previous', '/ops/capex?q=cloud']} initialIndex={1}>
    <Probe /><Routes><Route path="/ops/capex" element={<BudgetListRedirect nature="capex" />} /><Route path="*" element={null} /></Routes>
  </MemoryRouter></QueryClientProvider>);
  await waitFor(() => expect(location.startsWith('/ops/budget?')).toBe(true));
  expect(filtersOf(location.split('?')[1])).toEqual({ nature: set(['capex']) });
  back!();
  await waitFor(() => expect(location).toBe('/previous'));
});
