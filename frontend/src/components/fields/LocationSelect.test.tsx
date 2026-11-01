import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../design';
import LocationSelect from './LocationSelect';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ create: true }));

vi.mock('../../api', () => ({ default: { get, post } }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string, level: string) => resource === 'locations' && level === 'member' && auth.create }),
}));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    byField: {
      hostingType: [
        { code: 'old_dc', label: 'Old data center', deprecated: true },
        { code: 'on_prem', label: 'On-premises' },
        { code: 'cloud', label: 'Public cloud' },
      ],
    },
  }),
}));

function renderSelect(onChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <LocationSelect value={null} onChange={onChange} hideLabel required />
          </KanapDialogProvider>
        </ThemeProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  );
  return onChange;
}

describe('LocationSelect', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
    auth.create = true;
    get.mockReset().mockResolvedValue({ data: { items: [{ id: 'loc-1', location_reference: 'LOC-1', name: 'Lyon' }] } });
    post.mockReset().mockResolvedValue({ data: { id: 'loc-2', location_reference: 'LOC-2', name: 'Paris' } });
  });
  afterEach(() => cleanup());

  it('creates the site typed in the field and chooses it, without leaving the form', async () => {
    const onChange = renderSelect();
    const input = screen.getByRole('combobox');
    input.focus();
    fireEvent.change(input, { target: { value: 'Paris' } });
    fireEvent.click(await screen.findByRole('option', { name: '+ Create location "Paris"' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('New location')).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Paris');
    expect(within(dialog).getByRole('combobox', { name: 'Hosting type' })).toHaveTextContent('On-premises');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/locations', { name: 'Paris', hosting_type: 'on_prem' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('loc-2'));
  });

  it('offers a new site in an empty list, and none when a site has the typed name', async () => {
    get.mockResolvedValue({ data: { items: [] } });
    renderSelect();
    fireEvent.mouseDown(screen.getByRole('combobox'));
    expect(await screen.findByRole('option', { name: '+ New location' })).toBeInTheDocument();
    cleanup();
    get.mockResolvedValue({ data: { items: [{ id: 'loc-1', location_reference: 'LOC-1', name: 'Lyon' }] } });
    renderSelect();
    screen.getByRole('combobox').focus();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'lyon' } });
    expect(await screen.findByRole('option', { name: /Lyon/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Create location/ })).not.toBeInTheDocument();
  });

  it('offers no creation without the right to create a site', async () => {
    auth.create = false;
    renderSelect();
    screen.getByRole('combobox').focus();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'Paris' } });
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole('option', { name: /Create location/ })).not.toBeInTheDocument();
  });
});
