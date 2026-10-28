import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ profile: { id: 'me', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.invalid' } }),
}));

import api from '../../api';
import MetadataUserPicker from './MetadataUserPicker';
import ShareDialog from '../ShareDialog';
import { fetchBudgetRelationsCount } from '../../utils/workspaceTabCounts';

const apiGet = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

const PEOPLE = [
  { id: 'u-1', first_name: 'Hélène', last_name: 'Dupré', email: null, status: 'enabled' },
  { id: 'u-2', first_name: 'Marc', last_name: 'Zola', email: null, status: 'enabled' },
];

// One suggested person is also on the lookup's first page (Marc), one is not (Zoe).
const SUGGESTED_CC1 = [
  { id: 'u-3', first_name: 'Zoe', last_name: 'Zulu', email: null, status: 'enabled' },
  { id: 'u-2', first_name: 'Marc', last_name: 'Zola', email: null, status: 'enabled' },
];
const OWNER_SUGGESTIONS_ENDPOINT = '/budget-lines/owner-suggestions';

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('person pickers on the user lookup', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url === OWNER_SUGGESTIONS_ENDPOINT) {
        const items = config?.params?.cost_center_id === 'cc-1' ? SUGGESTED_CC1 : [];
        return { data: { items, has_more: false } };
      }
      if (url !== '/users/lookup') throw new Error(`unexpected ${url}`);
      // The server folds accents and case (common/lookup).
      const fold = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
      const q = fold(String(config?.params?.q ?? ''));
      return { data: { items: PEOPLE.filter((p) => fold(`${p.first_name} ${p.last_name}`).includes(q)), has_more: false } };
    });
  });

  it('shows an owner named by the detail without reading any user record (no 403 for a budget member)', async () => {
    wrap(<MetadataUserPicker value="u-1" displayName="Hélène Dupré" placeholder="Owner missing" onChange={() => undefined} />);
    expect(screen.getByText('Hélène Dupré')).toBeInTheDocument();
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('searches people on the server once open, me first while nothing is typed', async () => {
    const onChange = vi.fn();
    wrap(<MetadataUserPicker value={null} placeholder="Owner missing" onChange={onChange} />);
    expect(apiGet).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Owner missing/ }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/users/lookup', expect.objectContaining({ params: { limit: 30 } })));
    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual(['Ada Lovelace selects.meSuffix', 'Hélène Dupré', 'Marc Zola']);

    fireEvent.change(screen.getByPlaceholderText('selects.user'), { target: { value: 'zol' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/users/lookup', expect.objectContaining({ params: { q: 'zol', limit: 30 } })));
    await waitFor(() => expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Marc Zola']));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Marc Zola' }));
    expect(onChange).toHaveBeenCalledWith('u-2');
  });

  it('puts the cost centre people first, under their header, then the rest without duplicates', async () => {
    wrap(<MetadataUserPicker value={null} placeholder="Owner missing" onChange={() => undefined} suggestedFirst={{ costCenterId: 'cc-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Owner missing/ }));
    await waitFor(() => expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Zoe Zulu',
      'Marc Zola',
      'Hélène Dupré',
    ]));
    const listbox = screen.getByRole('listbox');
    expect(within(listbox).getByText('selects.costCenterAccess')).toBeInTheDocument();
    expect(within(listbox).getAllByRole('separator')).toHaveLength(1);
    expect(screen.getAllByRole('menuitem').filter((item) => item.textContent === 'Marc Zola')).toHaveLength(1);
  });

  it('searches the usual lookup once a text is typed, without the group', async () => {
    wrap(<MetadataUserPicker value={null} placeholder="Owner missing" onChange={() => undefined} suggestedFirst={{ costCenterId: 'cc-1' }} />);
    fireEvent.click(screen.getByRole('button', { name: /Owner missing/ }));
    await waitFor(() => expect(screen.getAllByRole('menuitem')).toHaveLength(3));

    fireEvent.change(screen.getByPlaceholderText('selects.user'), { target: { value: 'hel' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(
      '/users/lookup',
      expect.objectContaining({ params: expect.objectContaining({ q: 'hel' }) }),
    ));
    await waitFor(() => expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Hélène Dupré']));
    expect(screen.queryByText('selects.costCenterAccess')).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('keeps the plain lookup, me first, when the line has no cost centre', async () => {
    wrap(<MetadataUserPicker value={null} placeholder="Owner missing" onChange={() => undefined} suggestedFirst={{ costCenterId: null }} />);
    fireEvent.click(screen.getByRole('button', { name: /Owner missing/ }));
    await waitFor(() => expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'Ada Lovelace selects.meSuffix',
      'Hélène Dupré',
      'Marc Zola',
    ]));
    expect(within(screen.getByRole('listbox')).getAllByRole('separator')).toHaveLength(1);
    expect(apiGet.mock.calls.some(([url]) => url === OWNER_SUGGESTIONS_ENDPOINT)).toBe(false);
  });

  it('while the next search runs, lists only the people that still match, and hints at more results', async () => {
    let hold = false;
    let answer: () => void = () => undefined;
    apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (hold) await new Promise<void>((resolve) => { answer = resolve; });
      const fold = (v: string) => v.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
      const q = fold(String(config?.params?.q ?? ''));
      return { data: { items: PEOPLE.filter((p) => fold(`${p.first_name} ${p.last_name}`).includes(q)), has_more: !q } };
    });
    wrap(<MetadataUserPicker value={null} placeholder="Owner missing" onChange={() => undefined} />);
    fireEvent.click(screen.getByRole('button', { name: /Owner missing/ }));
    await waitFor(() => expect(screen.getAllByRole('menuitem')).toHaveLength(3));
    expect(screen.getByText('selects.moreResults')).toBeInTheDocument();

    hold = true;
    fireEvent.change(screen.getByPlaceholderText('selects.user'), { target: { value: 'helene' } });
    // At once: only who still matches the text, and no hint from the previous page.
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Hélène Dupré']);
    expect(screen.queryByText('selects.moreResults')).toBeNull();
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/users/lookup', expect.objectContaining({ params: { q: 'helene', limit: 30 } })));
    await act(async () => { answer(); });
  });

  it('says so when the chosen person can no longer be read, instead of looking unset', async () => {
    apiGet.mockImplementation(async () => ({ data: { items: [], has_more: false } }));
    wrap(<MetadataUserPicker value="u-gone" placeholder="Owner missing" onChange={() => undefined} />);
    expect(await screen.findByText('selects.valueUnavailable')).toBeInTheDocument();
    expect(screen.queryByText('Owner missing')).toBeNull();
  });

  it('the share dialog reads no person while closed, and searches once its recipients list opens', async () => {
    const view = wrap(<ShareDialog open={false} onClose={() => undefined} itemType="opex" itemId="item-1" itemName="Line" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(apiGet).not.toHaveBeenCalled();
    view.unmount();

    wrap(<ShareDialog open onClose={() => undefined} itemType="opex" itemId="item-1" itemName="Line" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(apiGet).not.toHaveBeenCalled();
    const input = screen.getByPlaceholderText('share.searchUsersOrEmail');
    act(() => { input.focus(); });
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'hel' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/users/lookup', expect.objectContaining({ params: { q: 'hel', limit: 30 } })));
    expect(await screen.findByRole('option', { name: 'Hélène Dupré' })).toBeInTheDocument();
  });
});

describe('Relations tab badge', () => {
  beforeEach(() => apiGet.mockReset());

  it('costs one request per line instead of five', async () => {
    apiGet.mockResolvedValue({ data: { contracts: 1, applications: 2, projects: 0, links: 3, attachments: 1, total: 7 } });
    expect(await fetchBudgetRelationsCount({ itemsApi: '/spend-items' }, 'item-1')).toBe(7);
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith('/spend-items/item-1/relation-counts', expect.anything());
    expect(await fetchBudgetRelationsCount({ itemsApi: '/capex-items' }, 'item-2')).toBe(7);
    expect(apiGet).toHaveBeenLastCalledWith('/capex-items/item-2/relation-counts', expect.anything());
  });
});
