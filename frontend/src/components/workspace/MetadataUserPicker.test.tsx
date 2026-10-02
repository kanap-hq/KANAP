import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
import { fetchCapexRelationsCount, fetchSpendRelationsCount } from '../../utils/workspaceTabCounts';

const apiGet = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

const PEOPLE = [
  { id: 'u-1', first_name: 'Hélène', last_name: 'Dupré', email: null, status: 'enabled' },
  { id: 'u-2', first_name: 'Marc', last_name: 'Zola', email: null, status: 'enabled' },
];

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
    expect(await fetchSpendRelationsCount('item-1')).toBe(7);
    expect(apiGet).toHaveBeenCalledTimes(1);
    expect(apiGet).toHaveBeenCalledWith('/spend-items/item-1/relation-counts', expect.anything());
    expect(await fetchCapexRelationsCount('item-2')).toBe(7);
    expect(apiGet).toHaveBeenLastCalledWith('/capex-items/item-2/relation-counts', expect.anything());
  });
});
