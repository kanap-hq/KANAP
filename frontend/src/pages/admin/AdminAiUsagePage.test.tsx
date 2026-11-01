import React from 'react';
import '../../i18n';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminAiUsagePage from './AdminAiUsagePage';
import { aiAdminApi } from '../../ai/aiApi';

vi.mock('../../ai/aiApi', () => ({
  aiAdminApi: { getOverview: vi.fn() },
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

const ESTIMATED_NOTE = 'Partly estimated at the currently assigned model’s rates';
const FREE_NOTE = 'The assigned model has no cost';

function overview(costs: { chat_eur: number; chat_priced: boolean; chat_estimated: boolean }) {
  return {
    totals: { conversations_all: 0, conversations_7d: 0, conversations_30d: 0, active_users_30d: 0 },
    usage: {
      current_month: { input_tokens: 0, output_tokens: 0, total_tokens: 0, message_count: 0 },
      last_30_days: { input_tokens: 0, output_tokens: 0, total_tokens: 0, message_count: 0 },
    },
    recent_activity: [],
    agents: [],
    costs: {
      current_month: { agents_eur: 0, chat_eur: costs.chat_eur, total_eur: costs.chat_eur },
      last_30_days: { agents_eur: 0, chat_eur: costs.chat_eur, total_eur: costs.chat_eur },
      by_agent: [],
      by_model: [],
      chat_priced: costs.chat_priced,
      chat_estimated: costs.chat_estimated,
    },
  };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AdminAiUsagePage />
    </QueryClientProvider>,
  );
}

describe('AdminAiUsagePage chat cost note', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('says the chat cost is partly estimated when some messages carry no cost', async () => {
    (aiAdminApi.getOverview as any).mockResolvedValue(overview({ chat_eur: 3.5, chat_priced: true, chat_estimated: true }));
    renderPage();
    expect(await screen.findByText(ESTIMATED_NOTE)).toBeTruthy();
    expect(screen.queryByText(FREE_NOTE)).toBeNull();
  });

  it('says the model has no cost when the chat cost is 0 and the model has no prices', async () => {
    (aiAdminApi.getOverview as any).mockResolvedValue(overview({ chat_eur: 0, chat_priced: false, chat_estimated: false }));
    renderPage();
    expect(await screen.findByText(FREE_NOTE)).toBeTruthy();
    expect(screen.queryByText(ESTIMATED_NOTE)).toBeNull();
  });

  it('shows no note when every chat cost was recorded', async () => {
    (aiAdminApi.getOverview as any).mockResolvedValue(overview({ chat_eur: 2.5, chat_priced: true, chat_estimated: false }));
    renderPage();
    expect(await screen.findByText('Plaid this month')).toBeTruthy();
    expect(screen.queryByText(ESTIMATED_NOTE)).toBeNull();
    expect(screen.queryByText(FREE_NOTE)).toBeNull();
  });
});
