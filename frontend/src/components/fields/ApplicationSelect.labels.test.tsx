import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import ApplicationSelect from './ApplicationSelect';

const get = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ default: { get } }));
vi.mock('../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [{ code: 'low', label: 'Faible' }] } }),
}));
vi.mock('../../hooks/useItOpsSettings', () => ({
  useItOpsSettings: () => ({
    data: { lifecycleStates: [{ code: 'active', label: 'Active' }] },
  }),
  default: () => ({
    data: { lifecycleStates: [{ code: 'active', label: 'Active' }] },
  }),
}));

function renderPicker() {
  get.mockResolvedValue({
    data: {
      items: [
        { id: 'a1', name: 'Facturation', lifecycle: 'active', criticality: 'low' },
        { id: 'a2', name: 'Archive', lifecycle: 'active', criticality: '' },
      ],
    },
  });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ApplicationSelect value={null} onChange={() => undefined} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('ApplicationSelect labels', () => {
  beforeEach(async () => {
    get.mockReset();
    await i18n.changeLanguage('fr');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('en');
  });

  it('shows lifecycle and criticality by their labels', async () => {
    renderPicker();
    const input = await screen.findByRole('combobox');
    await waitFor(() => expect(input).not.toBeDisabled());
    act(() => { input.focus(); });
    fireEvent.mouseDown(input);

    const facturation = await screen.findByRole('option', { name: 'Facturation' });
    expect(facturation).toHaveAccessibleDescription('Actif · Faible');
    expect(facturation.textContent).not.toMatch(/\bactive\b/);
    expect(facturation.textContent).not.toMatch(/\blow\b/);

    const archive = screen.getByRole('option', { name: 'Archive' });
    expect(archive).toHaveAccessibleDescription('Actif');
    expect(archive.textContent).not.toContain('·');
  });
});
