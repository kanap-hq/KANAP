import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAiPage from './AdminAiPage';
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
          <KanapDialogProvider>
            <AdminAiPage />
          </KanapDialogProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

// The rows of the MCP keys card; each test that sets them puts back the empty list.
let adminKeys: any[] = [];

const EMPTY_JOURNAL = { items: [], limit: 25, offset: 0, has_more: false, facets: { people: [], keys: [] } };
// The MCP journal page the server answers; each test that sets it puts back the empty one.
let journalPage: any = EMPTY_JOURNAL;

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
          return Promise.resolve({ data: adminKeys });
        case '/ai/admin/mcp-audit':
          return Promise.resolve({ data: journalPage });
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
    expect(await screen.findByText('No MCP keys or connections.')).toBeInTheDocument();
    // The token/usage overview moved to the dedicated Usage & costs page.
    expect(screen.queryByText('Usage Overview')).not.toBeInTheDocument();
    expect(screen.queryByText('Token usage')).not.toBeInTheDocument();
  });

  it('places the AI models page link in the row helper under the select', async () => {
    renderPage();

    const link = await screen.findByRole('link', { name: 'AI models page' });
    expect(link).toHaveAttribute('href', '/admin/ai-models');

    const row = screen.getByText('Model used by Plaid').closest('.kanap-field-label')?.parentElement;
    expect(row).toBeTruthy();
    // Label, value, then the helper. The hint must not sit beside the select.
    expect(row!.children).toHaveLength(3);
    const value = row!.children[1] as HTMLElement;
    const helper = row!.children[2] as HTMLElement;
    expect(value).toContainElement(within(row as HTMLElement).getByRole('combobox'));
    expect(value).not.toContainElement(link);
    expect(helper).toContainElement(link);
    expect(helper).toHaveTextContent('Models are managed on the AI models page');
  });

  it('tells a key from a connection, with the client and its return host', async () => {
    adminKeys = [
      {
        id: 'k1', label: 'Laptop', key_prefix: 'abcd1234', credential_kind: 'api_key', created_at: '2026-10-01T10:00:00.000Z',
        expires_at: null, last_used_at: null, revoked_at: null,
      },
      {
        id: 'k2', label: 'Claude', key_prefix: 'efgh5678', credential_kind: 'oauth', oauth_client_name: 'Claude',
        oauth_redirect_host: 'claude.ai', created_at: '2026-10-14T10:00:00.000Z', expires_at: null,
        last_used_at: '2026-10-27T09:37:00.000Z', revoked_at: null, user_name: 'Sophie Laurent',
      },
    ];
    renderPage();

    expect(await screen.findByText('API key')).toBeInTheDocument();
    // A connection names the person who approved it.
    expect(screen.getByRole('columnheader', { name: 'Person' })).toBeInTheDocument();
    expect(screen.getByText('Sophie Laurent')).toBeInTheDocument();
    expect(screen.getByText('Connection')).toBeInTheDocument();
    expect(screen.getByText('· claude.ai')).toBeInTheDocument();
    expect(screen.getByText('abcd1234')).toBeInTheDocument();
    // A connection has no key to show.
    expect(screen.queryByText('efgh5678')).not.toBeInTheDocument();
    expect(screen.getByText(/add this address as a custom connector/)).toBeInTheDocument();
    adminKeys = [];
  });

  it('revokes a key only after a confirmation that names it and says access stops at once', async () => {
    adminKeys = [
      {
        id: 'k1', label: 'Laptop', key_prefix: 'abcd1234', credential_kind: 'api_key', created_at: '2026-10-01T10:00:00.000Z',
        expires_at: null, last_used_at: null, revoked_at: null,
      },
      {
        id: 'k2', label: 'Claude', key_prefix: 'efgh5678', credential_kind: 'oauth', oauth_client_name: 'Claude',
        oauth_redirect_host: 'claude.ai', created_at: '2026-10-14T10:00:00.000Z', expires_at: null, last_used_at: null, revoked_at: null,
      },
    ];
    (api.delete as any).mockResolvedValue({ data: { id: 'k1', revoked_at: '2026-10-27T10:00:00.000Z' } });
    renderPage();

    const revokeKey = await screen.findByRole('button', { name: 'Revoke Laptop' });
    expect(screen.getByRole('button', { name: 'Revoke Claude' })).toBeInTheDocument();
    // Neither icon says "delete".
    expect(document.querySelector('[data-testid="DeleteOutlineIcon"]')).toBeNull();
    expect(within(revokeKey).getByTestId('KeyOffOutlinedIcon')).toBeInTheDocument();

    fireEvent.click(revokeKey);
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Revoke Laptop?')).toBeInTheDocument();
    expect(within(dialog).getByText(/loses access to KANAP at once/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.delete).not.toHaveBeenCalled();

    fireEvent.click(revokeKey);
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/ai/admin/keys/k1'));
    adminKeys = [];
  });

  it('shows the MCP journal with the cause of a refusal, its filters and its pages', async () => {
    const item = (overrides: Record<string, unknown>) => ({
      tool_execution_id: 'te-1', user_id: 'u1', user_name: 'Ana Silva', ai_api_key_id: 'k1', key_label: 'Laptop',
      key_kind: 'api_key', oauth_client_name: null, capability_name: 'search_all', result: 'completed', reason: null,
      duration_ms: 182, tool_created_at: '2026-10-27T09:15:00.000Z', input_summary: null,
      ...overrides,
    });
    journalPage = {
      items: [
        item({}),
        item({ tool_execution_id: 'te-2', capability_name: 'prepare_mutation_plan', result: 'refused', reason: 'read_only', duration_ms: 3 }),
        item({ tool_execution_id: 'te-3', key_kind: 'oauth', key_label: 'Claude', oauth_client_name: 'Claude', ai_api_key_id: 'k2', result: 'refused', reason: 'key_revoked' }),
      ],
      limit: 25,
      offset: 0,
      has_more: true,
      facets: {
        people: [{ id: 'u1', name: 'Ana Silva' }],
        keys: [{ id: 'k1', label: 'Laptop', credential_kind: 'api_key', oauth_client_name: null, user_id: 'u1', revoked: false }],
      },
    };
    renderPage();

    expect(await screen.findByRole('heading', { name: 'MCP journal' })).toBeInTheDocument();
    const rows = await screen.findAllByTestId('mcp-journal-row');
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText('Ana Silva')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Laptop')).toBeInTheDocument();
    expect(within(rows[0]).getByText('search_all')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Completed')).toBeInTheDocument();
    expect(within(rows[0]).getByText('182 ms')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Refused')).toBeInTheDocument();
    expect(within(rows[1]).getByText(/The server only reads/)).toBeInTheDocument();
    expect(within(rows[2]).getByText('Claude')).toBeInTheDocument();
    expect(within(rows[2]).getByText(/Revoked key/)).toBeInTheDocument();

    const journalCalls = () => (api.get as any).mock.calls.filter(([url]: [string]) => url === '/ai/admin/mcp-audit');
    // The last 7 days by default, newest first, 25 a page.
    const first = journalCalls()[0][1].params;
    expect(first).toMatchObject({ limit: 25, offset: 0 });
    expect(Date.now() - new Date(first.from).getTime()).toBeGreaterThan(6.9 * 86_400_000);

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(journalCalls().at(-1)[1].params).toMatchObject({ offset: 25 }));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Result' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Refused' }));
    await waitFor(() => expect(journalCalls().at(-1)[1].params).toMatchObject({ result: 'refused', offset: 0 }));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Person' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Ana Silva' }));
    await waitFor(() => expect(journalCalls().at(-1)[1].params).toMatchObject({ user_id: 'u1', result: 'refused' }));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Period' }));
    fireEvent.click(await screen.findByRole('option', { name: 'All time' }));
    await waitFor(() => expect(journalCalls().at(-1)[1].params.from).toBeUndefined());
    journalPage = EMPTY_JOURNAL;
  });

  it('opens a journal line on its arguments and full cause, and names keys and connections as the keys table does', async () => {
    const cause = 'Invalid input for search_all: unknown field "password" (accepted: query, entity_types, limit).';
    journalPage = {
      items: [
        {
          // The key and its owner were deleted after the call (ON DELETE SET NULL); the duration is unknown.
          tool_execution_id: 'te-1', user_id: null, user_name: null, ai_api_key_id: null, key_label: null,
          key_kind: null, oauth_client_name: null, oauth_redirect_host: null, capability_name: 'search_all',
          result: 'refused', reason: 'key_revoked', error_message: 'MCP API key has been revoked.', duration_ms: null,
          tool_created_at: '2026-10-27T09:40:00.000Z', input_summary: { arguments: {} },
        },
        {
          tool_execution_id: 'te-2', user_id: 'u1', user_name: 'Ana Silva', ai_api_key_id: 'k2', key_label: 'Claude',
          key_kind: 'oauth', oauth_client_name: 'Claude', oauth_redirect_host: 'claude.ai', capability_name: 'search_all',
          result: 'refused', reason: 'invalid_input', error_message: cause, duration_ms: 0,
          tool_created_at: '2026-10-27T09:39:00.000Z',
          input_summary: {
            arguments: {
              query: 'Sage', password: '[REDACTED]', entity_types: ['application', 'contract'], filters: { status: 'active' },
            },
          },
        },
        {
          tool_execution_id: 'te-3', user_id: 'u1', user_name: 'Ana Silva', ai_api_key_id: 'k1', key_label: 'Laptop',
          key_kind: 'api_key', oauth_client_name: null, oauth_redirect_host: null, capability_name: 'get_application_classification_catalog',
          result: 'completed', reason: null, error_message: null, duration_ms: 64,
          tool_created_at: '2026-10-27T09:38:00.000Z', input_summary: { argument_names: [] },
        },
      ],
      limit: 25,
      offset: 0,
      has_more: false,
      facets: {
        people: [{ id: 'u1', name: 'Ana Silva' }],
        keys: [
          { id: 'k1', label: 'Laptop', credential_kind: 'api_key', oauth_client_name: null, oauth_redirect_host: null, user_id: 'u1', revoked: false },
          { id: 'k2', label: 'Claude', credential_kind: 'oauth', oauth_client_name: 'Claude', oauth_redirect_host: 'claude.ai', user_id: 'u1', revoked: false },
          { id: 'k3', label: 'Claude', credential_kind: 'oauth', oauth_client_name: 'Claude', oauth_redirect_host: 'localhost', user_id: 'u1', revoked: true },
        ],
      },
    };
    renderPage();

    const rows = await screen.findAllByTestId('mcp-journal-row');
    expect(rows).toHaveLength(3);
    // R1: a line whose key and person are gone.
    expect(within(rows[0]).getByText('Deleted key')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Former user')).toBeInTheDocument();
    expect(within(rows[0]).queryByText('No key')).not.toBeInTheDocument();
    // R3: an unknown duration reads as a dash, a measured one in ms.
    expect(within(rows[0]).getByText('—')).toBeInTheDocument();
    expect(within(rows[1]).getByText('0 ms')).toBeInTheDocument();
    // A connection shows its client and host, as in the keys table.
    expect(rows[1]).toHaveTextContent('Claude · claude.ai');

    // R4: the arguments and the full cause, closed until the line is opened.
    expect(screen.queryByTestId('mcp-journal-details')).not.toBeInTheDocument();
    expect(rows[1]).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(rows[1]);
    const details = await screen.findByTestId('mcp-journal-details');
    expect(rows[1]).toHaveAttribute('aria-expanded', 'true');
    expect(within(details).getByText('query')).toBeInTheDocument();
    expect(within(details).getByText('Sage')).toBeInTheDocument();
    expect(within(details).getByText('password')).toBeInTheDocument();
    expect(within(details).getByText('Hidden')).toBeInTheDocument();
    expect(within(details).queryByText('[REDACTED]')).not.toBeInTheDocument();
    expect(within(details).getByText('entity_types').nextSibling).toHaveTextContent('application, contract');
    expect(within(details).getByText('status')).toBeInTheDocument();
    expect(within(details).getByText('active')).toBeInTheDocument();
    expect(within(details).getByText('Cause')).toBeInTheDocument();
    expect(within(details).getByText(cause)).toBeInTheDocument();
    expect(details).not.toHaveTextContent('{');
    fireEvent.click(rows[1]);
    await waitFor(() => expect(screen.queryByTestId('mcp-journal-details')).not.toBeInTheDocument());

    // From the keyboard; a call without arguments says so; a completed call shows no cause.
    fireEvent.keyDown(rows[0], { key: 'Enter' });
    expect(within(await screen.findByTestId('mcp-journal-details')).getByText('No arguments')).toBeInTheDocument();
    expect(within(screen.getByTestId('mcp-journal-details')).getByText('MCP API key has been revoked.')).toBeInTheDocument();
    fireEvent.keyDown(rows[0], { key: 'Enter' });
    fireEvent.click(rows[2]);
    const completed = await screen.findByTestId('mcp-journal-details');
    expect(within(completed).getByText('Not recorded')).toBeInTheDocument();
    expect(within(completed).queryByText('Cause')).not.toBeInTheDocument();

    // R2: the filter names connections by client and host, and marks a revoked one.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Key or connection' }));
    expect(await screen.findByRole('option', { name: 'Laptop' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude · claude.ai' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Claude · localhost (revoked)' })).toBeInTheDocument();
    journalPage = EMPTY_JOURNAL;
  });

  it('shows the server address and a Claude Code command for a new key', async () => {
    const endpoint = `${window.location.origin}/api/ai/mcp`;
    (api.post as any).mockResolvedValueOnce({ data: { key: 'kanap_mcp_secret', record: { id: 'key-1' } } });
    renderPage();

    expect(await screen.findByDisplayValue(endpoint)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy address' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Create key' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Laptop' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(await within(dialog).findByDisplayValue('kanap_mcp_secret')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue(
      `claude mcp add --transport http kanap ${endpoint} --header "Authorization: Bearer kanap_mcp_secret"`,
    )).toBeInTheDocument();
    expect(api.post).toHaveBeenCalledWith('/ai/keys', { label: 'Laptop' });
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
        case '/ai/admin/mcp-audit':
          return Promise.resolve({ data: EMPTY_JOURNAL });
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
