import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('../../api', () => ({ default: api }));

import CreateCoADialog from './CreateCoADialog';

function renderDialog() {
  const onCreated = vi.fn();
  const onClose = vi.fn();
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <CreateCoADialog open onClose={onClose} onCreated={onCreated} />
    </ThemeProvider>,
  );
  return { onCreated, onClose };
}

describe('CreateCoADialog', () => {
  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    api.post.mockResolvedValue({ data: { id: 'new-chart' } });
  });

  it('uses plain labels above the fields and plain coverage choices', () => {
    renderDialog();
    for (const label of ['Start from', 'Code', 'Name', 'Used for', 'Country']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('radio', { name: 'One country' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'All countries' })).not.toBeChecked();
    expect(screen.queryByText('Global')).not.toBeInTheDocument();
  });

  it('requires a country for a one-country chart, then creates it as the country default', async () => {
    const { onCreated } = renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: 'Code' }), { target: { value: 'FR-LOCAL' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Local chart' } });

    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Choose a country.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Country' }));
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'France' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Make it the default for France' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/chart-of-accounts', {
      code: 'FR-LOCAL',
      name: 'Local chart',
      scope: 'COUNTRY',
      country_iso: 'FR',
      is_default: true,
    }));
    expect(onCreated).toHaveBeenCalledWith('new-chart');
  });

  it('creates an all-countries chart without country or default', async () => {
    renderDialog();
    fireEvent.change(screen.getByRole('textbox', { name: 'Code' }), { target: { value: 'GROUP' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Group chart' } });
    fireEvent.click(screen.getByRole('radio', { name: 'All countries' }));
    expect(screen.queryByRole('combobox', { name: 'Country' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/chart-of-accounts', {
      code: 'GROUP',
      name: 'Group chart',
      scope: 'GLOBAL',
      is_default: false,
    }));
  });
});
