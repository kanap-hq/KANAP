import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../api';
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
