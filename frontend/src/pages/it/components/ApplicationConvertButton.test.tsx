import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design';
import ApplicationConvertButton, { type ConversionPreview } from './ApplicationConvertButton';

const get = vi.fn();
const post = vi.fn();
vi.mock('../../../api', () => ({ default: { get: (...args: any[]) => get(...args), post: (...args: any[]) => post(...args) } }));
const settings = { data: { technologyFamilies: [{ code: 'hypervisor', label: 'Hypervisor' }, { code: 'database', label: 'Database' }] } };
vi.mock('../../../hooks/useLocalizedItOpsSettings', () => ({ useLocalizedItOpsSettings: () => settings }));

const zeroLosses = {
  instances: 2, suites: 0, predecessor: 0, successors: 0, data_residency: 0, support_contacts: 0, knowledge_links: 0,
  managed_documents: 0, tasks: 0, requests: 0, business_processes: 0, technologies: 0,
};

function preview(extra: Partial<ConversionPreview> = {}): ConversionPreview {
  return {
    application: { id: 'app-1', name: 'vSphere', reference: 'APP-7' },
    mode: 'installed',
    refusals: [],
    moves: { owners: 2, contracts: 1, budget_lines: 2, projects: 0, links: 0, attachments: 1, incidents: 0, servers: 3 },
    losses: zeroLosses,
    ...extra,
  };
}

function renderButton() {
  const onConverted = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={queryClient}>
        <KanapDialogProvider>
          <ApplicationConvertButton applicationId="app-1" applicationName="vSphere" onConverted={onConverted} />
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return { onConverted };
}

describe('ApplicationConvertButton', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
  });

  it('shows the test, what moves and what is lost, and converts once a family is chosen', async () => {
    get.mockResolvedValue({ data: preview() });
    post.mockResolvedValue({ data: { technology: { id: 'tec-9', reference: 'TEC-9', name: 'vSphere' } } });
    const { onConverted } = renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Convert to technology' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/another application can fail or become vulnerable/)).toBeInTheDocument();
    await within(dialog).findByText('Moves to the technology');
    expect(get).toHaveBeenCalledWith('/applications/app-1/conversion-preview');
    const ownersRow = within(dialog).getByText('Owners').parentElement!;
    expect(within(ownersRow).getByText('2')).toBeInTheDocument();
    expect(within(within(dialog).getByText('Servers').parentElement!).getByText('3')).toBeInTheDocument();
    expect(within(dialog).queryByText('Projects')).not.toBeInTheDocument();
    expect(within(within(dialog).getByText('Deployments and environments').parentElement!).getByText('2')).toBeInTheDocument();
    expect(within(dialog).getByText(/the reference APP-7/)).toBeInTheDocument();
    expect(within(dialog).getByText(/installed on its servers/)).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: 'Convert' });
    expect(confirm).toBeDisabled();
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Family' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Hypervisor' }));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(onConverted).toHaveBeenCalledWith('tec-9'));
    expect(post).toHaveBeenCalledWith('/applications/app-1/convert-to-technology', { family: 'hypervisor' });
  });

  it('explains a refusal and offers no conversion', async () => {
    get.mockResolvedValue({ data: preview({ refusals: [{ reason: 'interfaces', count: 3 }, { reason: 'name_taken', count: 1 }] }) });
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Convert to technology' }));
    const dialog = await screen.findByRole('dialog');
    const alert = await within(dialog).findByRole('alert');
    expect(within(alert).getByText('This application cannot be converted:')).toBeInTheDocument();
    expect(within(alert).getByText('Source or target of interfaces: 3')).toBeInTheDocument();
    expect(within(alert).getByText('A technology with this name already exists')).toBeInTheDocument();
    expect(within(dialog).queryByRole('combobox', { name: 'Family' })).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Convert' })).toBeDisabled();
    expect(post).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the reason when the conversion fails', async () => {
    get.mockResolvedValue({ data: preview() });
    post.mockRejectedValue({ response: { status: 500, data: { message: 'Server unavailable' } } });
    const { onConverted } = renderButton();
    fireEvent.click(screen.getByRole('button', { name: 'Convert to technology' }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText('Moves to the technology');
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Family' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Database' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Convert' }));
    await waitFor(() => expect(post).toHaveBeenCalled());
    expect(await within(dialog).findByText(/Server unavailable|The conversion failed/)).toBeInTheDocument();
    expect(onConverted).not.toHaveBeenCalled();
  });
});
