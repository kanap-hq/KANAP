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
vi.mock('../../api', () => ({ default: { get: vi.fn() } }));

import api from '../../api';
import BusinessProcessMultiSelect from './BusinessProcessMultiSelect';
import BusinessProcessSelect from './BusinessProcessSelect';

const apiGet = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

const PROCESSES = [
  { id: 'aging', name: 'Aging', path: 'Production › Aging', status: 'enabled' },
  { id: 'other', name: 'Aging', path: 'Sales › Aging', status: 'enabled' },
  { id: 'production', name: 'Production', path: 'Production', status: 'enabled' },
];

function serve() {
  apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url !== '/business-processes/lookup') throw new Error(`unexpected ${url}`);
    const params = config?.params ?? {};
    if (params.ids) {
      const ids = String(params.ids).split(',');
      return { data: { items: PROCESSES.filter((row) => ids.includes(row.id)), has_more: false } };
    }
    const q = String(params.q ?? '').toLowerCase();
    const items = q
      ? PROCESSES.filter((row) => row.name.toLowerCase().includes(q) || row.path.toLowerCase().includes(q))
      : PROCESSES;
    return { data: { items, has_more: false } };
  });
}

function wrap(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>{ui}</ThemeProvider>
    </QueryClientProvider>,
  );
}

function openList() {
  const input = screen.getByRole('combobox');
  act(() => { input.focus(); });
  fireEvent.mouseDown(input);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
}

describe('BusinessProcessSelect', () => {
  beforeEach(() => {
    apiGet.mockReset();
    serve();
  });

  it('lists each process by its path', async () => {
    wrap(<BusinessProcessSelect value={null} onChange={() => undefined} />);
    openList();
    expect(await screen.findByRole('option', { name: 'Production › Aging' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sales › Aging' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Production' })).toBeInTheDocument();
  });

  it('keeps the chosen name in the field, with the path as a tooltip', async () => {
    wrap(<BusinessProcessSelect value="aging" onChange={() => undefined} />);
    const input = screen.getByRole('combobox');
    await waitFor(() => expect(input).toHaveValue('Aging'));
    expect(input).toHaveAttribute('title', 'Production › Aging');
  });

  it('gives a top-level process no path tooltip', async () => {
    wrap(<BusinessProcessSelect value="production" onChange={() => undefined} />);
    const input = screen.getByRole('combobox');
    await waitFor(() => expect(input).toHaveValue('Production'));
    expect(input).not.toHaveAttribute('title');
  });
});

describe('BusinessProcessMultiSelect', () => {
  beforeEach(() => {
    apiGet.mockReset();
    serve();
  });

  it('lists the path and keeps the name on the chip, with the path as a tooltip', async () => {
    wrap(<BusinessProcessMultiSelect value={['aging', 'production']} onChange={() => undefined} />);
    const aging = await screen.findByText('Aging');
    expect(aging.closest('.MuiChip-root')).toHaveAttribute('title', 'Production › Aging');
    const production = screen.getByText('Production');
    expect(production.closest('.MuiChip-root')).not.toHaveAttribute('title');
    openList();
    expect(await screen.findByRole('option', { name: 'Sales › Aging' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Production › Aging' })).toBeInTheDocument();
  });
});
