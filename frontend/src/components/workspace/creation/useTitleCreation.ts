import React from 'react';

type Options<C> = {
  /** The page shows a new record (`id === 'new'`). */
  isCreate: boolean;
  /** Shown under the empty title when Create is clicked. */
  requiredMessage: string;
  /** The defaults the create needs have loaded (a classification, a currency): a committed title waits for them. */
  ready?: boolean;
  /** Writes the record from its title; throws on a refusal. The answer carries the creation token. */
  post: (name: string) => Promise<C & { creation_token: string }>;
  /**
   * The record is written: the page starts its creation (`useRecordCreation`) and opens it. `finish`
   * is true when Create was clicked meanwhile: the page then closes the record, kept, instead.
   */
  onCreated: (created: C, token: string, finish: boolean) => void | Promise<void>;
  /** The refusal of the title, shown under it. */
  errorMessage: (err: unknown) => string;
  /** Before each write: clears the page's own error. */
  onStart?: () => void;
};

/**
 * The new page of a record created at its title (`CreationActions`): the title is the only field,
 * and its commit (Enter, its blur) writes the record, once `ready`. `commit(name)` goes to the
 * shell's `onTitleSave`; `create()` is Create on the new page: with a title typed, it lets the
 * commit under way create the record, then close it instead of opening it; with an empty title,
 * the title shows `requiredMessage` (a refusal already under it stays) and gets the focus.
 *
 * The hook holds the title's error (`titleError`, `setTitleError` for a page's own message such as
 * a place to give first) and its focus requests (`focusRequest`); `pending` is true while a
 * committed title waits for `ready`.
 */
export default function useTitleCreation<C>({ isCreate, requiredMessage, ready = true, post, onCreated, errorMessage, onStart }: Options<C>) {
  const [titleError, setTitleError] = React.useState<string | null>(null);
  const [focusRequest, setFocusRequest] = React.useState(0);
  const [pendingName, setPendingName] = React.useState<string | null>(null);
  const latest = React.useRef({ ready, post, onCreated, errorMessage, onStart });
  latest.current = { ready, post, onCreated, errorMessage, onStart };
  // The title is committed (a write is coming or under way); Create was clicked meanwhile.
  const sent = React.useRef(false);
  const finishAfter = React.useRef(false);
  const running = React.useRef(false);

  const write = React.useCallback(async (name: string) => {
    if (running.current) return;
    running.current = true;
    setTitleError(null);
    latest.current.onStart?.();
    try {
      const { creation_token: token, ...created } = await latest.current.post(name);
      const finish = sent.current && finishAfter.current;
      sent.current = false;
      finishAfter.current = false;
      await latest.current.onCreated(created as C, token, finish);
    } catch (err) {
      sent.current = false;
      finishAfter.current = false;
      setTitleError(latest.current.errorMessage(err));
    } finally {
      running.current = false;
    }
  }, []);

  const commit = React.useCallback((name: string) => {
    sent.current = true;
    setTitleError(null);
    if (latest.current.ready) void write(name);
    else setPendingName(name);
  }, [write]);

  React.useEffect(() => {
    if (!isCreate || pendingName === null || !ready) return;
    setPendingName(null);
    void write(pendingName);
  }, [isCreate, pendingName, ready, write]);

  const create = React.useCallback(() => {
    if (sent.current) {
      finishAfter.current = true;
      return;
    }
    setTitleError((current) => current || requiredMessage);
    setFocusRequest((n) => n + 1);
  }, [requiredMessage]);

  return { titleError, setTitleError, focusRequest, pending: pendingName !== null, commit, create };
}
