import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { LinkDraft, LinksAndFilesLink } from './LinksAndFilesSection';

/** The label of a web link: its name, or the address when it has none. */
export function webLinkLabel(link: Pick<LinksAndFilesLink, 'name' | 'url'>): string {
  const name = String(link.name ?? '').trim();
  return name || link.url;
}

/** The draft that creates the same link again. */
export function webLinkDraft(link: Pick<LinksAndFilesLink, 'name' | 'url'>): LinkDraft {
  const name = String(link.name ?? '').trim();
  return { name: name || null, url: link.url };
}

type UndoFeedback = {
  undo: (message: string, onUndo: () => void | Promise<void>) => void;
};

type RemoveWebLinkOptions<T> = {
  queryClient: QueryClient;
  queryKey: QueryKey;
  /** The cached value without this link. */
  without: (cached: T) => T;
  /** Writes the removal. Throws when the server refuses. */
  commit: () => Promise<unknown>;
  /** Reloads the list after the removal has landed. */
  refresh?: () => Promise<void> | void;
  /** Creates the link again with the same name and URL. */
  restore: () => Promise<void>;
  message: string;
  feedback: UndoFeedback;
  onError: (error: unknown) => void;
};

/**
 * Drops a web link at once and offers to create it again with the same name and URL.
 * The row leaves the list immediately. A refused removal puts the list back and shows no message.
 */
export async function removeWebLinkWithUndo<T>(options: RemoveWebLinkOptions<T>): Promise<void> {
  const previous = options.queryClient.getQueryData<T>(options.queryKey);
  if (previous !== undefined) {
    options.queryClient.setQueryData(options.queryKey, options.without(previous));
  }
  try {
    await options.commit();
  } catch (error) {
    if (previous !== undefined) options.queryClient.setQueryData(options.queryKey, previous);
    options.onError(error);
    return;
  }
  try {
    await options.refresh?.();
  } catch (error) {
    options.onError(error);
  }
  options.feedback.undo(options.message, async () => {
    try {
      await options.restore();
    } catch (error) {
      options.onError(error);
    }
  });
}
