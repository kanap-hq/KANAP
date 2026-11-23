import React from 'react';
import { clearCreationFieldFocus, endCreationWrite, noteCreationWrite } from './creationFieldFocus';
import { useCreationPresence } from './creationDeparture';

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
   * The record is written while the person is on the new page: the page starts its creation
   * (`useRecordCreation`) and opens it. A page that waits for more before it opens the record checks
   * `stillHere()` first: false once the person has left.
   */
  onCreated: (created: C, token: string, stillHere: () => boolean) => void | Promise<void>;
  /** The refusal of the title, shown under it. */
  errorMessage: (err: unknown) => string;
  /** Before each write: clears the page's own error. */
  onStart?: () => void;
};

/**
 * The new page of a record created at its title (`CreationActions`): applications, business
 * processes, incidents, documents, tasks, projects and requests (every other family is written
 * from a draft, `useDraftCreation`); leaving the page never writes the record. The title is the
 * only field.
 * The name is given by Enter, Tab or Create, and nothing else: the record is written, once `ready`,
 * and opens. Leaving the title (a click elsewhere, Cancel, a link, the menu, another window) writes
 * nothing, and the name stays in the field. `commit(name)` goes to the shell's `onTitleSave` (Enter
 * and Tab); `onTitleDraftChange` follows the typing, so that `create()`, Create on the new page,
 * writes the name typed (a pressed button may leave the focus in the title, as in Safari). With an
 * empty title, Create shows `requiredMessage` under it (a refusal already there stays) and gives it
 * the focus. Done on the created record is the page's own (`useRecordCreation`).
 *
 * A write that ends after the person left the page brings nobody back: `onCreated` is not called,
 * and the record is kept.
 *
 * The hook holds the title's error (`titleError`, `setTitleError` for a page's own message such as
 * a place to give first) and its focus requests (`focusRequest`); `pending` is true while a
 * committed title waits for `ready`; `writing` while the record is written (`CreationActions`).
 */
export default function useTitleCreation<C>({ isCreate, requiredMessage, ready = true, post, onCreated, errorMessage, onStart }: Options<C>) {
  const [titleError, setTitleError] = React.useState<string | null>(null);
  const [focusRequest, setFocusRequest] = React.useState(0);
  const [pendingName, setPendingName] = React.useState<string | null>(null);
  const [writing, setWriting] = React.useState(false);
  const latest = React.useRef({ ready, post, onCreated, errorMessage, onStart });
  latest.current = { ready, post, onCreated, errorMessage, onStart };
  const stillHere = useCreationPresence(isCreate);
  // The title is committed: a write is coming, under way, or done (a click that lands as the page
  // moves to the record still finds it). A new page starts again.
  const sent = React.useRef(false);
  // The name in the title, as typed.
  const typed = React.useRef('');
  React.useEffect(() => {
    if (!isCreate) return;
    sent.current = false;
    typed.current = '';
  }, [isCreate]);
  const running = React.useRef(false);

  const write = React.useCallback(async (name: string) => {
    if (running.current) return;
    running.current = true;
    setWriting(true);
    setTitleError(null);
    latest.current.onStart?.();
    try {
      const { creation_token: token, ...created } = await latest.current.post(name);
      if (!stillHere()) return;
      await latest.current.onCreated(created as C, token, stillHere);
    } catch (err) {
      sent.current = false;
      setTitleError(latest.current.errorMessage(err));
    } finally {
      endCreationWrite();
      running.current = false;
      setWriting(false);
    }
  }, [stillHere]);

  const commit = React.useCallback((name: string) => {
    sent.current = true;
    // From the gesture on, what is typed waits for the record's description, defaults or not.
    noteCreationWrite();
    setTitleError(null);
    if (latest.current.ready) void write(name);
    else setPendingName(name);
  }, [write]);

  React.useEffect(() => {
    if (!isCreate || pendingName === null || !ready) return;
    setPendingName(null);
    void write(pendingName);
  }, [isCreate, pendingName, ready, write]);

  const onTitleDraftChange = React.useCallback((draft: string) => {
    typed.current = draft;
    setTitleError(null);
  }, []);

  const create = React.useCallback(() => {
    if (sent.current) return;
    const name = typed.current.trim();
    if (name) {
      commit(name);
      return;
    }
    // Nothing is created: the cursor stays in the title.
    clearCreationFieldFocus();
    setTitleError((current) => current || requiredMessage);
    setFocusRequest((n) => n + 1);
  }, [commit, requiredMessage]);

  return { titleError, setTitleError, focusRequest, pending: pendingName !== null, writing, commit, create, onTitleDraftChange };
}
