import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAiModelsPage from './AdminAiModelsPage';
import { createAppTheme } from '../../config/ThemeContext';
import api from '../../api';
import { KanapDialogProvider } from '../../components/design';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: { features: { aiSettings: true, builtinAiProvider: false } },
  }),
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <div>{title}{actions}</div>,
}));

const MODEL = {
  id: 'model-1',
  name: 'Mistral medium',
  provider: 'openai',
  model: 'mistral-medium-latest',
  endpoint_url: 'https://api.mistral.ai/v1',
  has_api_key: true,
  supports_vision: false,
  price_input_eur_per_mtok: 0.4,
  price_output_eur_per_mtok: 2,
  price_cache_read_eur_per_mtok: 0.04,
  llm_timeout_ms: null,
  status: 'active',
  is_default: true,
  used_by: { chat: true, agents: [] },
  messages_this_month: 3,
  validation_errors: [],
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-01T10:00:00.000Z',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <KanapDialogProvider>
            <AdminAiModelsPage />
          </KanapDialogProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

async function openEditDialog() {
  renderPage();
  await screen.findByText('Mistral medium');
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  return screen.findByPlaceholderText('e.g., 0.30');
}

describe('AdminAiModelsPage cache read cost', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => {
      switch (url) {
        case '/ai/model-configs':
          return Promise.resolve({ data: { model_configs: [MODEL], secret_writable: true } });
        case '/ai/settings':
          return Promise.resolve({
            data: {
              available_providers: [{
                id: 'openai',
                label: 'OpenAI',
                description: 'OpenAI API',
                capabilities: {
                  supportsStreaming: true,
                  supportsToolCalling: true,
                  requiresApiKey: true,
                  allowsCustomEndpoint: true,
                },
              }, {
                id: 'ollama',
                label: 'Ollama',
                description: 'Local models',
                capabilities: {
                  supportsStreaming: true,
                  supportsToolCalling: true,
                  requiresApiKey: false,
                  allowsCustomEndpoint: true,
                },
              }],
            },
          });
        default:
          throw new Error(`Unexpected GET ${url}`);
      }
    });
    (api.patch as any).mockResolvedValue({ data: MODEL });
  });

  it('shows the stored cache read cost and sends a new one', async () => {
    const field = await openEditDialog();
    expect(screen.getByText('Cache read cost')).toBeInTheDocument();
    expect(field).toHaveValue('0.04');

    fireEvent.change(field, { target: { value: '0,05' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect((api.patch as any).mock.calls[0][0]).toBe('/ai/model-configs/model-1');
    expect((api.patch as any).mock.calls[0][1]).toMatchObject({
      price_input_eur_per_mtok: 0.4,
      price_output_eur_per_mtok: 2,
      price_cache_read_eur_per_mtok: 0.05,
    });
  });

  it('sends an empty cache read cost as null', async () => {
    const field = await openEditDialog();
    fireEvent.change(field, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect((api.patch as any).mock.calls[0][1]).toMatchObject({ price_cache_read_eur_per_mtok: null });
  });

  it('blocks saving an invalid cache read cost, as for the other two costs', async () => {
    const field = await openEditDialog();
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();

    fireEvent.change(field, { target: { value: '-1' } });
    expect(save).toBeDisabled();
    fireEvent.change(field, { target: { value: 'abc' } });
    expect(save).toBeDisabled();
    fireEvent.click(save);
    expect(api.patch).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: '0' } });
    expect(save).toBeEnabled();
  });

  async function switchToOllama() {
    const dialog = screen.getByRole('dialog');
    fireEvent.mouseDown(within(dialog).getByText('OpenAI'));
    fireEvent.click(await screen.findByRole('option', { name: 'Ollama' }));
  }

  it('sets every empty cost to 0 when the provider becomes Ollama', async () => {
    const cacheRead = await openEditDialog();
    const input = screen.getByPlaceholderText('e.g., 3.00');
    const output = screen.getByPlaceholderText('e.g., 15.00');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(output, { target: { value: '' } });
    fireEvent.change(cacheRead, { target: { value: '' } });

    await switchToOllama();

    expect(input).toHaveValue('0');
    expect(output).toHaveValue('0');
    expect(cacheRead).toHaveValue('0');
  });

  it('keeps a cache read cost already entered when the provider becomes Ollama', async () => {
    const cacheRead = await openEditDialog();
    const input = screen.getByPlaceholderText('e.g., 3.00');
    const output = screen.getByPlaceholderText('e.g., 15.00');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(output, { target: { value: '' } });
    fireEvent.change(cacheRead, { target: { value: '0,05' } });

    await switchToOllama();

    expect(input).toHaveValue('0');
    expect(output).toHaveValue('0');
    expect(cacheRead).toHaveValue('0,05');
  });
});
