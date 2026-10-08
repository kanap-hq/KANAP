import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminPlatformAiPage from './AdminPlatformAiPage';
import { createAppTheme } from '../../config/ThemeContext';
import api from '../../api';

// The platform console names the included model's provider and where it processes data,
// as workspaces see them; changing either asks every workspace to confirm again, so the
// console says so before saving.

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ claims: { isPlatformAdmin: true } }),
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

let config: Record<string, unknown>;

function platformConfig(overrides: Record<string, unknown>) {
  return {
    id: 'platform-1',
    provider: 'anthropic',
    model: 'claude-included-1',
    endpoint_url: null,
    rate_limit_tenant_per_minute: 30,
    rate_limit_user_per_hour: 60,
    updated_at: '2026-10-01T10:00:00.000Z',
    updated_by: null,
    has_api_key: true,
    disclosure_name: 'Anthropic',
    disclosure_location: 'US',
    disclosure_key: 'Anthropic|US',
    ...overrides,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminPlatformAiPage />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const ASK_AGAIN = 'Every workspace that uses the included model will be asked to confirm again before its next AI request.';
const MISSING = 'Enter the provider name and the processing location shown to customers before saving.';

describe('AdminPlatformAiPage included model identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config = platformConfig({});
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/admin/ai/config') {
        return Promise.resolve({
          data: {
            config,
            available_providers: [{ id: 'anthropic', label: 'Anthropic', description: '', capabilities: {} }],
            free_monthly_message_limit: 100,
            usage: [],
          },
        });
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    (api.patch as any).mockResolvedValue({ data: { config } });
  });

  it('shows the provider name and the processing location, with locations named in the interface language', async () => {
    renderPage();
    const name = await screen.findByLabelText('Provider name shown to customers');
    expect(name).toHaveValue('Anthropic');
    const location = screen.getByRole('combobox', { name: 'Where data is processed' });
    expect(location).toHaveTextContent('United States');

    fireEvent.mouseDown(location);
    const listbox = await screen.findByRole('listbox');
    for (const label of ['European Union', 'United States', 'United Kingdom', 'Switzerland', 'Canada', 'Japan', 'Australia', 'Singapore', 'India', 'China']) {
      expect(within(listbox).getByRole('option', { name: label })).toBeInTheDocument();
    }
  });

  it('asks before saving a new provider name or location, then saves it', async () => {
    renderPage();
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'Where data is processed' }));
    fireEvent.click(await screen.findByRole('option', { name: 'European Union' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(ASK_AGAIN)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and ask again' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/ai/config', { disclosure_location: 'EU' }));
  });

  it('saves a new model without asking: workspaces keep their confirmation', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Model'), { target: { value: 'claude-included-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/ai/config', { model: 'claude-included-2' }));
    expect(screen.queryByText(ASK_AGAIN)).not.toBeInTheDocument();
  });

  it('sends the shown name and location again with a new endpoint, after asking', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Endpoint URL'), { target: { value: 'https://llm-gateway.example.com/v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(ASK_AGAIN)).toBeInTheDocument();
    expect(within(dialog).getByText('Workspaces will see: Anthropic, processing location: United States.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save and ask again' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/ai/config', {
      endpoint_url: 'https://llm-gateway.example.com/v1',
      disclosure_name: 'Anthropic',
      disclosure_location: 'US',
    }));
  });

  it('stops a new endpoint saved without the shown name and location, and flags both fields', async () => {
    config = platformConfig({ disclosure_name: null, disclosure_location: null, disclosure_key: null });
    renderPage();
    const location = await screen.findByRole('combobox', { name: 'Where data is processed' });
    expect(location).toHaveTextContent('e.g. United States');
    fireEvent.mouseDown(location);
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).queryByRole('option', { name: 'Not set' })).not.toBeInTheDocument();
    fireEvent.keyDown(listbox, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());

    fireEvent.change(screen.getByLabelText('Endpoint URL'), { target: { value: 'https://llm-gateway.example.com/v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Provider name shown to customers')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('combobox', { name: 'Where data is processed' }).closest('.MuiInputBase-root')).toHaveClass('Mui-error');

    // Filled in: saved with the change.
    fireEvent.change(screen.getByLabelText('Provider name shown to customers'), { target: { value: 'Anthropic' } });
    expect(screen.getByLabelText('Provider name shown to customers')).toHaveAttribute('aria-invalid', 'false');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Where data is processed' }));
    fireEvent.click(await screen.findByRole('option', { name: 'United States' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/ai/config', {
      endpoint_url: 'https://llm-gateway.example.com/v1',
      disclosure_name: 'Anthropic',
      disclosure_location: 'US',
    }));
  });

  it('stops a save that empties the shown name', async () => {
    renderPage();
    fireEvent.change(await screen.findByLabelText('Provider name shown to customers'), { target: { value: '  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(MISSING)).toBeInTheDocument();
    expect(api.patch).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Provider name shown to customers')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('combobox', { name: 'Where data is processed' }).closest('.MuiInputBase-root')).not.toHaveClass('Mui-error');
  });

  it('fills the identity for the first time without asking', async () => {
    config = platformConfig({ disclosure_name: null, disclosure_location: null, disclosure_key: null });
    renderPage();
    fireEvent.change(await screen.findByLabelText('Provider name shown to customers'), { target: { value: ' Anthropic ' } });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Where data is processed' }));
    fireEvent.click(await screen.findByRole('option', { name: 'United States' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/admin/ai/config', {
      disclosure_name: 'Anthropic',
      disclosure_location: 'US',
    }));
    expect(screen.queryByText(ASK_AGAIN)).not.toBeInTheDocument();
  });
});
