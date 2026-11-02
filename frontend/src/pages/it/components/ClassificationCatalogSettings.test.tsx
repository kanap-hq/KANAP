import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { createAppTheme } from '../../../config/ThemeContext';
import type { ItOpsSettings } from '../../../services/itOpsSettings';
import ClassificationCatalogSettings from './ClassificationCatalogSettings';

const serviceMocks = vi.hoisted(() => ({
  updateItOpsSettings: vi.fn(),
  fetchCatalogUsage: vi.fn(),
}));

vi.mock('../../../services/itOpsSettings', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../services/itOpsSettings')>(),
  updateItOpsSettings: serviceMocks.updateItOpsSettings,
  fetchCatalogUsage: serviceMocks.fetchCatalogUsage,
}));

const settings = {
  businessCriticalityLevels: [
    { code: 'critical', label: 'Critical', description: 'At most four hours', rank: 3, maxMtdMinutes: 240 },
    { code: 'high', label: 'High', description: 'Up to one day', rank: 2, maxMtdMinutes: 1440 },
    { code: 'low', label: 'Low', description: 'More than a day', rank: 1, maxMtdMinutes: null },
  ],
  cyberCriticalityLevels: [
    { code: 'critical', label: 'Critical', description: 'Catastrophic consequences', rank: 4 },
  ],
  dataClasses: [
    { code: 'restricted', label: 'Restricted', description: 'Strict disclosure controls', rank: 4 },
  ],
  recoveryWaves: [
    { code: 'vital', label: 'V1 — Vital activities', description: 'Restore vital activities', order: 1 },
  ],
} as unknown as ItOpsSettings;

function renderSettings() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <ClassificationCatalogSettings settings={settings} />
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Edit catalog' }));
}

describe('ClassificationCatalogSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.updateItOpsSettings.mockResolvedValue(settings);
  });

  it('gives each classification catalog its own name example', () => {
    renderSettings();
    const names = screen.getAllByRole('textbox', { name: 'Name' });
    expect(names.map((field) => field.getAttribute('placeholder'))).toEqual([
      'e.g., Critical', 'e.g., Critical', 'e.g., Critical',
      'e.g., High',
      'e.g., Confidential',
      'e.g., Foundation',
    ]);
  });

  it('saves in one step, with the rows in their displayed order', async () => {
    renderSettings();
    expect(screen.queryByRole('button', { name: /Preview/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(serviceMocks.updateItOpsSettings).toHaveBeenCalledTimes(1));
    const payload = serviceMocks.updateItOpsSettings.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(['businessCriticalityLevels', 'cyberCriticalityLevels', 'dataClasses', 'recoveryWaves']);
    expect(payload.businessCriticalityLevels.map((level: any) => level.code)).toEqual(['critical', 'high', 'low']);
  });

  it('reorders with the arrows and lets the server derive ranks from the new order', async () => {
    renderSettings();
    const moveUp = screen.getAllByRole('button', { name: 'Move up' });
    const moveDown = screen.getAllByRole('button', { name: 'Move down' });
    expect(moveUp[0]).toBeDisabled();
    expect(moveDown[2]).toBeDisabled();
    fireEvent.click(moveUp[1]);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(serviceMocks.updateItOpsSettings).toHaveBeenCalledTimes(1));
    const payload = serviceMocks.updateItOpsSettings.mock.calls[0][0];
    expect(payload.businessCriticalityLevels.map((level: any) => level.code)).toEqual(['high', 'critical', 'low']);
  });

  it('keeps the downtime optional and disables saving while a level has no name or a duplicate name', () => {
    renderSettings();
    const downtimes = screen.getAllByRole('spinbutton', { name: 'Maximum tolerable downtime (minutes)' });
    expect(downtimes[2]).toHaveValue(null);
    expect(screen.queryByRole('textbox', { name: 'Code' })).not.toBeInTheDocument();
    expect(screen.getAllByText((_, node) => node?.textContent === 'Name*').length).toBeGreaterThan(0);
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Name' })[0], { target: { value: ' ' } });
    expect(screen.queryByText('A name is required')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Name' })[0], { target: { value: 'low' } });
    expect(screen.getAllByText('This name already exists')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('adds a level without a code: the server generates it', async () => {
    renderSettings();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add level' })[0]);
    fireEvent.change(screen.getAllByRole('textbox', { name: 'Name' })[3], { target: { value: 'Vital' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(serviceMocks.updateItOpsSettings).toHaveBeenCalledTimes(1));
    const added = serviceMocks.updateItOpsSettings.mock.calls[0][0].businessCriticalityLevels[3];
    expect([added.code, added.label]).toEqual(['', 'Vital']);
    expect(serviceMocks.fetchCatalogUsage).not.toHaveBeenCalled();
  });

  it('protects the removal of a used level', async () => {
    renderSettings();
    serviceMocks.fetchCatalogUsage.mockResolvedValueOnce({ total: 2, usage: [{ record: 'applications', count: 2 }] });
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0]);
    expect(await screen.findByText('Value still in use')).toBeInTheDocument();
    expect(serviceMocks.fetchCatalogUsage).toHaveBeenCalledWith('businessCriticalityLevels', { code: 'critical' });
    fireEvent.click(screen.getByRole('button', { name: 'No longer offered' }));
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: 'No longer offered Critical' })[0]).toBeChecked());
  });

  it('shows the levels as text and hides editing when read-only', () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={client}>
          <ThemeProvider theme={createAppTheme('light')}>
            <ClassificationCatalogSettings settings={settings} readOnly />
          </ThemeProvider>
        </QueryClientProvider>
      </MemoryRouter>,
    );
    expect(screen.queryByRole('button', { name: 'Edit catalog' })).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add level' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByText('Business criticality')).toBeInTheDocument();
    expect(screen.getByText('Critical, High, Low')).toBeInTheDocument();
    expect(screen.getByText('V1 — Vital activities')).toBeInTheDocument();
  });
});
