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
  useAuth: () => ({ profile: { id: 'me', first_name: 'Friedrich', last_name: 'Eva', email: 'fried@kanap.net' } }),
}));

import api from '../../api';
import UserSelect from './UserSelect';
import UserMultiSelect from './UserMultiSelect';

const apiGet = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

// The lookup returns the email of the two accounts sharing a name (common/lookup), names only otherwise.
const PEOPLE = [
  { id: 'ana', first_name: 'Ana', last_name: 'Diaz', email: null, status: 'enabled' },
  { id: 'twin', first_name: 'Friedrich', last_name: 'Eva', email: 'admin@kanap.net', status: 'enabled' },
  { id: 'me', first_name: 'Friedrich', last_name: 'Eva', email: 'fried@kanap.net', status: 'enabled' },
];

// The people who read the cost centre, in the server order (USER_LOOKUP); one of them is on the
// lookup's first page too, the other is not.
const SUGGESTED_CC1 = [
  { id: 'zoe', first_name: 'Zoe', last_name: 'Zulu', email: null, status: 'enabled' },
  { id: 'ana', first_name: 'Ana', last_name: 'Diaz', email: null, status: 'enabled' },
];
const SUGGESTED_CC2 = [
  { id: 'bob', first_name: 'Bob', last_name: 'Brown', email: null, status: 'enabled' },
];

const OWNER_SUGGESTIONS_ENDPOINT = '/budget-lines/owner-suggestions';

function lookupPeople(config?: { params?: Record<string, unknown> }) {
  const ids = config?.params?.ids;
  if (ids) {
    const wanted = String(ids).split(',');
    return PEOPLE.filter((p) => wanted.includes(p.id));
  }
  const q = String(config?.params?.q ?? '').toLowerCase();
  if (!q) return PEOPLE;
  return PEOPLE.filter((p) => (
    `${p.first_name} ${p.last_name}`.toLowerCase().includes(q) || String(p.email ?? '').toLowerCase().includes(q)
  ));
}

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function wrapWithClient(ui: React.ReactElement, client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

function wrap(ui: React.ReactElement) {
  return wrapWithClient(ui, newClient());
}

function open(input: HTMLElement) {
  act(() => { input.focus(); });
  fireEvent.mouseDown(input);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
}

function keyWarnings(spy: { mock: { calls: unknown[][] } }) {
  return spy.mock.calls.filter((args) => args.some((arg) => (
    typeof arg === 'string' && arg.includes('prop is being spread into JSX')
  )));
}

describe('person pickers with two accounts of one name', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url === OWNER_SUGGESTIONS_ENDPOINT) {
        const items = config?.params?.cost_center_id === 'cc-1' ? SUGGESTED_CC1 : config?.params?.cost_center_id === 'cc-2' ? SUGGESTED_CC2 : [];
        return { data: { items, has_more: false } };
      }
      if (url !== '/users/lookup') throw new Error(`unexpected ${url}`);
      return { data: { items: lookupPeople(config), has_more: false } };
    });
  });

  // First in the file: React reports a spread `key` once per props shape, for the whole process.
  it('renders UserSelect options without a key warning', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    wrap(<UserSelect value={null} onChange={() => undefined} />);
    open(screen.getByRole('combobox'));
    const listbox = await screen.findByRole('listbox');
    await waitFor(() => expect(within(listbox).getAllByRole('option').length).toBeGreaterThan(0));
    expect(keyWarnings(errorSpy)).toEqual([]);
    errorSpy.mockRestore();
  });

  it('renders UserMultiSelect options without a key warning', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    wrap(<UserMultiSelect value={[]} onChange={() => undefined} />);
    open(screen.getByRole('combobox'));
    const listbox = await screen.findByRole('listbox');
    await waitFor(() => expect(within(listbox).getAllByRole('option').length).toBeGreaterThan(0));
    expect(keyWarnings(errorSpy)).toEqual([]);
    errorSpy.mockRestore();
  });

  it('lists the twins by email, me first with its suffix, and others by name', async () => {
    wrap(<UserSelect value={null} onChange={() => undefined} />);
    open(screen.getByRole('combobox'));
    const listbox = await screen.findByRole('listbox');
    await waitFor(() => expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'fried@kanap.net selects.meSuffix',
      'Ana Diaz',
      'admin@kanap.net',
    ]));
  });

  it('shows a chosen twin by its email', async () => {
    wrap(<UserSelect value="twin" onChange={() => undefined} />);
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('admin@kanap.net'));
  });

  it('labels the chosen twins of a multiple pick by email', async () => {
    wrap(<UserMultiSelect value={['twin', 'ana']} onChange={() => undefined} />);
    expect(await screen.findByText('admin@kanap.net')).toBeInTheDocument();
    expect(screen.getByText('Ana Diaz')).toBeInTheDocument();
  });
});

describe('UserSelect owner suggestions', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url === OWNER_SUGGESTIONS_ENDPOINT) {
        const center = config?.params?.cost_center_id;
        const items = center === 'cc-1' ? SUGGESTED_CC1 : center === 'cc-2' ? SUGGESTED_CC2 : [];
        return { data: { items, has_more: false } };
      }
      if (url !== '/users/lookup') throw new Error(`unexpected ${url}`);
      return { data: { items: lookupPeople(config), has_more: false } };
    });
  });

  it('puts the cost centre people first, under their header, then the usual list without duplicates', async () => {
    wrap(<UserSelect value={null} onChange={() => undefined} suggestedFirst={{ costCenterId: 'cc-1' }} />);
    open(screen.getByRole('combobox'));
    const listbox = await screen.findByRole('listbox');
    await waitFor(() => expect(within(listbox).getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Zoe Zulu',
      'Ana Diaz',
      'admin@kanap.net',
      'fried@kanap.net selects.meSuffix',
    ]));
    expect(within(listbox).getByText('selects.costCenterAccess')).toBeInTheDocument();
    // One separator between the suggested group and the rest; me is not moved first any more.
    expect(within(listbox).getAllByRole('separator')).toHaveLength(1);
    expect(within(listbox).getAllByRole('option').filter((o) => o.textContent === 'Ana Diaz')).toHaveLength(1);
  });

  it('searches the usual lookup once a text is typed, without the group', async () => {
    const client = newClient();
    wrapWithClient(<UserSelect value={null} onChange={() => undefined} suggestedFirst={{ costCenterId: 'cc-1' }} />, client);
    const input = screen.getByRole('combobox');
    open(input);
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4));

    fireEvent.change(input, { target: { value: 'diaz' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(
      '/users/lookup',
      expect.objectContaining({ params: expect.objectContaining({ q: 'diaz' }) }),
    ));
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['Ana Diaz']));
    expect(screen.queryByText('selects.costCenterAccess')).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('keeps the usual lookup, me first, when the line has no cost centre', async () => {
    wrap(<UserSelect value={null} onChange={() => undefined} suggestedFirst={{ costCenterId: null }} />);
    open(screen.getByRole('combobox'));
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'fried@kanap.net selects.meSuffix',
      'Ana Diaz',
      'admin@kanap.net',
    ]));
    expect(screen.getByRole('separator')).toBeInTheDocument();
    expect(apiGet.mock.calls.some(([url]) => url === OWNER_SUGGESTIONS_ENDPOINT)).toBe(false);
  });

  it('reads the new group when the cost centre changes', async () => {
    const client = newClient();
    const view = wrapWithClient(
      <UserSelect value={null} onChange={() => undefined} suggestedFirst={{ costCenterId: 'cc-1' }} />,
      client,
    );
    open(screen.getByRole('combobox'));
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(4));

    view.rerender(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <UserSelect value={null} onChange={() => undefined} suggestedFirst={{ costCenterId: 'cc-2' }} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith(
      OWNER_SUGGESTIONS_ENDPOINT,
      expect.objectContaining({ params: { cost_center_id: 'cc-2' } }),
    ));
    await waitFor(() => expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual([
      'Bob Brown',
      'Ana Diaz',
      'admin@kanap.net',
      'fried@kanap.net selects.meSuffix',
    ]));
  });
});
