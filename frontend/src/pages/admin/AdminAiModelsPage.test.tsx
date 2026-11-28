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
import { AGENT_NAME, PRODUCT_NAME } from '../../config/product';

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

const featuresState = vi.hoisted(() => ({ builtinAiProvider: false }));
vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: { features: { aiSettings: true, builtinAiProvider: featuresState.builtinAiProvider } },
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

// The limits an empty model timeout falls back to, as GET /ai/model-configs gives them.
const APPLIED_TIMEOUTS = { chat_ms: 300_000, agent_ms_min: 120_000, agent_ms_max: 120_000 };

function withModel(overrides: Record<string, unknown>) {
  const original = (api.get as any).getMockImplementation();
  (api.get as any).mockImplementation((url: string, config?: any) => (url === '/ai/model-configs'
    ? Promise.resolve({
      data: { model_configs: [{ ...MODEL, ...overrides }], secret_writable: true, applied_timeouts: APPLIED_TIMEOUTS },
    })
    : original(url, config)));
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
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
    featuresState.builtinAiProvider = false;
    (api.get as any).mockImplementation((url: string, config?: { params?: { provider: string; model: string } }) => {
      switch (url) {
        case '/ai/model-configs/reasoning-efforts':
          return Promise.resolve({ data: effortSupport(config!.params!.provider, config!.params!.model) });
        case '/ai/model-configs':
          return Promise.resolve({ data: { model_configs: [MODEL], secret_writable: true, applied_timeouts: APPLIED_TIMEOUTS } });
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

  it('shows a refused address in the language of the screen', async () => {
    (api.post as any).mockResolvedValueOnce({
      data: {
        ok: false, provider: 'openai', model: 'mistral-medium-latest', latency_ms: 5,
        message: 'Private or internal hosts are not allowed.', code: 'address_private_host',
        validation_errors: ['Private or internal hosts are not allowed.'],
      },
    }).mockResolvedValueOnce({
      data: {
        ok: false, provider: 'openai', model: 'mistral-medium-latest', latency_ms: 5,
        message: 'Unable to resolve target host.', code: 'address_unresolved',
        validation_errors: ['Unable to resolve target host.'],
      },
    });
    await openEditDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('This address points at a private or internal network.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText('The server could not be found from its address.')).toBeInTheDocument();

    (api.patch as any).mockRejectedValueOnce({
      response: {
        status: 400,
        data: { statusCode: 400, error: 'Bad Request', code: 'address_private_host', message: 'Private or internal hosts are not allowed.' },
      },
    });
    const dialog = screen.getByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const refusal = 'This address points at a private or internal network.';
    expect(await within(dialog).findByText(refusal, { selector: '.MuiAlert-message' })).toBeInTheDocument();
    expect(screen.getAllByText(refusal)).toHaveLength(1);
    expect(screen.queryByText('Private or internal hosts are not allowed.')).toBeNull();
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

  const TEST_OK = {
    ok: true,
    provider: 'openai',
    model: 'mistral-medium-latest',
    latency_ms: 420,
    message: 'Provider test succeeded.',
    validation_errors: [],
    reasoning_effort_sent: null,
    reasoning_tokens: null,
  };

  async function showTestResult() {
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/Connection successful \(420 ms\)/)).toBeInTheDocument();
  }

  it('drops the test result when the server address changes and keeps it for other fields', async () => {
    (api.post as any).mockResolvedValue({ data: TEST_OK });
    await openEditDialog();
    await showTestResult();

    fireEvent.change(screen.getByDisplayValue('Mistral medium'), { target: { value: 'Mistral medium 2' } });
    fireEvent.change(screen.getByPlaceholderText(`${AGENT_NAME}: 300, agents: 120`), { target: { value: '30' } });
    expect(screen.getByText(/Connection successful \(420 ms\)/)).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('e.g., https://ai.example.com'), { target: { value: 'http://127.0.0.1:9' } });
    expect(screen.queryByText(/Connection successful/)).not.toBeInTheDocument();
  });

  it('drops the test result when the provider, model, API key or effort changes', async () => {
    (api.post as any).mockResolvedValue({ data: TEST_OK });
    await openEditDialog();

    await showTestResult();
    fireEvent.change(screen.getByDisplayValue('mistral-medium-latest'), { target: { value: 'mistral-large-latest' } });
    expect(screen.queryByText(/Connection successful/)).not.toBeInTheDocument();

    await showTestResult();
    fireEvent.change(screen.getByLabelText(/^API key/), { target: { value: 'sk-new' } });
    expect(screen.queryByText(/Connection successful/)).not.toBeInTheDocument();

    await showTestResult();
    const effort = screen.getByRole('combobox', { name: 'Reasoning effort' });
    fireEvent.mouseDown(effort);
    fireEvent.click(await screen.findByRole('option', { name: 'Low' }));
    expect(screen.queryByText(/Connection successful/)).not.toBeInTheDocument();

    await showTestResult();
    await switchToOllama();
    expect(screen.queryByText(/Connection successful/)).not.toBeInTheDocument();
  });

  it('drops the test result when the new model rejects the effort that was tested', async () => {
    let releaseSonnet: (value: unknown) => void = () => {};
    const original = (api.get as any).getMockImplementation();
    (api.get as any).mockImplementation((url: string, config?: { params?: { provider: string; model: string } }) => {
      if (url === '/ai/model-configs/reasoning-efforts' && config?.params?.model === 'claude-sonnet-4-6') {
        return new Promise((resolve) => { releaseSonnet = resolve; });
      }
      if (url === '/ai/model-configs') {
        return Promise.resolve({
          data: {
            model_configs: [{
              ...MODEL,
              provider: 'anthropic',
              model: 'claude-opus-5-5',
              endpoint_url: null,
              reasoning_effort: 'xhigh',
            }],
            secret_writable: true,
          },
        });
      }
      return original(url, config);
    });
    (api.post as any).mockResolvedValue({
      data: { ...TEST_OK, provider: 'anthropic', model: 'claude-sonnet-4-6', reasoning_effort_sent: 'xhigh' },
    });

    await openEditDialog();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Reasoning effort' })).toHaveTextContent('Very high'));
    fireEvent.change(screen.getByDisplayValue('claude-opus-5-5'), { target: { value: 'claude-sonnet-4-6' } });
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(await screen.findByText(/Connection successful \(420 ms\)/)).toBeInTheDocument();

    await waitFor(() => expect(api.get).toHaveBeenCalledWith(
      '/ai/model-configs/reasoning-efforts',
      { params: { provider: 'anthropic', model: 'claude-sonnet-4-6' } },
    ));
    releaseSonnet({ data: effortSupport('anthropic', 'claude-sonnet-4-6') });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Reasoning effort' })).toHaveTextContent('Provider default'));
    expect(screen.queryByText(/Connection successful/)).not.toBeInTheDocument();
  });

  it('shows a refused create inside the dialog', async () => {
    const refusal = 'endpoint_url must be a valid HTTP(S) URL.';
    (api.post as any).mockImplementation((url: string) => (
      url === '/ai/model-configs'
        ? Promise.reject({ response: { status: 400, data: { statusCode: 400, message: refusal, error: 'Bad Request' } } })
        : Promise.reject(new Error(`Unexpected POST ${url}`))
    ));
    renderPage();
    await screen.findByText('Mistral medium');
    fireEvent.click(screen.getByRole('button', { name: 'New model' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(within(dialog).getByText('Anthropic'));
    fireEvent.click(await screen.findByRole('option', { name: 'OpenAI' }));
    fireEvent.change(screen.getByPlaceholderText('e.g., Claude production'), { target: { value: 'Local' } });
    fireEvent.change(screen.getByPlaceholderText('e.g., claude-sonnet-5'), { target: { value: 'local-model' } });
    fireEvent.change(screen.getByPlaceholderText('e.g., https://ai.example.com'), { target: { value: 'abc' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await screen.findByText(refusal)).toBeInTheDocument();
    expect(within(dialog).getByText(refusal)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'New AI model' })).toBeInTheDocument();
    expect(screen.getAllByText(refusal)).toHaveLength(1);
  });

  it('shows a failed test inside the dialog', async () => {
    (api.post as any).mockRejectedValue({ response: { status: 502, data: {} } });
    await openEditDialog();
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Test connection' }));

    expect(await screen.findByText('The connection test failed.')).toBeInTheDocument();
    expect(within(dialog).getByText('The connection test failed.')).toBeInTheDocument();
    expect(screen.getAllByText('The connection test failed.')).toHaveLength(1);
  });

  it('keeps a refused list action on the page', async () => {
    const refusal = 'The default model could not be changed.';
    (api.post as any).mockRejectedValue({ response: { status: 400, data: { message: refusal } } });
    renderPage();
    await screen.findByText('Mistral medium');
    fireEvent.click(screen.getByRole('button', { name: 'Stop using as default model' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(refusal);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps a refused archive on the page', async () => {
    withModel({ used_by: { chat: false, agents: [] } });
    (api.delete as any).mockRejectedValue({
      response: { status: 409, data: { message: 'still assigned', used_by: ['Kad'] } },
    });
    renderPage();
    await screen.findByText('Mistral medium');
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This model is still used by: Kad. Reassign them before archiving it.');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // What the list and the settings answer, on top of the defaults above.
  function withList(models: Record<string, unknown>[], applied = APPLIED_TIMEOUTS, settings?: Record<string, unknown>) {
    const original = (api.get as any).getMockImplementation();
    (api.get as any).mockImplementation((url: string, config?: any) => {
      if (url === '/ai/model-configs') {
        return Promise.resolve({ data: { model_configs: models, secret_writable: true, applied_timeouts: applied } });
      }
      if (url === '/ai/settings/builtin-usage') {
        return Promise.resolve({ data: { count: 4, limit: 200, reset_date: '2026-12-01T00:00:00.000Z' } });
      }
      if (url === '/ai/settings' && settings) {
        return original(url, config).then((response: any) => ({ data: { ...response.data, settings } }));
      }
      return original(url, config);
    });
  }

  async function hoverName(name: string) {
    fireEvent.mouseOver(await screen.findByText(name));
    return screen.findByRole('tooltip');
  }

  it('shows under an empty timeout the limit that applies to the model use', async () => {
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ used_by: { chat: true, agents: [] }, is_default: false }, '300'],
      [{ used_by: { chat: false, agents: [{ id: 'a1', name: 'Triage' }] }, is_default: false }, '120'],
      [{ used_by: { chat: true, agents: [{ id: 'a1', name: 'Triage' }] }, is_default: false }, `${AGENT_NAME}: 300, agents: 120`],
      [{ used_by: { chat: false, agents: [] }, is_default: false }, `${AGENT_NAME}: 300, agents: 120`],
    ];
    for (const [overrides, expected] of cases) {
      withList([{ ...MODEL, ...overrides }]);
      const { unmount } = renderPage();
      await screen.findByText('Mistral medium');
      fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
      const dialog = await screen.findByRole('dialog');
      expect(within(dialog).getByText('Timeout (seconds)')).toBeInTheDocument();
      expect(within(dialog).getByPlaceholderText(expected)).toHaveValue('');
      unmount();
    }
  });

  it('shows the agent range when the stages differ, and both limits for a new model', async () => {
    withList([{ ...MODEL, used_by: { chat: false, agents: [{ id: 'a1', name: 'Triage' }] }, is_default: false }], {
      chat_ms: 600_000, agent_ms_min: 120_000, agent_ms_max: 180_000,
    });
    renderPage();
    await screen.findByText('Mistral medium');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByPlaceholderText('120 to 180')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'New model' }));
    expect(await screen.findByPlaceholderText(`${AGENT_NAME}: 600, agents: 120 to 180`)).toBeInTheDocument();
  });

  it('counts the assistant on the default model when nothing is assigned to it', async () => {
    withList([{ ...MODEL, used_by: { chat: false, agents: [] }, is_default: true }], APPLIED_TIMEOUTS, { chat_model_config_id: null });
    renderPage();
    const tooltip = await hoverName('Mistral medium');
    expect(tooltip).toHaveTextContent(`Used by ${AGENT_NAME} and agents without a model of their own`);
  });

  it('names who uses each active model in a tooltip on its name', async () => {
    withList([
      { ...MODEL, used_by: { chat: true, agents: [{ id: 'a1', name: 'Triage' }, { id: 'a2', name: 'Reply' }] }, is_default: false },
      { ...MODEL, id: 'model-2', name: 'Spare model', used_by: { chat: false, agents: [] }, is_default: false },
    ]);
    renderPage();
    const tooltip = await hoverName('Mistral medium');
    expect(tooltip).toHaveTextContent(`Used by ${AGENT_NAME} and 2 agents`);
    expect(tooltip).toHaveTextContent('Triage, Reply');
    fireEvent.mouseLeave(screen.getByText('Mistral medium'));
    await waitFor(() => expect(screen.queryByRole('tooltip')).not.toBeInTheDocument());

    expect(await hoverName('Spare model')).toHaveTextContent('Unused');
    // No column and no permanent line: the table keeps its columns.
    expect(screen.queryByRole('columnheader', { name: 'Used by' })).not.toBeInTheDocument();
  });

  it('marks the included model as not used when nothing runs on it', async () => {
    featuresState.builtinAiProvider = true;
    withList([{ ...MODEL, is_default: false }], APPLIED_TIMEOUTS, {
      chat_model_config_id: 'model-1',
      builtin_provider: { in_use: false, used_by_assistant: false },
    });
    renderPage();
    expect(await screen.findByText('Not used')).toBeInTheDocument();
    // The star stays the workspace rule: no default model, the included one is the default.
    expect(screen.getByLabelText('Default')).toBeInTheDocument();
  });

  it('says the included model serves agents without a model of their own, or the assistant too', async () => {
    featuresState.builtinAiProvider = true;
    withList([{ ...MODEL, is_default: false }], APPLIED_TIMEOUTS, {
      chat_model_config_id: 'model-1',
      builtin_provider: { in_use: true, used_by_assistant: false },
    });
    const { unmount } = renderPage();
    const builtinName = `${PRODUCT_NAME} included model`;
    expect(await hoverName(builtinName)).toHaveTextContent('Used by agents without a model of their own');
    expect(screen.queryByText('Not used')).not.toBeInTheDocument();
    unmount();

    withList([{ ...MODEL, is_default: false, used_by: { chat: false, agents: [] } }], APPLIED_TIMEOUTS, {
      chat_model_config_id: null,
      builtin_provider: { in_use: true, used_by_assistant: true },
    });
    renderPage();
    expect(await hoverName(builtinName)).toHaveTextContent(`Used by ${AGENT_NAME} and agents without a model of their own`);
  });

  it('shows nothing about the included model on-premise', async () => {
    withList([{ ...MODEL, is_default: false }], APPLIED_TIMEOUTS, {
      chat_model_config_id: 'model-1',
      builtin_provider: { in_use: false, used_by_assistant: false },
    });
    renderPage();
    await screen.findByText('Mistral medium');
    expect(screen.queryByText(`${PRODUCT_NAME} included model`)).not.toBeInTheDocument();
    expect(screen.queryByText('Not used')).not.toBeInTheDocument();
    // The applied limits show the same.
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByPlaceholderText('300')).toBeInTheDocument();
  });
});
