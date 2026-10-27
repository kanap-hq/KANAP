import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentsOverviewPage from './AgentsOverviewPage';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import { formatEuro } from '../../i18n/formatters';

// The agents overview tells everyone who sees agents that the ones running on the KANAP
// included model are paused while no administrator has confirmed it, with a way to the
// AI settings for those who can open them.

let capabilitiesState: { data: any } = { data: undefined };
let canOpenAiSettings = true;
let fleetCost: { today_eur: number; last_7_days_eur: number } | undefined;

vi.mock('../../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => capabilitiesState,
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string) => (resource === 'ai_settings' ? canOpenAiSettings : resource === 'ai_agents'),
  }),
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

const idleMutation = { isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() };

vi.mock('./useAgentControlData', () => ({
  useAgentControlData: () => ({
    queueQuery: { data: { definitions: [], emergency_pause: null, cost: fleetCost }, isLoading: false },
    badgesQuery: { data: { pendingApprovals: 0 } },
    error: null,
    message: null,
    setError: vi.fn(),
    setMessage: vi.fn(),
    createPauseMutation: idleMutation,
    revokePauseMutation: idleMutation,
    createAgentMutation: idleMutation,
    deleteAgentMutation: idleMutation,
    actionPool: null,
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

const PAUSED = 'Agents that use the KANAP included model are paused until an administrator confirms it in Admin > Plaid.';

// Testing Library collapses the no-break spaces Intl writes before EUR. Compare that form.
function shown(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

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
    expect(screen.getByRole('link', { name: 'Open Plaid settings' })).toHaveAttribute('href', '/admin/ai');
  });

  it('shows the banner without the link to those who cannot open the AI settings', () => {
    capabilitiesState = { data: { builtin_confirmation_needed: true } };
    canOpenAiSettings = false;
    renderPage();
    expect(screen.getByText(PAUSED)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open Plaid settings' })).not.toBeInTheDocument();
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
