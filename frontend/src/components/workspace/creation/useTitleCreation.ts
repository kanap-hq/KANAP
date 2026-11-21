import React from 'react';
import { clearCreationFieldFocus } from './creationFieldFocus';

type Options<C> = {
  /** The page shows a new record (`id === 'new'`). */
  isCreate: boolean;
  /** Shown under the empty title when Create is clicked. */
  requiredMessage: string;
  /** The defaults the create needs have loaded (a classification, a currency): a committed title waits for them. */
  ready?: boolean;
  /** Writes the record from its title; throws on a refusal. The answer carries the creation token. */
  post: (name: string) => Promise<C & { creation_token: string }>;
  /** The record is written: the page starts its creation (`useRecordCreation`) and opens it. */
  onCreated: (created: C, token: string) => void | Promise<void>;
  /** The refusal of the title, shown under it. */
  errorMessage: (err: unknown) => string;
  /** Before each write: clears the page's own error. */
  onStart?: () => void;
};

/**
 * The new page of a record created at its title (`CreationActions`): the title is the only field,
 * and its commit (Enter, Tab, its blur) writes the record, once `ready`, and opens it. `commit(name)`
 * goes to the shell's `onTitleSave`; `create()` is Create on the new page: with a title typed, the
 * click has blurred the title, whose commit writes and opens the record as Enter does, so Create
 * adds nothing; with an empty title, the title shows `requiredMessage` (a refusal already under it
 * stays) and gets the focus. Done on the created record is the page's own (`useRecordCreation`).
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
  // The title is committed: a write is coming, under way, or done (a click that lands as the page
  // moves to the record still finds it). A new page starts again.
  const sent = React.useRef(false);
  React.useEffect(() => {
    if (isCreate) sent.current = false;
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
      await latest.current.onCreated(created as C, token);
    } catch (err) {
      sent.current = false;
      setTitleError(latest.current.errorMessage(err));
    } finally {
      running.current = false;
      setWriting(false);
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
    if (sent.current) return;
    // Nothing is created: the cursor the press of Create armed stays in the title.
    clearCreationFieldFocus();
    setTitleError((current) => current || requiredMessage);
    setFocusRequest((n) => n + 1);
  }, [requiredMessage]);

  return { titleError, setTitleError, focusRequest, pending: pendingName !== null, writing, commit, create };
}
