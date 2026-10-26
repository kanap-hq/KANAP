import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AgentWorkspacePage from './AgentWorkspacePage';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import type { AiAgentControlAgentDefinition } from '../../ai/aiApi';

// An administrator can rename the agent from the header. A reader sees the same
// words as plain text. The rest of the workspace stays out of this file.

const harness = vi.hoisted(() => ({
  canAdmin: true,
  updateAgent: vi.fn(),
  snapshot: (): Record<string, unknown> => ({}),
}));

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string) => harness.canAdmin && (resource === 'ai_agents' || resource === 'ai_settings'),
  }),
}));

vi.mock('../../ai/aiApi', async () => {
  const actual = await vi.importActual<typeof import('../../ai/aiApi')>('../../ai/aiApi');
  return {
    ...actual,
    aiAgentControlApi: {
      ...actual.aiAgentControlApi,
      updateAgent: harness.updateAgent,
    },
  };
});

vi.mock('./useAgentControlData', () => ({
  SHARED_CONTEXT_PROFILES_QUERY_KEY: ['ai-shared-context-profiles'],
  useAgentControlData: () => harness.snapshot(),
}));

vi.mock('../../components/agents/AgentControlBar', () => ({ default: () => null }));
vi.mock('../../components/agents/AgentStatusStrip', () => ({ default: () => null }));
vi.mock('./AgentsActivityPage', () => ({ default: () => null }));

const definition: AiAgentControlAgentDefinition = {
  id: 'agent-1',
  agent_key: 'payroll',
  name: 'Payroll agent',
  description: 'Drafts first replies',
  agent_type: 'helpdesk',
  status: 'enabled',
  environment: 'production',
  provider_bindings_json: null,
  allowed_capabilities_json: null,
  forbidden_capabilities_json: null,
  max_autonomy_level: 'A1',
  default_approval_requirement: 'approval',
  agent_priority: 100,
  trigger_policy_json: null,
  scope_policy_json: null,
  queue_policy_json: null,
  response_policy_json: null,
  evaluation_policy_json: null,
  persona_json: null,
  llm_model_config_id: null,
  config_version: 1,
  updated_by_user_id: null,
  metadata_json: null,
  created_at: null,
  updated_at: null,
};

harness.snapshot = () => ({
  queueQuery: {
    data: { definitions: [definition] },
    isLoading: false,
  },
  actionPool: [],
  ticketingProviderKey: null,
  error: null,
  message: null,
  setError: vi.fn(),
  setMessage: vi.fn(),
  invalidate: vi.fn(),
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/agents/payroll']}>
          <Routes>
            <Route path="/agents/:agentKey" element={<AgentWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('AgentWorkspacePage header', () => {
  beforeEach(async () => {
    harness.canAdmin = true;
    harness.updateAgent.mockReset();
    harness.updateAgent.mockResolvedValue({ agent_definition: definition, diff: {} });
    await i18n.changeLanguage('en');
  });

  it('offers the title as Edit title and saves it on Enter', async () => {
    renderPage();
    const title = screen.getByRole('button', { name: 'Edit title' });
    expect(title).toHaveTextContent('Payroll agent');
    expect(getComputedStyle(title).fontSize).toBe('20px');
    expect(getComputedStyle(title).fontWeight).toBe('500');
    const pencil = title.querySelector('.editable-title-cue');
    expect(pencil).not.toBeNull();
    expect(getComputedStyle(pencil as HTMLElement).display).toBe('none');

    title.focus();
    expect(getComputedStyle(pencil as HTMLElement).display).toBe('inline-block');
    expect(title).toHaveStyle({ backgroundColor: 'rgba(0, 0, 0, 0.04)' });

    fireEvent.keyDown(title, { key: 'Enter' });
    const input = screen.getByRole('textbox', { name: 'Edit title' });
    expect(input).toHaveValue('Payroll agent');
    fireEvent.change(input, { target: { value: '  Payroll renamed  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(harness.updateAgent).toHaveBeenCalledTimes(1);
    });
    expect(harness.updateAgent).toHaveBeenCalledWith('agent-1', { name: 'Payroll renamed' });
    expect(screen.getByRole('button', { name: 'Edit title' })).toHaveFocus();
  });

  it('saves the title when the field loses focus', async () => {
    renderPage();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Edit title' }), { key: 'Enter' });
    const input = screen.getByRole('textbox', { name: 'Edit title' });
    fireEvent.change(input, { target: { value: 'Payroll from blur' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(harness.updateAgent).toHaveBeenCalledWith('agent-1', { name: 'Payroll from blur' });
    });
  });

  it('opens the description from the keyboard and saves it on blur', async () => {
    renderPage();
    const description = screen.getByRole('button', { name: 'Edit description' });
    expect(description).toHaveTextContent('Drafts first replies');
    fireEvent.keyDown(description, { key: ' ' });
    expect(screen.queryByRole('textbox', { name: 'Edit description' })).toBeNull();
    fireEvent.keyUp(description, { key: ' ' });
    const field = screen.getByRole('textbox', { name: 'Edit description' });
    expect(field).toHaveValue('Drafts first replies');
    fireEvent.change(field, { target: { value: '  Updated summary  ' } });
    fireEvent.blur(field);

    await waitFor(() => {
      expect(harness.updateAgent).toHaveBeenCalledWith('agent-1', { description: 'Updated summary' });
    });
  });

  it('shows the title and the description as plain text without admin rights', () => {
    harness.canAdmin = false;
    renderPage();
    expect(screen.queryByRole('button', { name: 'Edit title' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit description' })).not.toBeInTheDocument();
    expect(screen.getByText('Payroll agent')).toBeInTheDocument();
    expect(screen.getByText('Drafts first replies')).toBeInTheDocument();
    expect(document.querySelector('.editable-title-cue')).toBeNull();
  });
});
