import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminIntegrationsPage from './AdminIntegrationsPage';
import api from '../../api';
import { api as apiClient } from '../../api/client';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    patch: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

// The typed endpoint client (used by the Netbox card) is a separate axios wrapper.
vi.mock('../../api/client', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

const authState = { hasLevel: vi.fn((_resource: string) => true) };
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => authState,
}));

const featuresState = { config: { features: { aiSettings: true } } };
vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => featuresState,
}));

const aiCapabilitiesState = { data: { surfaces: { settings: { available: true } } } as any };
vi.mock('../../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => aiCapabilitiesState,
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
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminIntegrationsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const NETBOX_INTEGRATION = {
  configured: true,
  enabled: true,
  base_url: 'https://netbox.internal/',
  credential: { present: true },
  request_timeout_seconds: 30,
  insecure_tls: false,
  auto_sync: false,
  default_environment: 'prod',
  secret_writable: true,
  updated_at: '2026-09-18T10:00:00.000Z',
};

describe('AdminIntegrationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.hasLevel.mockImplementation(() => true);
    featuresState.config.features.aiSettings = true;
    aiCapabilitiesState.data = { surfaces: { settings: { available: true } } };

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
              available_providers: [],
            },
          });
        default:
          throw new Error(`Unexpected GET ${url}`);
      }
    });

    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/netbox/integration') return Promise.resolve(NETBOX_INTEGRATION);
      throw new Error(`Unexpected GET ${url}`);
    });
  });

  it('renders the integrations page with the GLPI and Netbox cards', async () => {
    renderPage();

    expect(await screen.findByText('Integrations')).toBeInTheDocument();
    // Sentence case, matching the aiAdmin.glpi.title copy (#125).
    expect(await screen.findByText('GLPI integration')).toBeInTheDocument();
    expect(await screen.findByText('Enable GLPI ticket import')).toBeInTheDocument();
    expect(await screen.findByText('Netbox inventory')).toBeInTheDocument();
    // GLPI and Netbox; the PRTG card fails to load in this test and shows an error instead.
    expect(await screen.findAllByText('Test connection')).toHaveLength(2);
  });

  it('shows only the Netbox card to an infrastructure admin without AI settings', async () => {
    featuresState.config.features.aiSettings = false;
    aiCapabilitiesState.data = undefined;
    authState.hasLevel.mockImplementation((resource: string) => resource === 'infrastructure');

    renderPage();

    expect(await screen.findByText('Netbox inventory')).toBeInTheDocument();
    expect(screen.queryByText('GLPI integration')).not.toBeInTheDocument();
    expect(await screen.findAllByText('Test connection')).toHaveLength(1);
  });

  it('empties the saved GLPI tokens when the address changes and asks for the user token again', async () => {
    renderPage();
    const card = (await screen.findByText('GLPI integration')).closest('.MuiCard-root') as HTMLElement;
    const address = within(card).getByLabelText('GLPI URL');
    const save = within(card).getByText('Save settings').closest('button')!;
    const test = within(card).getByText('Test connection').closest('button')!;

    // Another spelling of the saved address, or its API route, keeps the tokens.
    for (const same of ['https://GLPI.internal', 'https://glpi.internal/apirest.php']) {
      fireEvent.change(address, { target: { value: same } });
      expect(within(card).queryByText('The address changed: enter it again.')).not.toBeInTheDocument();
      expect(save).toBeEnabled();
    }

    fireEvent.change(address, { target: { value: 'https://glpi2.internal' } });
    expect(within(card).getByLabelText(/^User token/)).toBeRequired();
    expect(within(card).getAllByText('The address changed: enter it again.')).toHaveLength(2);
    expect(save).toBeDisabled();
    expect(test).toBeDisabled();

    fireEvent.change(within(card).getByLabelText(/^User token/), { target: { value: 'new-token' } });
    expect(save).toBeEnabled();
    expect(test).toBeEnabled();
  });

  it('empties the saved PRTG key when the address changes and asks for it again', async () => {
    const settingsGet = (api.get as any).getMockImplementation();
    (api.get as any).mockImplementation((url: string) => {
      if (url === '/ai/admin/integrations/monitoring') {
        return Promise.resolve({
          data: {
            integrations: [{
              provider_key: 'prtg',
              implementation: 'prtg',
              enabled: true,
              environment: 'production',
              base_url: 'https://prtg.internal',
              server_timezone: 'UTC',
              request_timeout_seconds: null,
              credential: { present: true, shape: 'api_token' },
              updated_at: '2026-09-18T10:00:00.000Z',
            }],
          },
        });
      }
      return settingsGet(url);
    });
    renderPage();
    const card = (await screen.findByText('Monitoring: PRTG')).closest('.MuiCard-root') as HTMLElement;
    const save = within(card).getByText('Save settings').closest('button')!;
    const test = within(card).getByText('Test connection').closest('button')!;

    fireEvent.change(within(card).getByLabelText('Server address'), { target: { value: 'https://prtg.internal/' } });
    expect(within(card).queryByText('The address changed: enter it again.')).not.toBeInTheDocument();

    fireEvent.change(within(card).getByLabelText('Server address'), { target: { value: 'https://prtg2.internal' } });
    expect(within(card).getByLabelText(/^API key/)).toBeRequired();
    expect(within(card).getByText('The address changed: enter it again.')).toBeInTheDocument();
    expect(save).toBeDisabled();
    expect(test).toBeDisabled();

    fireEvent.change(within(card).getByLabelText(/^API key/), { target: { value: 'new-key' } });
    expect(save).toBeEnabled();
    expect(test).toBeEnabled();
  });
});
