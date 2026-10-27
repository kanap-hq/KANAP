import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChat } from '../useChat';
import { aiConversationsApi, streamChat } from '../aiApi';

let capturedSignal: AbortSignal | null = null;

function abortError() {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function waitForAbort(signal?: AbortSignal | null) {
  return new Promise<void>((_, reject) => {
    if (!signal) {
      reject(abortError());
      return;
    }

    if (signal.aborted) {
      reject(abortError());
      return;
    }

    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };

    signal.addEventListener('abort', onAbort, { once: true });
  });
}

vi.mock('../aiApi', () => ({
  streamChat: vi.fn(),
  aiConversationsApi: {
    getMessages: vi.fn(),
    getPreviews: vi.fn(),
  },
}));

describe('useChat', () => {
  beforeEach(() => {
    capturedSignal = null;
    vi.resetAllMocks();
  });

  it('aborts an in-flight stream when loading another conversation', async () => {
    vi.mocked(streamChat).mockImplementation(async function* ({ signal }: { signal?: AbortSignal }) {
      capturedSignal = signal ?? null;
      yield { type: 'conversation', id: 'conversation-old', title: 'Old conversation' };
      await waitForAbort(signal);
      yield { type: 'text_delta', text: 'late text' };
    });
    vi.mocked(aiConversationsApi.getMessages).mockResolvedValue({
      messages: [
        { id: 'msg-1', role: 'user', content: 'Loaded user message' },
        { id: 'msg-2', role: 'assistant', content: 'Loaded assistant reply' },
      ],
      conversation_usage: { input_tokens: 8, output_tokens: 3 },
    });
    vi.mocked(aiConversationsApi.getPreviews).mockResolvedValue([]);

    const { result } = renderHook(() => useChat());

    act(() => {
      void result.current.sendMessage('start stream');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });

    await act(async () => {
      await result.current.loadConversation('conversation-new');
    });

    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true);
    });

    await waitFor(() => {
      expect(result.current.conversationId).toBe('conversation-new');
      expect(result.current.isStreaming).toBe(false);
      expect(result.current.conversationUsage).toEqual({ input_tokens: 8, output_tokens: 3 });
      expect(result.current.lastRequestUsage).toBeNull();
      expect(result.current.messages).toEqual([
        { id: 'msg-1', role: 'user', content: 'Loaded user message', hidden: false },
        { id: 'msg-2', role: 'assistant', content: 'Loaded assistant reply', usage: undefined },
      ]);
    });

    expect(result.current.messages).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ content: expect.stringContaining('late text') }),
      ]),
    );
  });

  it('merges stored assistant tool history into a single assistant message', async () => {
    vi.mocked(aiConversationsApi.getMessages).mockResolvedValue({
      messages: [
        { id: 'user-1', role: 'user', content: 'Find the CRM runbook' },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'tool-call-1',
              name: 'search_knowledge',
              arguments: { query: 'CRM runbook' },
            },
          ],
          usage_json: { input_tokens: 10, output_tokens: 4 },
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            tool_call_id: 'tool-call-1',
            tool_name: 'search_knowledge',
            result: { items: [{ id: 'doc-1', title: 'CRM runbook' }] },
          }),
        },
        {
          id: 'assistant-2',
          role: 'assistant',
          content: 'Use the CRM runbook before restarting the service.',
          usage_json: { input_tokens: 12, output_tokens: 18 },
        },
      ],
      conversation_usage: { input_tokens: 22, output_tokens: 22 },
    });
    vi.mocked(aiConversationsApi.getPreviews).mockResolvedValue([]);

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.loadConversation('conversation-1');
    });

    expect(result.current.conversationId).toBe('conversation-1');
    expect(result.current.conversationUsage).toEqual({ input_tokens: 22, output_tokens: 22 });
    expect(result.current.lastRequestUsage).toEqual({ input_tokens: 12, output_tokens: 18 });
    expect(result.current.messages).toEqual([
      {
        id: 'user-1',
        role: 'user',
        content: 'Find the CRM runbook',
        hidden: false,
      },
      {
        id: 'assistant-1',
        role: 'assistant',
        content: 'Use the CRM runbook before restarting the service.',
        toolCalls: [
          {
            id: 'tool-call-1',
            name: 'search_knowledge',
            arguments: { query: 'CRM runbook' },
          },
        ],
        toolResults: [
          {
            id: 'tool-call-1',
            name: 'search_knowledge',
            result: { items: [{ id: 'doc-1', title: 'CRM runbook' }] },
          },
        ],
        usage: { input_tokens: 12, output_tokens: 18 },
      },
    ]);
  });

  it('preserves assistant text stored on tool-call messages after loading history', async () => {
    vi.mocked(aiConversationsApi.getMessages).mockResolvedValue({
      messages: [
        { id: 'user-1', role: 'user', content: 'Ajoute un commentaire aux tâches en retard' },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Je continue avec les tâches restantes :',
          tool_calls: [
            {
              id: 'tool-call-1',
              name: 'query_entities',
              arguments: { entity_type: 'tasks' },
            },
          ],
          usage_json: { input_tokens: 10, output_tokens: 4 },
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            tool_call_id: 'tool-call-1',
            tool_name: 'query_entities',
            result: { items: [{ ref: 'T-1', label: 'Task 1' }], total: 1, complete: true },
          }),
        },
        {
          id: 'assistant-2',
          role: 'assistant',
          content: 'Je prépare maintenant la preview.',
          usage_json: { input_tokens: 12, output_tokens: 18 },
        },
      ],
      conversation_usage: { input_tokens: 22, output_tokens: 22 },
    });
    vi.mocked(aiConversationsApi.getPreviews).mockResolvedValue([]);

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.loadConversation('conversation-1');
    });

    expect(result.current.messages).toEqual([
      expect.objectContaining({ id: 'user-1', role: 'user' }),
      expect.objectContaining({
        id: 'assistant-1',
        role: 'assistant',
        content: 'Je continue avec les tâches restantes :\n\nJe prépare maintenant la preview.',
        toolCalls: [
          {
            id: 'tool-call-1',
            name: 'query_entities',
            arguments: { entity_type: 'tasks' },
          },
        ],
        toolResults: [
          {
            id: 'tool-call-1',
            name: 'query_entities',
            result: { items: [{ ref: 'T-1', label: 'Task 1' }], total: 1, complete: true },
          },
        ],
      }),
    ]);
  });

  it('keeps consecutive assistant tool-call messages with visible text as separate blocks', async () => {
    const previewOne = {
      preview_id: 'preview-1',
      tool_name: 'add_task_comment' as const,
      status: 'pending' as const,
      target: { entity_type: 'tasks', entity_id: 'task-1', ref: 'T-1', title: 'Task 1' },
      changes: { comment: { from: null, to: 'allo ?' } },
      requires_confirmation: true,
      actions: ['approve', 'reject'] as Array<'approve' | 'reject'>,
      summary: 'Add comment to T-1.',
      error_message: null,
      conversation_id: 'conversation-1',
      created_at: '2026-03-24T10:00:00.000Z',
      expires_at: '2026-03-24T10:10:00.000Z',
      approved_at: null,
      rejected_at: null,
      executed_at: null,
    };
    const previewTwo = {
      ...previewOne,
      preview_id: 'preview-2',
      target: { entity_type: 'tasks', entity_id: 'task-2', ref: 'T-2', title: 'Task 2' },
      summary: 'Add comment to T-2.',
    };

    vi.mocked(aiConversationsApi.getMessages).mockResolvedValue({
      messages: [
        { id: 'user-1', role: 'user', content: 'Ajoute le commentaire à toutes les tâches en retard' },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Je continue avec les tâches restantes :',
          tool_calls: [
            {
              id: 'tool-call-1',
              name: 'add_task_comment',
              arguments: { ref: 'T-1', comment: 'allo ?' },
            },
          ],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({
            tool_call_id: 'tool-call-1',
            tool_name: 'add_task_comment',
            result: previewOne,
          }),
        },
        {
          id: 'assistant-2',
          role: 'assistant',
          content: 'Je vais regrouper les tâches restantes dans un plan de mutation.',
          tool_calls: [
            {
              id: 'tool-call-2',
              name: 'prepare_mutation_plan',
              arguments: { operations: [{ tool_name: 'add_task_comment', input: { ref: 'T-2', comment: 'allo ?' } }] },
            },
          ],
        },
        {
          id: 'tool-2',
          role: 'tool',
          content: JSON.stringify({
            tool_call_id: 'tool-call-2',
            tool_name: 'prepare_mutation_plan',
            result: { previews: [previewTwo], total: 1, created: 1, failed: 0, complete: true },
          }),
        },
        {
          id: 'assistant-3',
          role: 'assistant',
          content: 'Les previews restantes sont prêtes.',
        },
      ],
      conversation_usage: { input_tokens: 40, output_tokens: 20 },
    });
    vi.mocked(aiConversationsApi.getPreviews).mockResolvedValue([]);

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.loadConversation('conversation-1');
    });

    expect(result.current.messages.map((message) => message.content)).toEqual([
      'Ajoute le commentaire à toutes les tâches en retard',
      'Je continue avec les tâches restantes :',
      'Je vais regrouper les tâches restantes dans un plan de mutation.\n\nLes previews restantes sont prêtes.',
    ]);
    expect(result.current.messages[1]).toEqual(expect.objectContaining({
      previewIds: ['preview-1'],
      toolResults: [expect.objectContaining({ id: 'tool-call-1', name: 'add_task_comment' })],
    }));
    expect(result.current.messages[2]).toEqual(expect.objectContaining({
      previewIds: ['preview-2'],
      toolResults: [expect.objectContaining({ id: 'tool-call-2', name: 'prepare_mutation_plan' })],
    }));
  });

  it('joins a tool turn without text to the answer that follows instead of showing an empty block', async () => {
    vi.mocked(aiConversationsApi.getMessages).mockResolvedValue({
      messages: [
        { id: 'user-1', role: 'user', content: 'Quelles applications utilisent PostgreSQL ?' },
        {
          id: 'assistant-1',
          role: 'assistant',
          content: '',
          tool_calls: [{ id: 'tool-call-1', name: 'search_all', arguments: { query: 'PostgreSQL 16' } }],
        },
        {
          id: 'tool-1',
          role: 'tool',
          content: JSON.stringify({ tool_call_id: 'tool-call-1', tool_name: 'search_all', result: { items: [] } }),
        },
        {
          id: 'assistant-2',
          role: 'assistant',
          content: 'Je relance une recherche plus large.',
          tool_calls: [{ id: 'tool-call-2', name: 'search_all', arguments: { query: 'PostgreSQL' } }],
        },
        {
          id: 'tool-2',
          role: 'tool',
          content: JSON.stringify({ tool_call_id: 'tool-call-2', tool_name: 'search_all', result: { items: [{ ref: 'APP-36' }] } }),
        },
        { id: 'assistant-3', role: 'assistant', content: 'APP-36 utilise PostgreSQL.' },
      ],
      conversation_usage: { input_tokens: 10, output_tokens: 10 },
    });
    vi.mocked(aiConversationsApi.getPreviews).mockResolvedValue([]);

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.loadConversation('conversation-1');
    });

    // One answer: the text of the model, never hidden, with the two searches in its ribbon.
    expect(result.current.messages.map((message) => message.content)).toEqual([
      'Quelles applications utilisent PostgreSQL ?',
      'Je relance une recherche plus large.\n\nAPP-36 utilise PostgreSQL.',
    ]);
    expect(result.current.messages[1]).toEqual(expect.objectContaining({
      id: 'assistant-1',
      toolCalls: [
        expect.objectContaining({ id: 'tool-call-1' }),
        expect.objectContaining({ id: 'tool-call-2' }),
      ],
      toolResults: [
        expect.objectContaining({ id: 'tool-call-1' }),
        expect.objectContaining({ id: 'tool-call-2' }),
      ],
    }));
  });

  it('surfaces streamed error events on the assistant message', async () => {
    vi.mocked(streamChat).mockImplementation(async function* () {
      yield { type: 'conversation', id: 'conversation-1', title: 'Broken stream' };
      yield {
        type: 'error',
        message: 'Provider unavailable',
        last_usage: { input_tokens: 6, output_tokens: 2 },
        conversation_usage: { input_tokens: 9, output_tokens: 4 },
      };
    });

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.sendMessage('hello');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(false);
    });

    expect(result.current.error).toBe('Provider unavailable');
    expect(result.current.conversationUsage).toEqual({ input_tokens: 9, output_tokens: 4 });
    expect(result.current.lastRequestUsage).toEqual({ input_tokens: 6, output_tokens: 2 });
    expect(result.current.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'hello',
      }),
      expect.objectContaining({
        role: 'assistant',
        content: 'An error occurred.',
        isStreaming: false,
      }),
    ]);
  });

  it('cancels an in-flight stream without surfacing an error', async () => {
    vi.mocked(streamChat).mockImplementation(async function* ({ signal }: { signal?: AbortSignal }) {
      capturedSignal = signal ?? null;
      yield { type: 'conversation', id: 'conversation-1', title: 'Cancelable' };
      await waitForAbort(signal);
    });

    const { result } = renderHook(() => useChat());

    act(() => {
      void result.current.sendMessage('start stream');
    });

    await waitFor(() => {
      expect(result.current.isStreaming).toBe(true);
    });

    act(() => {
      result.current.cancelStream();
    });

    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true);
      expect(result.current.isStreaming).toBe(false);
    });

    expect(result.current.error).toBeNull();
    expect(result.current.messages).toEqual([
      expect.objectContaining({
        role: 'user',
        content: 'start stream',
      }),
      expect.objectContaining({
        role: 'assistant',
        content: '',
        isStreaming: false,
      }),
    ]);
  });

  it('tracks preview events and hides approval markers from visible user messages', async () => {
    vi.mocked(streamChat).mockImplementation(async function* () {
      yield { type: 'conversation', id: 'conversation-1', title: 'Approval flow' };
      yield {
        type: 'preview',
        preview_id: 'preview-1',
        tool_name: 'update_task_status',
        status: 'pending',
        target: { entity_type: 'tasks', entity_id: 'task-1', ref: 'T-1', title: 'Test task' },
        changes: { status: { from: 'open', to: 'done' } },
        requires_confirmation: true,
        actions: ['approve', 'reject'],
        summary: 'Update T-1 status from open to done.',
        error_message: null,
        conversation_id: 'conversation-1',
        created_at: '2026-03-24T10:00:00.000Z',
        expires_at: '2026-03-24T10:10:00.000Z',
        approved_at: null,
        rejected_at: null,
        executed_at: null,
      };
      yield {
        type: 'done',
        usage: { input_tokens: 1, output_tokens: 1 },
        last_usage: { input_tokens: 1, output_tokens: 1 },
        conversation_usage: { input_tokens: 11, output_tokens: 6 },
      };
    });

    const { result } = renderHook(() => useChat());

    await act(async () => {
      await result.current.sendMessage('[APPROVE:11111111-1111-4111-8111-111111111111]');
    });

    expect(result.current.messages[0]).toEqual(
      expect.objectContaining({
        role: 'user',
        hidden: true,
      }),
    );
    expect(result.current.previews).toEqual([
      expect.objectContaining({
        preview_id: 'preview-1',
        status: 'pending',
      }),
    ]);
    expect(result.current.conversationUsage).toEqual({ input_tokens: 11, output_tokens: 6 });
    expect(result.current.lastRequestUsage).toEqual({ input_tokens: 1, output_tokens: 1 });
  });
});
