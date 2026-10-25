import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api';
import { setAccessToken } from '../auth/accessTokenStore';
import { AUTOSAVE_RETRY_DELAYS_MS } from '../hooks/useAutosave';
import { releaseLockKeepaliveUrl } from '../lib/releaseLockKeepalive';
import IntegratedDocumentEditor, { type IntegratedDocumentEditorHandle } from './IntegratedDocumentEditor';
import { createAppTheme } from '../config/ThemeContext';

vi.mock('../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => false, profile: { id: 'user-1' } }),
}));

vi.mock('../tenant/TenantContext', () => ({
  useTenant: () => ({ tenantSlug: 'acme' }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('./MarkdownEditor', () => ({
  default: ({ value, onChange, disabled }: any) => (
    <textarea
      aria-label="markdown-editor"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock('./MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

vi.mock('./ExportButton', () => ({ default: () => null }));
vi.mock('./ImportButton', () => ({ default: () => null }));

const REVIEW_ENDPOINT = '/incidents/inc-1/integrated-documents/review';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function documentPayload(content: string, revision = 1) {
  return {
    data: {
      id: 'doc-1',
      item_number: 12,
      item_ref: 'DOC-12',
      content_markdown: content,
      revision,
      edit_lock: null,
    },
  };
}

const theme = createAppTheme('light');

type EditorOptions = { autosaveDelayMs?: number; entityId?: string; disabled?: boolean };

function editorTree(
  ref: React.Ref<IntegratedDocumentEditorHandle>,
  queryClient: QueryClient,
  options?: EditorOptions,
) {
  return (
    <ThemeProvider theme={theme}>
      <QueryClientProvider client={queryClient}>
        <IntegratedDocumentEditor
          ref={ref}
          entityType="incidents"
          entityId={options?.entityId ?? 'inc-1'}
          slotKey="review"
          label="Incident review"
          hideHeaderLabel
          showManagedDocChip={false}
          showDocumentControls={false}
          editModeBehavior="auto"
          autosaveEnabled
          autosaveDelayMs={options?.autosaveDelayMs ?? 5}
          disabled={options?.disabled ?? false}
          surface
          hideToolbarUntilFocus
          minRows={10}
        />
      </QueryClientProvider>
    </ThemeProvider>
  );
}

async function renderEditor(options?: EditorOptions) {
  const ref = React.createRef<IntegratedDocumentEditorHandle>();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(editorTree(ref, queryClient, options));
  await screen.findByLabelText('Incident review');
  const rerender = (next?: EditorOptions) => view.rerender(editorTree(ref, queryClient, next));
  return { ref, view, rerender };
}

/** Click the read-only preview: the editor acquires the lock and switches to edit mode. */
async function startEditing() {
  fireEvent.click(screen.getByLabelText('Incident review'));
  return screen.findByLabelText('markdown-editor');
}

describe('IntegratedDocumentEditor — incidents:review', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api.get).mockResolvedValue(documentPayload('## Description', 3));
    vi.mocked(api.post).mockResolvedValue({ data: { lock_token: 'lock-1', expires_at: null } } as any);
    // The API echoes the stored document, like the real endpoint.
    vi.mocked(api.patch).mockImplementation(async (_url: string, body: any) => (
      documentPayload(String(body?.content_markdown ?? ''), 4) as any
    ));
    vi.mocked(api.delete).mockResolvedValue({ data: null } as any);
  });

  it('reads and locks the incident review through the /incidents endpoints', async () => {
    await renderEditor();
    expect(api.get).toHaveBeenCalledWith(REVIEW_ENDPOINT);

    await startEditing();
    expect(api.post).toHaveBeenCalledWith(`${REVIEW_ENDPOINT}/locks`);
  });

  it('releases the lock on pagehide so a reload does not keep it', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    setAccessToken('access-1', Date.now() + 60_000);
    try {
      const { view } = await renderEditor({ autosaveDelayMs: 60_000 });
      await startEditing();
      expect(api.delete).not.toHaveBeenCalled();

      await act(async () => {
        window.dispatchEvent(new Event('pagehide'));
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(releaseLockKeepaliveUrl(`${REVIEW_ENDPOINT}/locks`));
      expect(init).toMatchObject({
        method: 'DELETE',
        keepalive: true,
        credentials: 'include',
        headers: {
          'X-Lock-Token': 'lock-1',
          Authorization: 'Bearer access-1',
        },
      });
      // The page is no longer editing, and the spent token is not released again.
      expect(screen.queryByLabelText('markdown-editor')).toBeNull();
      expect(api.delete).not.toHaveBeenCalled();

      window.dispatchEvent(new Event('pagehide'));
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // The same user comes back and takes a fresh lock. Leaving then releases that one.
      await startEditing();
      expect(api.post).toHaveBeenCalledTimes(2);
      view.unmount();
      expect(api.delete).toHaveBeenCalledTimes(1);
    } finally {
      setAccessToken(null);
      vi.unstubAllGlobals();
    }
  });

  it('does not release on pagehide when the description is not being edited', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    try {
      await renderEditor();
      window.dispatchEvent(new Event('pagehide'));
      expect(fetchMock).not.toHaveBeenCalled();
      expect(api.delete).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sends the keepalive release on pagehide when the axios release is still in flight', async () => {
    vi.mocked(api.delete).mockReturnValue(new Promise(() => {}) as any);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { rerender } = await renderEditor({ autosaveDelayMs: 60_000 });
      await startEditing();
      await act(async () => {
        rerender({ autosaveDelayMs: 60_000, disabled: true });
      });
      await waitFor(() => expect(api.delete).toHaveBeenCalledWith(
        `${REVIEW_ENDPOINT}/locks`,
        { headers: { 'X-Lock-Token': 'lock-1' } },
      ));

      await act(async () => {
        window.dispatchEvent(new Event('pagehide'));
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][1]).toMatchObject({
        method: 'DELETE',
        keepalive: true,
        headers: { 'X-Lock-Token': 'lock-1' },
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('save() waits for an autosave already in flight and does not save twice', async () => {
    const { ref } = await renderEditor();
    const editor = await startEditing();

    const pending = deferred<any>();
    vi.mocked(api.patch).mockReturnValueOnce(pending.promise as any);
    fireEvent.change(editor, { target: { value: '## Description\nRouter down' } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));

    let savePromise!: Promise<boolean>;
    await act(async () => {
      savePromise = ref.current!.save();
    });
    // Still in flight: nothing else may be sent while it runs.
    expect(api.patch).toHaveBeenCalledTimes(1);

    await act(async () => {
      pending.resolve(documentPayload('## Description\nRouter down', 4));
      await savePromise;
    });

    await expect(savePromise).resolves.toBe(true);
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({ save_mode: 'autosave' });
  });

  it('keeps text typed while a save is running and persists it with the next save', async () => {
    const { ref } = await renderEditor({ autosaveDelayMs: 60_000 });
    const editor = await startEditing();

    fireEvent.change(editor, { target: { value: 'first' } });
    const pending = deferred<any>();
    vi.mocked(api.patch).mockReturnValueOnce(pending.promise as any);

    let firstSave!: Promise<boolean>;
    await act(async () => {
      firstSave = ref.current!.save();
    });
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));

    // The user keeps typing while the request is in flight.
    fireEvent.change(editor, { target: { value: 'first and second' } });

    await act(async () => {
      pending.resolve(documentPayload('first', 4));
      await firstSave;
    });

    // The server echo of the older text must not replace the newer draft.
    expect((screen.getByLabelText('markdown-editor') as HTMLTextAreaElement).value).toBe('first and second');
    expect(ref.current!.isDirty()).toBe(true);

    await act(async () => {
      await ref.current!.save();
    });
    expect(api.patch).toHaveBeenCalledTimes(2);
    expect(vi.mocked(api.patch).mock.calls[1][1]).toMatchObject({
      content_markdown: 'first and second',
      save_mode: 'manual',
    });
  });

  it('reports a failed save so the caller can abort its transition', async () => {
    const { ref } = await renderEditor({ autosaveDelayMs: 60_000 });
    const editor = await startEditing();
    fireEvent.change(editor, { target: { value: 'unsaved work' } });

    vi.mocked(api.patch).mockRejectedValueOnce(Object.assign(new Error('offline'), { response: undefined }));

    let result: boolean | undefined;
    await act(async () => {
      result = await ref.current!.save();
    });

    expect(result).toBe(false);
    expect((screen.getByLabelText('markdown-editor') as HTMLTextAreaElement).value).toBe('unsaved work');
    expect(ref.current!.isDirty()).toBe(true);
  });

  it('says what to do when an autosave is refused for a document over the size limit', async () => {
    await renderEditor({ autosaveDelayMs: 5 });
    const editor = await startEditing();
    vi.mocked(api.patch).mockRejectedValueOnce(Object.assign(new Error('Request failed'), {
      response: {
        status: 400,
        data: { code: 'MARKDOWN_TOO_LARGE', message: 'content_markdown is too long: 250 KB of text, the limit is 200 KB.' },
      },
    }));

    fireEvent.change(editor, { target: { value: 'a long document, one more line' } });

    expect(await screen.findByText('errors:MARKDOWN_TOO_LARGE_DOCUMENT')).toBeInTheDocument();
    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(api.patch).mock.calls[0][1]).toMatchObject({ save_mode: 'autosave' });
    // The text stays in the editor, still to be saved.
    expect((screen.getByLabelText('markdown-editor') as HTMLTextAreaElement).value).toBe('a long document, one more line');
  });

  it('sends an autosave again when the server is busy with other texts, without an error', async () => {
    await renderEditor({ autosaveDelayMs: 5 });
    const editor = await startEditing();
    vi.mocked(api.patch).mockRejectedValueOnce(Object.assign(new Error('Request failed'), {
      response: {
        status: 503,
        headers: { 'retry-after': '1' },
        data: { code: 'MARKDOWN_BUSY', message: 'The server is busy processing other texts. Try again in a moment.' },
      },
    }));

    // The second attempt stays in flight until the test lets it answer.
    let answer: (value: unknown) => void = () => undefined;
    vi.mocked(api.patch).mockImplementationOnce((_url: string, body: any) => new Promise((resolve) => {
      answer = () => resolve(documentPayload(String(body?.content_markdown ?? ''), 4) as any);
    }));

    fireEvent.change(editor, { target: { value: 'typed while the server is busy' } });

    // Sent again after the server's Retry-After (1 s).
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(vi.mocked(api.patch).mock.calls[1][1]).toMatchObject({ content_markdown: 'typed while the server is busy', save_mode: 'autosave' });
    // Sent again without an error message in between.
    expect(screen.queryByText('errors:MARKDOWN_BUSY')).not.toBeInTheDocument();
    expect(screen.queryByText('errors:notSavedYet')).not.toBeInTheDocument();
    await act(async () => {
      answer(undefined);
    });
    expect((screen.getByLabelText('markdown-editor') as HTMLTextAreaElement).value).toBe('typed while the server is busy');
  });

  it('waits for a new modification after a document refused as too complex', async () => {
    await renderEditor({ autosaveDelayMs: 5 });
    const editor = await startEditing();
    vi.mocked(api.patch).mockRejectedValueOnce(Object.assign(new Error('Request failed'), {
      response: {
        status: 400,
        data: { code: 'MARKDOWN_TOO_COMPLEX', message: 'content_markdown is too complex to process as Markdown.' },
      },
    }));

    fireEvent.change(editor, { target: { value: 'a pasted log with open _marks' } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    // Many autosave delays later, the refused text has not been sent again.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    expect(api.patch).toHaveBeenCalledTimes(1);

    fireEvent.change(editor, { target: { value: 'a pasted log in a code block' } });
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.patch).mock.calls[1][1]).toMatchObject({ content_markdown: 'a pasted log in a code block', save_mode: 'autosave' });
  });

  it('sends a busy autosave again a few times, then waits for a new modification', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderEditor({ autosaveDelayMs: 5 });
      const editor = await startEditing();
      vi.mocked(api.patch).mockRejectedValue(Object.assign(new Error('Request failed'), {
        response: {
          status: 503,
          headers: { 'retry-after': '1' },
          data: { code: 'MARKDOWN_BUSY', message: 'The server is busy with other texts.' },
        },
      }));

      fireEvent.change(editor, { target: { value: 'typed while the server stays busy' } });
      for (let second = 0; second < 15; second += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1000);
        });
      }
      // The first try and one retry per delay (1, 2 and 4 s), then the message and no more tries.
      expect(api.patch).toHaveBeenCalledTimes(1 + AUTOSAVE_RETRY_DELAYS_MS.length);
      expect(screen.getByText('errors:notSavedYet')).toBeInTheDocument();

      vi.mocked(api.patch).mockImplementation(async (_url: string, body: any) => (
        documentPayload(String(body?.content_markdown ?? ''), 4) as any
      ));
      fireEvent.change(editor, { target: { value: 'typed once the server is free' } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
      expect(api.patch).toHaveBeenCalledTimes(2 + AUTOSAVE_RETRY_DELAYS_MS.length);
      expect(vi.mocked(api.patch).mock.calls[1 + AUTOSAVE_RETRY_DELAYS_MS.length][1]).toMatchObject({
        content_markdown: 'typed once the server is free',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends an autosave again after a network failure', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await renderEditor({ autosaveDelayMs: 5 });
      const editor = await startEditing();
      vi.mocked(api.patch).mockRejectedValueOnce(Object.assign(new Error('Network Error'), { isAxiosError: true, code: 'ERR_NETWORK' }));

      fireEvent.change(editor, { target: { value: 'typed while offline' } });
      for (let step = 0; step < 4; step += 1) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => {
          await vi.advanceTimersByTimeAsync(500);
        });
      }
      expect(api.patch).toHaveBeenCalledTimes(2);
      expect(vi.mocked(api.patch).mock.calls[1][1]).toMatchObject({ content_markdown: 'typed while offline', save_mode: 'autosave' });
      expect(screen.queryByText('errors:notSavedYet')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaves edit mode and releases the lock when editing is revoked mid-session', async () => {
    // The host can revoke editing under the user's feet: closing the incident in
    // another tab freezes its review. Staying in edit mode would keep the lock
    // held until it expires, blocking every other editor.
    const { rerender } = await renderEditor({ autosaveDelayMs: 60_000 });
    await startEditing();
    expect(api.post).toHaveBeenCalledWith(`${REVIEW_ENDPOINT}/locks`);
    expect(api.delete).not.toHaveBeenCalled();

    await act(async () => {
      rerender({ autosaveDelayMs: 60_000, disabled: true });
    });

    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(
      `${REVIEW_ENDPOINT}/locks`,
      { headers: { 'X-Lock-Token': 'lock-1' } },
    ));
    expect(screen.queryByLabelText('markdown-editor')).toBeNull();
  });

  it('opens the next record read only, with its own text, and edits it with its own lock', async () => {
    // Previous / next in a record header keeps the editor mounted and only changes the record.
    // The editor used to stay in edit mode with the first record's text and no lock: the second
    // record's description could no longer be opened.
    const OTHER_ENDPOINT = '/incidents/inc-2/integrated-documents/review';
    vi.mocked(api.get).mockImplementation(async (url: string) => (
      url === OTHER_ENDPOINT ? documentPayload('Second record', 7) : documentPayload('First record', 3)
    ) as any);
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: { lock_token: 'lock-1', expires_at: null } } as any)
      .mockResolvedValueOnce({ data: { lock_token: 'lock-2', expires_at: null } } as any);
    const { rerender } = await renderEditor({ autosaveDelayMs: 60_000 });
    await startEditing();

    await act(async () => {
      rerender({ autosaveDelayMs: 60_000, entityId: 'inc-2' });
    });
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith(
      `${REVIEW_ENDPOINT}/locks`,
      { headers: { 'X-Lock-Token': 'lock-1' } },
    ));
    expect(await screen.findByText('Second record')).toBeInTheDocument();
    expect(screen.queryByLabelText('markdown-editor')).toBeNull();

    const editor = await startEditing();
    expect(api.post).toHaveBeenLastCalledWith(`${OTHER_ENDPOINT}/locks`);
    expect(editor).not.toBeDisabled();
    expect(editor).toHaveValue('Second record');
  });

  it('does not save again when nothing changed since the last save', async () => {
    const { ref } = await renderEditor({ autosaveDelayMs: 60_000 });
    const editor = await startEditing();
    fireEvent.change(editor, { target: { value: 'once' } });

    await act(async () => {
      await ref.current!.save();
    });
    expect(api.patch).toHaveBeenCalledTimes(1);

    await act(async () => {
      await ref.current!.save();
    });
    expect(api.patch).toHaveBeenCalledTimes(1);
  });
});
