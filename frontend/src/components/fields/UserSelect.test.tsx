import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

function open(input: HTMLElement) {
  fireEvent.mouseDown(input);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
}

describe('person pickers with two accounts of one name', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      if (url !== '/users/lookup') throw new Error(`unexpected ${url}`);
      const ids = config?.params?.ids;
      if (ids) {
        const wanted = String(ids).split(',');
        return { data: { items: PEOPLE.filter((p) => wanted.includes(p.id)), has_more: false } };
      }
      return { data: { items: PEOPLE, has_more: false } };
    });
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
