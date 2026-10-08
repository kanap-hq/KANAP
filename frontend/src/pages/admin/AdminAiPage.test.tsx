import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAiPage from './AdminAiPage';
import { createAppTheme } from '../../config/ThemeContext';
import api from '../../api';

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
    config: {
      features: {
        aiSettings: true,
        aiWebSearch: false,
        builtinAiProvider: false,
      },
    },
  }),
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminAiPage />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('AdminAiPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    (api.get as any).mockImplementation((url: string) => {
      switch (url) {
        case '/ai/settings':
          return Promise.resolve({
            data: {
              instance_features: { ai_chat: true, ai_mcp: true, ai_settings: true, ai_web_search: true },
              settings: {
                chat_enabled: true,
                mcp_enabled: true,
                provider_source: 'custom',
                chat_model_config_id: 'model-1',
                llm_provider: 'openai',
                llm_endpoint_url: null,
                llm_model: 'gpt-4o',
                mcp_key_max_lifetime_days: 30,
                conversation_retention_days: 14,
                web_search_enabled: true,
                glpi_enabled: true,
                glpi_url: 'https://glpi.internal/',
                has_glpi_user_token: true,
                has_glpi_app_token: true,
                has_llm_api_key: true,
                provider_secret_writable: true,
                provider_validation_errors: [],
                chat_ready: true,
                created_at: '2026-03-21T10:00:00.000Z',
                updated_at: '2026-03-21T10:00:00.000Z',
              },
              available_providers: [
                {
                  id: 'openai',
                  label: 'OpenAI',
                  description: 'OpenAI API',
                  capabilities: {
                    supportsStreaming: true,
                    supportsToolCalling: true,
                    requiresApiKey: true,
                    allowsCustomEndpoint: true,
                  },
                },
              ],
            },
          });
        case '/ai/model-configs':
          return Promise.resolve({
            data: {
              model_configs: [
                {
                  id: 'model-1',
                  name: 'Claude production',
                  provider: 'anthropic',
                  model: 'claude-sonnet-5',
                  endpoint_url: null,
                  has_api_key: true,
                  supports_vision: true,
                  price_input_eur_per_mtok: 3,
                  price_output_eur_per_mtok: 15,
                  llm_timeout_ms: null,
                  status: 'active',
                  is_default: true,
                  used_by: { chat: true, agents: [] },
                  messages_this_month: 12,
                  validation_errors: [],
                  created_at: '2026-03-21T10:00:00.000Z',
                  updated_at: '2026-03-21T10:00:00.000Z',
                },
              ],
              secret_writable: true,
            },
          });
        case '/ai/admin/keys':
          return Promise.resolve({ data: [] });
        default:
          throw new Error(`Unexpected GET ${url}`);
      }
    });
  });

  it('renders the model selector with the assigned registry model and no usage overview', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Provider' });
    expect(await screen.findByText('Model used by Plaid')).toBeInTheDocument();
    expect(await screen.findByText('Claude production')).toBeInTheDocument();
    expect(await screen.findByText('No MCP API keys configured.')).toBeInTheDocument();
    // The token/usage overview moved to the dedicated Usage & costs page.
    expect(screen.queryByText('Usage Overview')).not.toBeInTheDocument();
    expect(screen.queryByText('Token usage')).not.toBeInTheDocument();
  });
});

// The KANAP included model: its provider, where it processes data, and the
// administrator's confirmation, on the Provider card.
describe('AdminAiPage included model', () => {
  const US = { name: 'Anthropic', location: 'US', key: 'anthropic||Anthropic|US' };
  let settings: Record<string, any>;

  function baseSettings(overrides: Record<string, unknown>) {
    return {
      chat_enabled: false,
      mcp_enabled: false,
      provider_source: 'builtin',
      chat_model_config_id: null,
      llm_provider: null,
      llm_endpoint_url: null,
      llm_model: null,
      mcp_key_max_lifetime_days: null,
      conversation_retention_days: null,
      web_search_enabled: false,
      glpi_enabled: false,
      glpi_url: null,
      has_glpi_user_token: false,
      has_glpi_app_token: false,
      has_llm_api_key: false,
      provider_secret_writable: true,
      provider_validation_errors: [],
      chat_ready: true,
      created_at: '2026-10-01T10:00:00.000Z',
      updated_at: '2026-10-01T10:00:00.000Z',
      ...overrides,
    };
  }

  function provider(overrides: Record<string, unknown>) {
    return {
      in_use: true,
      used_by_assistant: true,
      ...US,
      accepted: false,
      accepted_at: null,
      accepted_by_name: null,
      ...overrides,
    };
  }

  function apiError(code: string, identity: typeof US) {
    return Object.assign(new Error('Request failed'), {
      response: { status: 400, data: { code, message: 'refused', builtin_provider: identity } },
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    (api.get as any).mockImplementation((url: string) => {
      switch (url) {
        case '/ai/settings':
          return Promise.resolve({
            data: {
              instance_features: { ai_chat: true, ai_mcp: true, ai_settings: true, ai_web_search: false },
              settings,
              available_providers: [],
            },
          });
        case '/ai/model-configs':
          return Promise.resolve({
            data: {
              model_configs: [{ id: 'model-1', name: 'Our model', status: 'active', is_default: false }],
              secret_writable: true,
            },
          });
        case '/ai/admin/keys':
          return Promise.resolve({ data: [] });
        default:
          throw new Error(`Unexpected GET ${url}`);
      }
    });
    (api.patch as any).mockResolvedValue({ data: { settings: {} } });
  });

  it('shows nothing about it when everything runs on a model of the workspace', async () => {
    settings = baseSettings({ builtin_provider: provider({ in_use: false, used_by_assistant: false }) });
    renderPage();
    await screen.findByRole('heading', { name: 'Provider' });
    expect(screen.queryByTestId('included-model-status')).not.toBeInTheDocument();
    expect(screen.queryByText('Needs confirmation')).not.toBeInTheDocument();
  });

  it('offers the confirmation when only agents fall back on it', async () => {
    settings = baseSettings({
      chat_enabled: true,
      chat_model_config_id: 'model-1',
      chat_ready: true,
      builtin_provider: provider({ used_by_assistant: false }),
    });
    renderPage();

    const status = await screen.findByTestId('included-model-status');
    expect(within(status).getByText('Needs confirmation')).toBeInTheDocument();
    expect(within(status).getByRole('button', { name: 'Confirm' })).toBeInTheDocument();
    // The assistant runs on its own model: its readiness shows as usual.
    expect(screen.getByText('Provider ready')).toBeInTheDocument();

    fireEvent.click(within(status).getByRole('button', { name: 'Confirm' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/ai/settings', { accept_builtin_provider_key: 'anthropic||Anthropic|US' }));
  });

  it('keeps the validation list of the assistant\'s own model while agents wait for the included model', async () => {
    settings = baseSettings({
      chat_enabled: true,
      chat_model_config_id: 'model-1',
      chat_ready: false,
      provider_validation_errors: ['API key is required.'],
      builtin_provider: provider({ used_by_assistant: false }),
    });
    renderPage();

    await screen.findByTestId('included-model-status');
    expect(screen.getByText('Current provider validation errors')).toBeInTheDocument();
    expect(screen.getByText('Provider incomplete')).toBeInTheDocument();
  });

  it('asks for a confirmation and sends the key shown', async () => {
    settings = baseSettings({
      chat_ready: false,
      provider_validation_errors: ["The KANAP included model needs an administrator's confirmation in Admin > Plaid."],
      builtin_provider: provider({}),
    });
    renderPage();

    const status = await screen.findByTestId('included-model-status');
    expect(within(status).getByText('KANAP included model: Anthropic (processing location: United States)')).toBeInTheDocument();
    expect(within(status).getByText('Needs confirmation')).toBeInTheDocument();
    // The status line says it: no validation list and no "provider incomplete" chip on top.
    expect(screen.queryByText('Current provider validation errors')).not.toBeInTheDocument();
    expect(screen.queryByText('Provider incomplete')).not.toBeInTheDocument();

    fireEvent.click(within(status).getByRole('button', { name: 'Confirm' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Use the KANAP included model?')).toBeInTheDocument();
    expect(within(dialog).getByText(/are sent to Anthropic\. Processing location: United States\./)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'AI models list' })).toHaveAttribute('href', '/admin/ai-models');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/ai/settings', { accept_builtin_provider_key: 'anthropic||Anthropic|US' }));
  });

  it('names who confirmed it and lets an administrator withdraw it', async () => {
    const acceptedAt = '2026-10-02T09:30:00.000Z';
    settings = baseSettings({
      chat_enabled: true,
      builtin_provider: provider({ accepted: true, accepted_at: acceptedAt, accepted_by_name: 'Ada Martin' }),
    });
    renderPage();

    const status = await screen.findByTestId('included-model-status');
    expect(within(status).getByText('Confirmed')).toBeInTheDocument();
    const date = new Date(acceptedAt).toLocaleDateString('en');
    expect(within(status).getByText(`Confirmed by Ada Martin on ${date}`)).toBeInTheDocument();

    fireEvent.click(within(status).getByRole('button', { name: 'Withdraw' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('AI features that use the included model stop until an administrator confirms again.')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/ai/settings', { accept_builtin_provider_key: null }));
  });

  it('gives the date alone when the administrator who confirmed it is no longer found', async () => {
    const acceptedAt = '2026-10-08T06:00:00.000Z';
    settings = baseSettings({
      chat_enabled: true,
      builtin_provider: provider({ accepted: true, accepted_at: acceptedAt, accepted_by_name: null }),
    });
    renderPage();

    const status = await screen.findByTestId('included-model-status');
    const date = new Date(acceptedAt).toLocaleDateString('en');
    expect(within(status).getByText(`Confirmed on ${date}`)).toBeInTheDocument();
  });

  it('keeps changes not saved yet when the included model is confirmed alone', async () => {
    settings = baseSettings({ chat_ready: false, builtin_provider: provider({}) });
    (api.patch as any).mockImplementation(async () => {
      settings = {
        ...settings,
        chat_ready: true,
        updated_at: '2026-10-02T08:00:00.000Z',
        builtin_provider: provider({ accepted: true, accepted_at: '2026-10-02T08:00:00.000Z', accepted_by_name: 'Ada Martin' }),
      };
      return { data: { settings } };
    });
    renderPage();

    const status = await screen.findByTestId('included-model-status');
    fireEvent.click(screen.getByLabelText('Enable MCP'));
    expect(screen.getByLabelText('Enable MCP')).toBeChecked();

    fireEvent.click(within(status).getByRole('button', { name: 'Confirm' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await screen.findByText(/Confirmed by Ada Martin/);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Enable MCP')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));
    await waitFor(() => expect(api.patch).toHaveBeenLastCalledWith('/ai/settings', { mcp_enabled: true }));
  });

  it('opens the confirmation when turning the assistant on, then saves both together', async () => {
    settings = baseSettings({
      chat_ready: false,
      builtin_provider: provider({}),
    });
    (api.patch as any)
      .mockRejectedValueOnce(apiError('BUILTIN_PROVIDER_CONFIRMATION_REQUIRED', US))
      .mockResolvedValueOnce({ data: { settings: {} } });
    renderPage();

    await screen.findByTestId('included-model-status');
    fireEvent.click(screen.getByLabelText('Enable chat'));
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Use the KANAP included model?')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm and turn on' }));

    await waitFor(() => expect(api.patch).toHaveBeenLastCalledWith('/ai/settings', {
      chat_enabled: true,
      accept_builtin_provider_key: 'anthropic||Anthropic|US',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('reloads and shows the new provider when it changed meanwhile', async () => {
    settings = baseSettings({ builtin_provider: provider({}) });
    const EU = { name: 'Anthropic', location: 'EU', key: 'anthropic||Anthropic|EU' };
    (api.patch as any)
      .mockRejectedValueOnce(apiError('BUILTIN_PROVIDER_CHANGED', EU))
      .mockResolvedValueOnce({ data: { settings: {} } });
    renderPage();

    const status = await screen.findByTestId('included-model-status');
    fireEvent.click(within(status).getByRole('button', { name: 'Confirm' }));
    let dialog = await screen.findByRole('dialog');
    const settingsLoads = (api.get as any).mock.calls.filter(([url]: [string]) => url === '/ai/settings').length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await screen.findByText('The provider or its processing location changed. Review it and confirm again.');
    dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Processing location: European Union\./)).toBeInTheDocument();
    expect((api.get as any).mock.calls.filter(([url]: [string]) => url === '/ai/settings').length).toBeGreaterThan(settingsLoads);

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(api.patch).toHaveBeenLastCalledWith('/ai/settings', { accept_builtin_provider_key: 'anthropic||Anthropic|EU' }));
  });
});
