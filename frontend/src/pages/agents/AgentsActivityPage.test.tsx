import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AgentsActivityPage from './AgentsActivityPage';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';

// The Activity screen names what an entry did and to which object in words a person knows: a
// label for the capability (never its key), the business reference of the object (never its id).

const EXECUTE_APPROVED = 'kanap.mutation_preview.execute_approved';
const TASK_ID = '3f2b8c1e-5a47-4d0e-9c1a-0b7e6d5f4a32';
const GONE_ID = '8a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

let items: any[] = [];

vi.mock('../../ai/aiApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../ai/aiApi')>()),
  aiAgentControlApi: {
    getQueueOverview: vi.fn(async () => ({ definitions: [] })),
    listActivity: vi.fn(async () => ({ items, total: items.length, limit: 50, nextCursor: null })),
  },
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../../components/agents/RunTraceDialog', () => ({ default: () => null }));

function entry(over: Record<string, unknown>) {
  return {
    id: `action:${Math.random()}:execution`,
    at: '2026-11-09T10:00:00.000Z',
    type: 'execution',
    agentDefinitionId: null,
    agentKey: null,
    targetType: null,
    targetRef: null,
    targetDisplay: null,
    titleKey: 'action_executed',
    status: 'executed',
    actorUserId: null,
    actionRequestId: null,
    approvalId: null,
    runId: null,
    auditEventId: null,
    capabilityName: null,
    actionClass: null,
    eventType: null,
    severity: null,
    errorMessage: null,
    detail: null,
    ...over,
  };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AgentsActivityPage />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('AgentsActivityPage labels', () => {
  beforeEach(async () => {
    items = [
      entry({ targetType: 'tasks', targetRef: TASK_ID, targetDisplay: 'T-15', capabilityName: EXECUTE_APPROVED, actionClass: EXECUTE_APPROVED }),
      entry({ targetType: 'tasks', targetRef: GONE_ID, targetDisplay: null, capabilityName: EXECUTE_APPROVED, actionClass: EXECUTE_APPROVED }),
      entry({ targetType: 'ticket', targetRef: '4711', capabilityName: 'ticketing.ticket.public_reply.add_approved', actionClass: 'public_reply' }),
      entry({ targetType: 'ticket', targetRef: '4712', capabilityName: 'vendor.thing.do_it', actionClass: 'vendor.thing.do_it' }),
    ];
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows the label of the capability and the reference of the object', async () => {
    const { container } = renderPage();
    expect(await screen.findByText('T-15')).toBeInTheDocument();
    expect(screen.getAllByText('Approved change')).toHaveLength(2);
    expect(screen.getAllByText('Task')).toHaveLength(2);
    expect(screen.getByText('Requester reply')).toBeInTheDocument();
    expect(screen.getByText('#4711')).toBeInTheDocument();
    const text = container.textContent ?? '';
    expect(text).not.toContain('kanap.mutation');
    expect(text).not.toContain('mutation preview');
    expect(text).not.toContain(TASK_ID);
    expect(text).not.toContain(GONE_ID);
  });

  it('falls back to a generic action for a capability without a label', async () => {
    const { container } = renderPage();
    expect(await screen.findByText('Other action')).toBeInTheDocument();
    expect(container.textContent).not.toContain('vendor.thing');
  });

  it('shows the labels in French', async () => {
    await i18n.changeLanguage('fr');
    const { container } = renderPage();
    expect(await screen.findByText('T-15')).toBeInTheDocument();
    expect(screen.getAllByText('Modification approuvée')).toHaveLength(2);
    expect(screen.getAllByText('Tâche')).toHaveLength(2);
    expect(screen.getByText('Autre action')).toBeInTheDocument();
    expect(container.textContent).not.toContain('kanap.mutation');
  });
});
