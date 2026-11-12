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

const localeState = vi.hoisted(() => ({ current: 'en' }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => localeState.current }));

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
  reasoning_effort: null,
  llm_timeout_ms: null,
  status: 'active',
  is_default: true,
  used_by: { chat: true, agents: [] },
  messages_this_month: 3,
  validation_errors: [],
  created_at: '2026-10-01T10:00:00.000Z',
  updated_at: '2026-10-01T10:00:00.000Z',
};

// The levels the backend's reasoning-effort capability gives for these providers and models.
const ALL_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
function effortSupport(provider: string, model: string) {
  if (provider === 'anthropic') {
    const levels = model === 'claude-sonnet-4-6'
      ? ['low', 'medium', 'high', 'max']
      : model === 'claude-opus-5-5' ? ALL_LEVELS : [];
    return { levels, server_may_ignore: false };
  }
  return { levels: ALL_LEVELS, server_may_ignore: provider !== 'openai' };
}

function withModel(overrides: Record<string, unknown>) {
  const original = (api.get as any).getMockImplementation();
  (api.get as any).mockImplementation((url: string, config?: any) => (url === '/ai/model-configs'
    ? Promise.resolve({ data: { model_configs: [{ ...MODEL, ...overrides }], secret_writable: true } })
    : original(url, config)));
}

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

describe('AdminAiModelsPage model dialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localeState.current = 'en';
    (api.get as any).mockImplementation((url: string, config?: { params?: { provider: string; model: string } }) => {
      switch (url) {
        case '/ai/model-configs/reasoning-efforts':
          return Promise.resolve({ data: effortSupport(config!.params!.provider, config!.params!.model) });
        case '/ai/model-configs':
          return Promise.resolve({ data: { model_configs: [MODEL], secret_writable: true } });
        case '/ai/settings':
          return Promise.resolve({
            data: {
              available_providers: [{
                id: 'anthropic',
                label: 'Anthropic',
                description: 'Anthropic API',
                capabilities: {
                  supportsStreaming: true,
                  supportsToolCalling: true,
                  requiresApiKey: true,
                  allowsCustomEndpoint: false,
                },
              }, {
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

  it('shows the stored prices with the decimal separator of the user language', async () => {
    localeState.current = 'fr';
    const field = await openEditDialog();
    expect(field).toHaveValue('0,04');
    expect(screen.getByDisplayValue('0,4')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect((api.patch as any).mock.calls[0][1]).toMatchObject({
      price_input_eur_per_mtok: 0.4,
      price_output_eur_per_mtok: 2,
      price_cache_read_eur_per_mtok: 0.04,
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

  it('shows the reasoning effort at the provider default and sends the value chosen', async () => {
    await openEditDialog();
    expect(screen.getByText('Reasoning effort')).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: 'Reasoning effort' });
    expect(select).toHaveTextContent('Provider default');

    fireEvent.mouseDown(select);
    const options = await screen.findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Provider default', 'Low', 'Medium', 'High', 'Very high', 'Maximum',
    ]);
    fireEvent.click(screen.getByRole('option', { name: 'Very high' }));
    expect(select).toHaveTextContent('Very high');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect((api.patch as any).mock.calls[0][1]).toMatchObject({ reasoning_effort: 'xhigh' });
  });

  it('sends the provider default as null', async () => {
    withModel({ reasoning_effort: 'max' });
    await openEditDialog();
    const select = screen.getByRole('combobox', { name: 'Reasoning effort' });
    expect(select).toHaveTextContent('Maximum');

    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByRole('option', { name: 'Provider default' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect((api.patch as any).mock.calls[0][1]).toMatchObject({ reasoning_effort: null });
  });

  it('offers only the levels the Anthropic model accepts', async () => {
    withModel({ provider: 'anthropic', model: 'claude-sonnet-4-6', endpoint_url: null });
    await openEditDialog();
    const select = screen.getByRole('combobox', { name: 'Reasoning effort' });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(
      '/ai/model-configs/reasoning-efforts',
      { params: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
    ));

    await waitFor(async () => {
      fireEvent.mouseDown(select);
      const options = await screen.findAllByRole('option');
      expect(options.map((option) => option.textContent)).toEqual([
        'Provider default', 'Low', 'Medium', 'High', 'Maximum',
      ]);
    });
  });

  it('disables the effort, with a tooltip, for a model that takes none', async () => {
    withModel({ provider: 'anthropic', model: 'claude-haiku-4-5', endpoint_url: null });
    await openEditDialog();
    const select = screen.getByRole('combobox', { name: 'Reasoning effort' });
    await waitFor(() => expect(select).toHaveAttribute('aria-disabled', 'true'));
    expect(screen.getByLabelText('This model takes no reasoning effort.')).toBeInTheDocument();
    expect(select).toHaveTextContent('Provider default');
  });

  it('clears a level the new model does not accept', async () => {
    withModel({ provider: 'anthropic', model: 'claude-opus-5-5', endpoint_url: null, reasoning_effort: 'xhigh' });
    await openEditDialog();
    const select = screen.getByRole('combobox', { name: 'Reasoning effort' });
    expect(select).toHaveTextContent('Very high');

    fireEvent.change(screen.getByDisplayValue('claude-opus-5-5'), { target: { value: 'claude-sonnet-4-6' } });
    await waitFor(() => expect(select).toHaveTextContent('Provider default'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect((api.patch as any).mock.calls[0][1]).toMatchObject({ model: 'claude-sonnet-4-6', reasoning_effort: null });
  });

  it('shows the effort sent and the reasoning tokens in the test result', async () => {
    (api.post as any).mockResolvedValue({
      data: {
        ok: true,
        provider: 'openai',
        model: 'mistral-medium-latest',
        latency_ms: 420,
        message: 'Provider test succeeded.',
        validation_errors: [],
        reasoning_effort_sent: 'high',
        reasoning_tokens: 12,
      },
    });
    await openEditDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connection successful (420 ms). Effort sent: High. 12 reasoning tokens.')).toBeInTheDocument();

    (api.post as any).mockResolvedValue({
      data: {
        ok: true, provider: 'openai', model: 'mistral-medium-latest', latency_ms: 300,
        message: 'Provider test succeeded.', validation_errors: [], reasoning_effort_sent: null, reasoning_tokens: null,
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('Connection successful (300 ms). No effort sent.')).toBeInTheDocument();
  });

  it('tests the values on screen, saved or not', async () => {
    (api.post as any).mockResolvedValue({
      data: {
        ok: true, provider: 'openai', model: 'mistral-large-latest', latency_ms: 200,
        message: 'Provider test succeeded.', validation_errors: [], reasoning_effort_sent: null, reasoning_tokens: null,
      },
    });
    await openEditDialog();
    fireEvent.change(screen.getByDisplayValue('mistral-medium-latest'), { target: { value: 'mistral-large-latest' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect((api.post as any).mock.calls[0][0]).toBe('/ai/model-configs/model-1/test');
    expect((api.post as any).mock.calls[0][1]).toEqual({
      provider: 'openai',
      model: 'mistral-large-latest',
      endpoint_url: 'https://api.mistral.ai/v1',
      reasoning_effort: null,
    });
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('asks for the key again before testing a new address', async () => {
    (api.post as any).mockResolvedValue({
      data: {
        ok: false, provider: 'openai', model: 'mistral-medium-latest', latency_ms: 10,
        message: 'Provider settings are incomplete.', validation_errors: ['API key is required.'],
      },
    });
    await openEditDialog();
    const test = screen.getByRole('button', { name: 'Test connection' });
    fireEvent.change(screen.getByPlaceholderText('e.g., https://ai.example.com'), { target: { value: 'https://ai.example.com/v1' } });
    expect(screen.getByText('The address changed: enter it again.')).toBeInTheDocument();
    expect(test).toBeDisabled();
    fireEvent.click(test);
    expect(api.post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: 'sk-new' } });
    expect(test).toBeEnabled();
    fireEvent.click(test);
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect((api.post as any).mock.calls[0][1]).toMatchObject({ endpoint_url: 'https://ai.example.com/v1', api_key: 'sk-new' });
    expect(await screen.findByText('Provider settings are incomplete. API key is required.')).toBeInTheDocument();
  });

  it('tests a new model before it is created', async () => {
    (api.post as any).mockResolvedValue({
      data: {
        ok: true, provider: 'openai', model: 'gpt-5-mini', latency_ms: 150,
        message: 'Provider test succeeded.', validation_errors: [], reasoning_effort_sent: null, reasoning_tokens: null,
      },
    });
    renderPage();
    await screen.findByText('Mistral medium');
    fireEvent.click(screen.getByRole('button', { name: 'New model' }));
    const test = await screen.findByRole('button', { name: 'Test connection' });
    expect(test).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText('e.g., claude-sonnet-5'), { target: { value: 'claude-sonnet-5' } });
    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: 'sk-typed' } });
    expect(test).toBeEnabled();
    fireEvent.click(test);

    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    expect((api.post as any).mock.calls[0][0]).toBe('/ai/model-configs/test');
    expect((api.post as any).mock.calls[0][1]).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      endpoint_url: null,
      reasoning_effort: null,
      api_key: 'sk-typed',
    });
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

  it('keeps every level for Ollama, with a tooltip that the server may ignore it', async () => {
    withModel({ reasoning_effort: 'max' });
    await openEditDialog();
    await switchToOllama();
    expect(await screen.findByLabelText('This server may ignore the reasoning effort. “Test connection” shows whether the model reasoned.'))
      .toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Reasoning effort' })).toHaveTextContent('Maximum');
  });

  it('empties the saved key when the address changes and asks for it again', async () => {
    await openEditDialog();
    const save = screen.getByRole('button', { name: 'Save' });
    const endpoint = screen.getByPlaceholderText('e.g., https://ai.example.com');

    // Another spelling of the saved address keeps the key.
    fireEvent.change(endpoint, { target: { value: 'https://API.mistral.ai/v1/' } });
    expect(screen.queryByText('The address changed: enter it again.')).not.toBeInTheDocument();
    expect(save).toBeEnabled();

    fireEvent.change(endpoint, { target: { value: 'https://ai.example.com/v1' } });
    expect(screen.getByText('The address changed: enter it again.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^API key/)).toBeRequired();
    expect(screen.getByLabelText(/^API key/)).toHaveValue('');
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: 'sk-new' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect((api.patch as any).mock.calls[0][1]).toMatchObject({
      endpoint_url: 'https://ai.example.com/v1',
      api_key: 'sk-new',
    });
  });
});
