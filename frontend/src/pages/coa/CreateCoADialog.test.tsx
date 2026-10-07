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
    fireEvent.click(screen.getByRole('checkbox', { name: 'Make it the country default' }));
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

  describe('from a template', () => {
    const templates = [
      { id: 'pcg', country_iso: 'FR', template_code: 'FR-PCG', template_name: 'Plan Comptable General', version: '2025' },
      { id: 'skr', country_iso: 'DE', template_code: 'DE-SKR04', template_name: 'Kontenrahmen SKR 04', version: '2025' },
      { id: 'ifrs', country_iso: null, template_code: 'IFRS', template_name: 'IFRS group accounts', version: '2025', is_global: true },
    ];

    async function pickTemplate(name: RegExp) {
      fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Template' }));
      fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name }));
    }

    beforeEach(() => {
      api.get.mockResolvedValue({ data: { items: templates } });
    });

    it('proposes the template code and name once, and lets the user clear and retype them', async () => {
      renderDialog();
      fireEvent.click(screen.getByRole('radio', { name: 'A template' }));
      await waitFor(() => expect(api.get).toHaveBeenCalledWith('/chart-of-accounts/templates'));
      await pickTemplate(/^Plan Comptable General/);

      const code = screen.getByRole('textbox', { name: 'Code' });
      const name = screen.getByRole('textbox', { name: 'Name' });
      expect(code).toHaveValue('FR-PCG');
      expect(name).toHaveValue('Plan Comptable General');
      expect(screen.getByRole('combobox', { name: 'Country' })).toHaveTextContent('France');

      fireEvent.change(code, { target: { value: '' } });
      expect(code).toHaveValue('');
      fireEvent.change(code, { target: { value: 'FR-LOCAL' } });
      fireEvent.change(name, { target: { value: '' } });
      expect(name).toHaveValue('');

      // Another template replaces only what the previous one proposed.
      await pickTemplate(/^Kontenrahmen SKR 04/);
      expect(code).toHaveValue('FR-LOCAL');
      expect(name).toHaveValue('Kontenrahmen SKR 04');
      expect(screen.getByRole('combobox', { name: 'Country' })).toHaveTextContent('Germany');
    });

    it('fixes the coverage to every country for a global template', async () => {
      renderDialog();
      fireEvent.click(screen.getByRole('radio', { name: 'A template' }));
      await waitFor(() => expect(api.get).toHaveBeenCalled());
      await pickTemplate(/^IFRS group accounts/);

      expect(screen.getByRole('textbox', { name: 'Code' })).toHaveValue('IFRS');
      expect(screen.getByRole('radio', { name: 'All countries' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'All countries' })).toBeDisabled();
      expect(screen.getByRole('radio', { name: 'One country' })).toBeDisabled();
      expect(screen.queryByRole('combobox', { name: 'Country' })).not.toBeInTheDocument();

      // A country template frees the choice again.
      await pickTemplate(/^Plan Comptable General/);
      expect(screen.getByRole('radio', { name: 'One country' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'All countries' })).not.toBeDisabled();
      fireEvent.click(screen.getByRole('radio', { name: 'All countries' }));
      expect(screen.getByRole('radio', { name: 'All countries' })).toBeChecked();
    });
  });
});
