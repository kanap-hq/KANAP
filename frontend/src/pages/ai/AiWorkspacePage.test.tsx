import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AiWorkspacePage from './AiWorkspacePage';
import { aiConversationsApi } from '../../ai/aiApi';
import type { AiMutationPreview, ChatConversation, ChatMessage } from '../../ai/aiTypes';
import { createAppTheme } from '../../config/ThemeContext';

let featuresState = {
  config: {
    features: {
      billing: true,
      sso: true,
      email: true,
      aiChat: true,
      aiMcp: false,
      aiSettings: false,
      aiWebSearch: false,
    },
  },
};

let chatState = {
  messages: [] as ChatMessage[],
  previews: [] as any[],
  conversationUsage: null as { input_tokens: number; output_tokens: number } | null,
  lastRequestUsage: null as { input_tokens: number; output_tokens: number } | null,
  isStreaming: false,
  error: null as string | null,
  conversationId: null as string | null,
  sendMessage: vi.fn(async () => undefined),
  loadConversation: vi.fn(async () => undefined),
  newConversation: vi.fn(),
  cancelStream: vi.fn(),
};

vi.mock('../../config/FeaturesContext', () => ({
  useFeatures: () => featuresState,
}));

let capabilitiesState: { data: any } = { data: undefined };

vi.mock('../../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => capabilitiesState,
}));

function chatCapabilities(reasons: string[]) {
  return {
    instance_features: { ai_chat: true, ai_mcp: false, ai_settings: false, ai_web_search: false },
    surfaces: {
      chat: {
        feature_enabled: true,
        tenant_enabled: true,
        permission_granted: true,
        provider_ready: !reasons.includes('builtin_not_accepted'),
        available: reasons.length === 0,
        reasons,
      },
      mcp: { feature_enabled: false, tenant_enabled: false, permission_granted: false, provider_ready: false, available: false, reasons: [] },
      settings: { feature_enabled: false, permission_granted: false, available: false, reasons: [] },
    },
    builtin_confirmation_needed: reasons.includes('builtin_not_accepted'),
  };
}

vi.mock('../../ai/useChat', () => ({
  MAX_PENDING_ATTACHMENTS: 5,
  useChat: () => chatState,
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock('../../ai/components/ChatMessageList', () => ({
  default: () => <div data-testid="chat-message-list" />,
}));

vi.mock('../../ai/components/ArtifactPanel', () => ({
  default: ({ previews, open }: { previews: AiMutationPreview[]; open: boolean }) => (
    previews.length > 0 ? (
      <div data-testid="artifact-panel" data-open={String(open)}>
        {previews.map((preview) => (
          <span key={preview.preview_id}>{preview.preview_id}</span>
        ))}
      </div>
    ) : null
  ),
}));

vi.mock('../../ai/components/ChatConversationList', () => ({
  default: ({ onSelect, onNew, onArchive }: any) => (
    <div>
      <button type="button" onClick={() => onNew()}>New chat</button>
      <button type="button" onClick={() => onSelect('conv-1')}>Select conversation</button>
      <button type="button" onClick={() => onArchive('conv-1')}>Archive conversation</button>
    </div>
  ),
}));

vi.mock('../../ai/components/ChatInput', () => ({
  default: React.forwardRef((_props: any, _ref) => (
    <button type="button" onClick={() => _props.onSend('hello from mock')} disabled={_props.disabled}>
      Send message
    </button>
  )),
}));

vi.mock('../../ai/components/TokenUsageBar', () => ({
  default: ({ usage, lastRequestUsage }: any) => (
    <div data-testid="token-usage-bar">
      {usage.input_tokens}/{usage.output_tokens}/{lastRequestUsage?.input_tokens ?? 'none'}
    </div>
  ),
}));

vi.mock('../../ai/aiApi', () => ({
  aiConversationsApi: {
    archive: vi.fn(async () => undefined),
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      language: 'en',
      resolvedLanguage: 'en',
    },
    ready: true,
  }),
}));

function renderPage(client: QueryClient) {
  const theme = createAppTheme('light');
  return render(
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={client}>
        <AiWorkspacePage />
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear: vi.fn(() => store.clear()),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => { store.delete(key); }),
    setItem: vi.fn((key: string, value: string) => { store.set(key, String(value)); }),
  };
}

function makeMarkdownPreview(previewId: string, body: string): AiMutationPreview {
  return {
    preview_id: previewId,
    tool_name: 'create_document',
    status: 'pending',
    target: {
      entity_type: 'document',
      entity_id: null,
      ref: 'DOC-1',
      title: 'Document',
    },
    changes: {
      content: {
        label: 'Content',
        from: null,
        to: body,
        format: 'markdown',
      },
    },
    requires_confirmation: true,
    actions: ['approve', 'reject'],
    summary: 'Create document',
    error_message: null,
    conversation_id: 'conv-1',
    created_at: '2026-03-23T10:00:00.000Z',
    expires_at: null,
    approved_at: null,
    rejected_at: null,
    executed_at: null,
  };
}

describe('AiWorkspacePage', () => {
  beforeEach(() => {
    featuresState = {
      config: {
        features: {
          billing: true,
          sso: true,
          email: true,
          aiChat: true,
          aiMcp: false,
          aiSettings: false,
          aiWebSearch: false,
        },
      },
    };
    capabilitiesState = { data: chatCapabilities([]) };
    chatState = {
      messages: [],
      previews: [],
      conversationUsage: null,
      lastRequestUsage: null,
      isStreaming: false,
      error: null,
      conversationId: null,
      sendMessage: vi.fn(async () => undefined),
      loadConversation: vi.fn(async () => undefined),
      newConversation: vi.fn(),
      cancelStream: vi.fn(),
    };
    const localStorageMock = createLocalStorageMock();
    vi.stubGlobal('localStorage', localStorageMock);
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    });
    vi.clearAllMocks();
  });

  it('shows the feature-gated hidden state when native chat is disabled', () => {
    featuresState = {
      config: {
        features: {
          billing: true,
          sso: true,
          email: true,
          aiChat: false,
          aiMcp: false,
          aiSettings: false,
          aiWebSearch: false,
        },
      },
    };

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    renderPage(client);

    expect(screen.getByText('workspace.title')).toBeInTheDocument();
    expect(screen.getByText('workspace.messages.disabled')).toBeInTheDocument();
  });

  it('says an administrator must confirm the AI provider when only that holds the assistant back', () => {
    capabilitiesState = { data: chatCapabilities(['builtin_not_accepted']) };
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    renderPage(client);

    expect(screen.getByText('workspace.messages.builtinNotAccepted')).toBeInTheDocument();
    expect(screen.queryByText('Send message')).not.toBeInTheDocument();
  });

  it('keeps the chat when the assistant is available', () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    renderPage(client);

    expect(screen.queryByText('workspace.messages.builtinNotAccepted')).not.toBeInTheDocument();
    expect(screen.getByText('Send message')).toBeInTheDocument();
  });

  it('forwards conversation selection and sends messages from the page controls', () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    renderPage(client);

    fireEvent.click(screen.getByText('Select conversation'));
    fireEvent.click(screen.getByText('Send message'));

    expect(chatState.loadConversation).toHaveBeenCalledWith('conv-1');
    expect(chatState.sendMessage).toHaveBeenCalledWith('hello from mock');
  });

  it('renders the token usage bar only when conversation usage exists', () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    chatState.messages = [{ id: 'msg-1', role: 'assistant', content: 'Hello' }];
    chatState.conversationUsage = { input_tokens: 12, output_tokens: 4 };
    chatState.lastRequestUsage = { input_tokens: 7, output_tokens: 2 };

    renderPage(client);

    expect(screen.getByTestId('token-usage-bar')).toHaveTextContent('12/4/7');
  });

  it('hides the token usage bar when no conversation usage is available', () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    chatState.messages = [{ id: 'msg-1', role: 'assistant', content: 'Hello' }];
    chatState.conversationUsage = null;
    chatState.lastRequestUsage = null;

    renderPage(client);

    expect(screen.queryByTestId('token-usage-bar')).not.toBeInTheDocument();
  });

  it('keeps short mutation previews out of the artifact panel', () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    chatState.messages = [{ id: 'msg-1', role: 'assistant', content: 'Preview ready' }];
    chatState.previews = [makeMarkdownPreview('short-preview', 'Short content update')];

    renderPage(client);

    expect(screen.queryByTestId('artifact-panel')).not.toBeInTheDocument();
  });

  it('auto-opens the artifact panel for referenced preview groups', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    chatState.messages = [{
      id: 'msg-1',
      role: 'assistant',
      content: 'Preview ready',
      previewIds: ['long-preview'],
    }];
    chatState.previews = [
      makeMarkdownPreview('short-preview', 'Short content update'),
      makeMarkdownPreview('long-preview', 'Long content '.repeat(80)),
    ];

    renderPage(client);

    expect(screen.getByTestId('artifact-panel')).toHaveTextContent('long-preview');
    expect(screen.queryByText('short-preview')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('artifact-panel')).toHaveAttribute('data-open', 'true');
    });
  });

  it('switches the artifact panel to the latest preview group from tool results', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    const previewOne = makeMarkdownPreview('preview-1', 'Task 1 comment');
    const previewTwo = makeMarkdownPreview('preview-2', 'Task 2 comment');
    const stalePreview = makeMarkdownPreview('preview-stale', 'Done task comment');

    chatState.messages = [{
      id: 'msg-1',
      role: 'assistant',
      content: 'Initial selection',
      previewIds: ['preview-1', 'preview-2', 'preview-stale'],
    }];
    chatState.previews = [previewOne, previewTwo, stalePreview];

    const view = renderPage(client);

    expect(screen.getByTestId('artifact-panel')).toHaveTextContent('preview-stale');

    chatState.messages = [
      chatState.messages[0],
      { id: 'msg-user-2', role: 'user', content: 'Exclude completed tasks' },
      {
        id: 'msg-2',
        role: 'assistant',
        content: 'Updated selection',
        toolResults: [{
          id: 'tool-1',
          name: 'prepare_mutation_plan',
          result: {
            previews: [previewOne, previewTwo],
            total: 2,
            created: 2,
            failed: 0,
            complete: true,
          },
        }],
      },
    ];

    view.rerender(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={client}>
          <AiWorkspacePage />
        </QueryClientProvider>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('artifact-panel')).toHaveTextContent('preview-1');
      expect(screen.getByTestId('artifact-panel')).toHaveTextContent('preview-2');
      expect(screen.getByTestId('artifact-panel')).not.toHaveTextContent('preview-stale');
    });
  });

  it('optimistically archives the active conversation and clears it from the query cache', async () => {
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const conversations: ChatConversation[] = [
      {
        id: 'conv-1',
        title: 'Active conversation',
        provider: 'openai',
        model: 'gpt-4o',
        created_at: '2026-03-23T10:00:00.000Z',
        updated_at: '2026-03-23T10:00:00.000Z',
      },
      {
        id: 'conv-2',
        title: 'Other conversation',
        provider: 'openai',
        model: 'gpt-4o',
        created_at: '2026-03-23T11:00:00.000Z',
        updated_at: '2026-03-23T11:00:00.000Z',
      },
    ];

    client.setQueryData(['ai-conversations'], conversations);
    chatState.conversationId = 'conv-1';

    renderPage(client);

    fireEvent.click(screen.getByText('Archive conversation'));

    await waitFor(() => {
      expect(chatState.newConversation).toHaveBeenCalledTimes(1);
      expect(aiConversationsApi.archive).toHaveBeenCalledWith('conv-1');
    });

    expect(client.getQueryData<ChatConversation[]>(['ai-conversations'])).toEqual([
      conversations[1],
    ]);
  });
});
