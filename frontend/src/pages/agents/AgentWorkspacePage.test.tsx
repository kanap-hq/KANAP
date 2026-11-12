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
  webSearch: false,
  snapshot: (): Record<string, unknown> => ({}),
}));

vi.mock('../../config/FeaturesContext', async () => {
  const actual = await vi.importActual<typeof import('../../config/FeaturesContext')>('../../config/FeaturesContext');
  return {
    ...actual,
    useFeatures: () => {
      const features = actual.useFeatures();
      return { ...features, config: { ...features.config, features: { ...features.config.features, aiWebSearch: harness.webSearch } } };
    },
  };
});

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

// The knowledge base search of an agent: off on a new agent, with no library option shown.
// Turned on, the agent cites the chosen libraries (none chosen yet) or all of them.
describe('AgentWorkspacePage knowledge libraries', { timeout: 20000 }, () => {
  const LIBRARY_ID = '11111111-1111-4111-8111-111111111111';
  const REMOVED_TEXTS = [
    /cites no document/,
    /searches only these libraries/,
    /may also search the public web/,
  ];

  function withKnowledge(knowledge: Record<string, unknown> | null): AiAgentControlAgentDefinition {
    return {
      ...definition,
      scope_policy_json: knowledge ? { knowledge_sources: { knowledge, web: { enabled: false } } } : null,
    };
  }

  function expectNoRemovedText() {
    for (const text of REMOVED_TEXTS) expect(screen.queryByText(text)).not.toBeInTheDocument();
  }

  beforeEach(async () => {
    harness.canAdmin = true;
    harness.webSearch = true;
    harness.updateAgent.mockReset();
    harness.updateAgent.mockImplementation(async () => ({ agent_definition: shownDefinition, diff: {} }));
    harness.listKnowledgeLibraries.mockReset();
    harness.listKnowledgeLibraries.mockResolvedValue([{ id: LIBRARY_ID, name: 'Service desk docs', slug: null }]);
    await i18n.changeLanguage('en');
  });

  it('shows a new agent with the search off and no library option', async () => {
    shownDefinition = withKnowledge({ enabled: false, all_libraries: false, library_ids: [] });
    renderPage('/agents/payroll?tab=settings');
    expect(await screen.findByLabelText('Search the knowledge base', {}, { timeout: 5000 })).not.toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Chosen libraries' })).not.toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'All libraries' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Select libraries')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Search the web')).toBeInTheDocument();
    expectNoRemovedText();
  });

  it('turns the search on with chosen libraries and an empty menu, and saves what it shows', async () => {
    shownDefinition = withKnowledge({ enabled: false, all_libraries: false, library_ids: [] });
    renderPage('/agents/payroll?tab=settings');
    fireEvent.click(await screen.findByLabelText('Search the knowledge base', {}, { timeout: 5000 }));
    expect(screen.getAllByRole('radio').filter((radio) => radio.closest('[aria-label="Libraries"]'))).toHaveLength(2);
    expect(screen.getByRole('radio', { name: 'Chosen libraries' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'All libraries' })).not.toBeChecked();
    expect(screen.queryByRole('radio', { name: 'No library' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Select libraries')).toHaveTextContent('Select libraries');
    expectNoRemovedText();
    await waitFor(() => {
      expect(harness.updateAgent).toHaveBeenLastCalledWith('agent-1', {
        knowledge_sources: {
          knowledge: { enabled: true, all_libraries: false, library_ids: [] },
          web: { enabled: false },
          internal_notes: 'used',
        },
      });
    }, { timeout: 3000 });
  });

  it('reads an agent saved with the search on and no library as chosen libraries, menu empty', async () => {
    shownDefinition = withKnowledge({ enabled: true, all_libraries: false, library_ids: [] });
    renderPage('/agents/payroll?tab=settings');
    expect(await screen.findByRole('radio', { name: 'Chosen libraries' }, { timeout: 5000 })).toBeChecked();
    expect(screen.getByLabelText('Select libraries')).toHaveTextContent('Select libraries');
    expectNoRemovedText();
  });

  it('keeps an agent saved with all libraries on all libraries', async () => {
    shownDefinition = withKnowledge({ enabled: true, all_libraries: true, library_ids: [] });
    renderPage('/agents/payroll?tab=settings');
    expect(await screen.findByRole('radio', { name: 'All libraries' }, { timeout: 5000 })).toBeChecked();
    expect(screen.getByLabelText('Search the knowledge base')).toBeChecked();
  });

  it('reads an agent saved without a library setting as searching all libraries', async () => {
    shownDefinition = withKnowledge(null);
    renderPage('/agents/payroll?tab=settings');
    expect(await screen.findByRole('radio', { name: 'All libraries' }, { timeout: 5000 })).toBeChecked();
    expect(screen.getByLabelText('Search the knowledge base')).toBeChecked();
  });

  it('saves chosen libraries, then all libraries', async () => {
    shownDefinition = withKnowledge({ enabled: true, all_libraries: false, library_ids: [] });
    renderPage('/agents/payroll?tab=settings');
    await screen.findByRole('radio', { name: 'Chosen libraries' }, { timeout: 5000 });
    fireEvent.mouseDown(screen.getByLabelText('Select libraries'));
    fireEvent.click(await screen.findByText('Service desk docs', { selector: 'li' }));
    await waitFor(() => {
      expect(harness.updateAgent).toHaveBeenLastCalledWith('agent-1', {
        knowledge_sources: {
          knowledge: { enabled: true, all_libraries: false, library_ids: [LIBRARY_ID] },
          web: { enabled: false },
          internal_notes: 'used',
        },
      });
    }, { timeout: 3000 });

    fireEvent.keyDown(screen.getByText('Service desk docs', { selector: 'li' }), { key: 'Escape' });
    fireEvent.click(screen.getByRole('radio', { name: 'All libraries' }));
    await waitFor(() => {
      expect(harness.updateAgent).toHaveBeenLastCalledWith('agent-1', {
        knowledge_sources: {
          knowledge: { enabled: true, all_libraries: true, library_ids: [] },
          web: { enabled: false },
          internal_notes: 'used',
        },
      });
    }, { timeout: 3000 });
  });

  it('says why the web search is unavailable when the platform has none', async () => {
    harness.webSearch = false;
    shownDefinition = withKnowledge({ enabled: false, all_libraries: false, library_ids: [] });
    renderPage('/agents/payroll?tab=settings');
    expect(await screen.findByText(/Web search isn't available on this platform yet/, {}, { timeout: 5000 })).toBeInTheDocument();
  });
});

// A ticket agent uses the internal notes of a ticket, or ignores them. An agent saved without
// the setting uses them.
describe('AgentWorkspacePage internal notes', { timeout: 20000 }, () => {
  const USED_STATE = 'The agent uses them to decide and to reply.';
  const IGNORED_STATE = 'The agent reads only the public messages of the ticket.';

  function withInternalNotes(internalNotes: string | undefined, agentType = 'helpdesk'): AiAgentControlAgentDefinition {
    return {
      ...definition,
      agent_type: agentType,
      scope_policy_json: {
        knowledge_sources: {
          knowledge: { enabled: true, all_libraries: true, library_ids: [] },
          web: { enabled: false },
          ...(internalNotes === undefined ? {} : { internal_notes: internalNotes }),
        },
      },
    };
  }

  beforeEach(async () => {
    harness.canAdmin = true;
    harness.updateAgent.mockReset();
    harness.updateAgent.mockImplementation(async () => ({ agent_definition: shownDefinition, diff: {} }));
    harness.listKnowledgeLibraries.mockReset();
    harness.listKnowledgeLibraries.mockResolvedValue([]);
    await i18n.changeLanguage('en');
  });

  it('shows an agent saved without the setting as using them', async () => {
    shownDefinition = withInternalNotes(undefined);
    renderPage('/agents/payroll?tab=settings');
    expect(await screen.findByLabelText('Used', {}, { timeout: 5000 })).toBeChecked();
    expect(screen.getByLabelText('Ignored')).not.toBeChecked();
    expect(screen.getByText('Internal notes of the ticket')).toBeInTheDocument();
    expect(screen.getByText(USED_STATE)).toBeInTheDocument();
  });

  it('saves ignored, then used', async () => {
    shownDefinition = withInternalNotes('used');
    renderPage('/agents/payroll?tab=settings');
    fireEvent.click(await screen.findByLabelText('Ignored', {}, { timeout: 5000 }));
    await waitFor(() => {
      expect(harness.updateAgent).toHaveBeenLastCalledWith('agent-1', {
        knowledge_sources: {
          knowledge: { enabled: true, all_libraries: true, library_ids: [] },
          web: { enabled: false },
          internal_notes: 'ignored',
        },
      });
    }, { timeout: 3000 });
    expect(screen.getByText(IGNORED_STATE)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Used'));
    await waitFor(() => {
      expect(harness.updateAgent).toHaveBeenLastCalledWith('agent-1', {
        knowledge_sources: expect.objectContaining({ internal_notes: 'used' }),
      });
    }, { timeout: 3000 });
  });

  it('shows the stored choice', async () => {
    shownDefinition = withInternalNotes('ignored');
    renderPage('/agents/payroll?tab=settings');
    expect(await screen.findByLabelText('Ignored', {}, { timeout: 5000 })).toBeChecked();
    expect(screen.getByText(IGNORED_STATE)).toBeInTheDocument();
  });

  it('keeps ignored when another setting of the page is saved', async () => {
    shownDefinition = {
      ...withInternalNotes('ignored'),
      provider_bindings_json: { ticketing: { provider_kind: 'ticketing', provider_key: 'glpi' } },
    };
    renderPage('/agents/payroll?tab=settings');
    expect(await screen.findByLabelText('Ignored', {}, { timeout: 5000 })).toBeChecked();
    let row: HTMLElement | null = screen.getByText('Tickets per check');
    while (row && !row.querySelector('input')) row = row.parentElement;
    fireEvent.change(row!.querySelector('input')!, { target: { value: '7' } });
    await waitFor(() => {
      expect(harness.updateAgent).toHaveBeenCalled();
    }, { timeout: 3000 });
    // The operating settings send the whole scope policy, the stored internal notes setting included.
    const [, payload] = harness.updateAgent.mock.lastCall!;
    expect(payload.scope_policy_json.knowledge_sources.internal_notes).toBe('ignored');
    expect(payload).not.toHaveProperty('knowledge_sources');
  });

  it('is not shown for a monitoring agent', async () => {
    shownDefinition = withInternalNotes(undefined, 'sre');
    renderPage('/agents/payroll?tab=settings');
    expect(await screen.findByLabelText('All libraries', {}, { timeout: 5000 })).toBeChecked();
    expect(screen.queryByText('Internal notes of the ticket')).not.toBeInTheDocument();
  });
});
