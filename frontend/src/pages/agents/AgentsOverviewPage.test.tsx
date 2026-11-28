import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentsOverviewPage from './AgentsOverviewPage';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import { formatEuro } from '../../i18n/formatters';
import { AGENT_NAME, PRODUCT_NAME } from '../../config/product';

// The agents overview tells everyone who sees agents that the ones running on the KANAP
// included model are paused while no administrator has confirmed it, with a way to the
// AI settings for those who can open them.

let capabilitiesState: { data: any } = { data: undefined };
let canOpenAiSettings = true;
let fleetCost: { today_eur: number; last_7_days_eur: number } | undefined;
let fleetDefinitions: Array<Record<string, unknown>> = [];

vi.mock('../../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => capabilitiesState,
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string) => (resource === 'ai_settings' ? canOpenAiSettings : resource === 'ai_agents'),
  }),
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title, actions }: { title: string; actions?: React.ReactNode }) => <div>{title}{actions}</div>,
}));

const idleMutation = { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() };

vi.mock('./useAgentControlData', () => ({
  useAgentControlData: () => ({
    queueQuery: { data: { definitions: fleetDefinitions, emergency_pause: null, cost: fleetCost }, isLoading: false },
    badgesQuery: { data: { pendingApprovals: 0 } },
    error: null,
    message: null,
    setError: vi.fn(),
    setMessage: vi.fn(),
    createPauseMutation: idleMutation,
    revokePauseMutation: idleMutation,
    createAgentMutation: idleMutation,
    deleteAgentMutation: idleMutation,
    actionPool: [],
    agent: null,
  }),
}));

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AgentsOverviewPage />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

function PathProbe() {
  const { pathname } = useLocation();
  return <div data-testid="path">{pathname}</div>;
}

function renderFleet() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/agents']}>
          <PathProbe />
          <AgentsOverviewPage />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

function deleteAgentButton(): HTMLElement {
  const button = screen.getAllByRole('button').find((candidate) => candidate.getAttribute('aria-label') === 'Delete agent');
  if (!button) throw new Error('Delete agent button not found');
  return button;
}

function warned(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((call) => call.map((part) => String(part)).join(' ')).join('\n');
}

const fleetAgent = {
  id: 'agent-1',
  agent_key: 'night-watch',
  name: 'Night watch',
  description: 'Watches the night queue',
  agent_type: 'sre',
  status: 'enabled',
  environment: 'production',
  trigger_policy_json: null,
  provider_bindings_json: null,
  automatic_action_classes: [],
};

const PAUSED = `Agents that use the ${PRODUCT_NAME} included model are paused until an administrator confirms it in Administration > ${AGENT_NAME}.`;

// Testing Library collapses the no-break spaces Intl writes before EUR. Compare that form.
function shown(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

beforeEach(() => {
  fleetDefinitions = [];
});

describe('AgentsOverviewPage included model banner', () => {
  beforeEach(async () => {
    capabilitiesState = { data: { builtin_confirmation_needed: false } };
    canOpenAiSettings = true;
    fleetCost = undefined;
    await i18n.changeLanguage('en');
  });

  it('shows no banner when nothing waits for a confirmation', () => {
    renderPage();
    expect(screen.queryByText(PAUSED)).not.toBeInTheDocument();
  });

  it('says agents are paused and links administrators to the AI settings', () => {
    capabilitiesState = { data: { builtin_confirmation_needed: true } };
    renderPage();
    expect(screen.getByText(PAUSED)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: `Open ${AGENT_NAME} settings` })).toHaveAttribute('href', '/admin/ai');
  });

  it('shows the banner without the link to those who cannot open the AI settings', () => {
    capabilitiesState = { data: { builtin_confirmation_needed: true } };
    canOpenAiSettings = false;
    renderPage();
    expect(screen.getByText(PAUSED)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: `Open ${AGENT_NAME} settings` })).not.toBeInTheDocument();
  });
});

describe('AgentsOverviewPage cost and empty fleet', () => {
  beforeEach(() => {
    capabilitiesState = { data: { builtin_confirmation_needed: false } };
    canOpenAiSettings = true;
    fleetCost = { today_eur: 1.5, last_7_days_eur: 1234.5 };
  });

  afterEach(async () => {
    fleetCost = undefined;
    await i18n.changeLanguage('en');
  });

  it('formats the fleet cost in French and names the workspace', async () => {
    await i18n.changeLanguage('fr');
    renderPage();
    expect(screen.getByText("Aucun agent n'est disponible pour cet espace de travail.")).toBeInTheDocument();
    const cost = screen.getByText(shown(`${formatEuro(1.5, 'fr')} / ${formatEuro(1234.5, 'fr')}`));
    expect(cost.textContent).not.toMatch(/\d\.\d/);
    expect(screen.queryByText(/tenant/i)).not.toBeInTheDocument();
  });

  it('formats the fleet cost in English without the word tenant', async () => {
    await i18n.changeLanguage('en');
    renderPage();
    expect(screen.getByText('No agents are available for this workspace.')).toBeInTheDocument();
    expect(screen.getByText(shown(`${formatEuro(1.5, 'en')} / ${formatEuro(1234.5, 'en')}`))).toBeInTheDocument();
    expect(screen.queryByText(/tenant/i)).not.toBeInTheDocument();
  });
});

describe('AgentsOverviewPage new agent', () => {
  beforeEach(async () => {
    capabilitiesState = { data: { builtin_confirmation_needed: false } };
    canOpenAiSettings = true;
    fleetCost = undefined;
    idleMutation.mutateAsync.mockReset();
    idleMutation.mutateAsync.mockResolvedValue({ agent_definition: { agent_key: 'new-agent' } });
    await i18n.changeLanguage('en');
  });

  async function createAgent(type: 'Helpdesk' | 'Infrastructure monitoring (SRE)') {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'New agent' }));
    const dialog = screen.getByRole('dialog');
    if (type !== 'Helpdesk') {
      fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[0]);
      fireEvent.click(screen.getByRole('option', { name: type }));
    }
    fireEvent.change(within(dialog).getAllByRole('textbox')[0], { target: { value: 'Night watch' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(idleMutation.mutateAsync).toHaveBeenCalledTimes(1));
    return idleMutation.mutateAsync.mock.calls[0][0];
  }

  // The screen asks for no knowledge base search: the API starts a new agent with it off.
  it('creates a monitoring agent without asking for the knowledge base search', async () => {
    const body = await createAgent('Infrastructure monitoring (SRE)');
    expect(body.agent_type).toBe('sre');
    expect(body.scope_policy_json.knowledge_sources.knowledge).toBeUndefined();
    expect(body.scope_policy_json.knowledge_sources.kanap_data.enabled).toBe(true);
  });

  it('creates a helpdesk agent without asking for the knowledge base search', async () => {
    const body = await createAgent('Helpdesk');
    expect(body.agent_type).toBe('helpdesk');
    expect(body.scope_policy_json.knowledge_sources?.knowledge).toBeUndefined();
  });
});

describe('AgentsOverviewPage agent card', () => {
  beforeEach(async () => {
    capabilitiesState = { data: { builtin_confirmation_needed: false } };
    canOpenAiSettings = true;
    fleetCost = undefined;
    fleetDefinitions = [fleetAgent];
    idleMutation.mutate.mockReset();
    await i18n.changeLanguage('en');
  });

  it('keeps the delete button outside the card button', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      renderFleet();
      const remove = deleteAgentButton();
      // A button inside the card button is invalid: the delete control must have no button ancestor.
      expect(remove.parentElement?.closest('button') ?? null).toBeNull();
      expect(warned(errors)).not.toContain('validateDOMNesting');
    } finally {
      errors.mockRestore();
    }
  });

  it('opens the agent from the card and the confirmation from delete', async () => {
    renderFleet();
    fireEvent.click(screen.getByRole('button', { name: /Night watch/ }));
    expect(screen.getByTestId('path')).toHaveTextContent('/agents/night-watch');

    cleanup();
    renderFleet();
    fireEvent.click(deleteAgentButton());
    expect(screen.getByTestId('path')).toHaveTextContent('/agents');
    expect(screen.getByRole('heading', { name: 'Delete Night watch?' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(idleMutation.mutate).not.toHaveBeenCalled();
  });

  it('opens the agent and the delete confirmation from the keyboard', async () => {
    const user = userEvent.setup();
    renderFleet();
    await user.tab();
    expect(screen.getByRole('button', { name: 'New agent' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Pause all agents' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: /Night watch/ })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('path')).toHaveTextContent('/agents/night-watch');

    cleanup();
    renderFleet();
    await user.tab();
    await user.tab();
    await user.tab();
    await user.tab();
    expect(deleteAgentButton()).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('heading', { name: 'Delete Night watch?' })).toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent('/agents');
    expect(idleMutation.mutate).not.toHaveBeenCalled();
  });
});
