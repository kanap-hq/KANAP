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
  listKnowledgeLibraries: vi.fn(),
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
      listKnowledgeLibraries: harness.listKnowledgeLibraries,
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

let shownDefinition: AiAgentControlAgentDefinition = definition;

harness.snapshot = () => ({
  queueQuery: {
    data: { definitions: [shownDefinition] },
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

function renderPage(path = '/agents/payroll') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
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
    shownDefinition = definition;
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

// The libraries an agent may cite: none, chosen ones or all. A new agent starts with none,
// and the settings say what that means without opening anything.
describe('AgentWorkspacePage knowledge libraries', { timeout: 20000 }, () => {
  const LIBRARY_ID = '11111111-1111-4111-8111-111111111111';
  const NO_DOCUMENT = 'The agent cites no document in its replies.';

  function withKnowledge(knowledge: Record<string, unknown> | null): AiAgentControlAgentDefinition {
    return {
      ...definition,
      scope_policy_json: knowledge ? { knowledge_sources: { knowledge, web: { enabled: false } } } : null,
    };
  }

  beforeEach(async () => {
    harness.canAdmin = true;
    harness.updateAgent.mockReset();
    harness.updateAgent.mockImplementation(async () => ({ agent_definition: shownDefinition, diff: {} }));
    harness.listKnowledgeLibraries.mockReset();
    harness.listKnowledgeLibraries.mockResolvedValue([{ id: LIBRARY_ID, name: 'Service desk docs', slug: null }]);
    await i18n.changeLanguage('en');
  });

  it('shows a new agent with no library and what it means', async () => {
    shownDefinition = withKnowledge({ enabled: true, all_libraries: false, library_ids: [] });
    renderPage('/agents/payroll?tab=settings');
    expect(await screen.findByLabelText('No library', {}, { timeout: 5000 })).toBeChecked();
    expect(screen.getByLabelText('Chosen libraries')).not.toBeChecked();
    expect(screen.getByLabelText('All libraries')).not.toBeChecked();
    expect(screen.getByText(NO_DOCUMENT)).toBeInTheDocument();
  });

  it('keeps an agent saved with all libraries on all libraries', async () => {
    shownDefinition = withKnowledge({ enabled: true, all_libraries: true, library_ids: [] });
    renderPage('/agents/payroll?tab=settings');
    expect(await screen.findByLabelText('All libraries', {}, { timeout: 5000 })).toBeChecked();
    expect(screen.queryByText(NO_DOCUMENT)).not.toBeInTheDocument();
  });

  it('reads an agent saved without a library setting as all libraries', async () => {
    shownDefinition = withKnowledge(null);
    renderPage('/agents/payroll?tab=settings');
    expect(await screen.findByLabelText('All libraries', {}, { timeout: 5000 })).toBeChecked();
    expect(screen.queryByText(NO_DOCUMENT)).not.toBeInTheDocument();
  });

  it('saves chosen libraries, then all libraries', async () => {
    shownDefinition = withKnowledge({ enabled: true, all_libraries: false, library_ids: [] });
    renderPage('/agents/payroll?tab=settings');
    fireEvent.click(await screen.findByLabelText('Chosen libraries', {}, { timeout: 5000 }));
    fireEvent.mouseDown(screen.getByLabelText('Select libraries'));
    fireEvent.click(await screen.findByText('Service desk docs', { selector: 'li' }));
    await waitFor(() => {
      expect(harness.updateAgent).toHaveBeenLastCalledWith('agent-1', {
        knowledge_sources: {
          knowledge: { enabled: true, all_libraries: false, library_ids: [LIBRARY_ID] },
          web: { enabled: false },
        },
      });
    }, { timeout: 3000 });
    expect(screen.queryByText(NO_DOCUMENT)).not.toBeInTheDocument();

    fireEvent.keyDown(screen.getByText('Service desk docs', { selector: 'li' }), { key: 'Escape' });
    fireEvent.click(screen.getByLabelText('All libraries'));
    await waitFor(() => {
      expect(harness.updateAgent).toHaveBeenLastCalledWith('agent-1', {
        knowledge_sources: {
          knowledge: { enabled: true, all_libraries: true, library_ids: [] },
          web: { enabled: false },
        },
      });
    }, { timeout: 3000 });
  });
});
