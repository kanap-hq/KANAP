import React from 'react';
import { useNavigate } from 'react-router-dom';
import useCreationReturn from './useCreationReturn';
import useRecordCreation from './useRecordCreation';
import useMissingMarks from './useMissingMarks';
import { focusFirstMissingField } from './creationFieldFocus';
import { useCreationPresence, watchCreationFocus } from './creationDeparture';

/**
 * The record the draft created: its uuid, the token of its create route, and its page. `reference`
 * (`COMP-5`) when `path` may name the record by it: the page then finds the creation by either.
 */
export type DraftCreated = { id: string; token: string; path: string; reference?: string | null };

type Options = {
  /** The page shows a new record's draft (`id === 'new'`). */
  isCreate: boolean;
  /** The record family, as the API routes name it (`suppliers`). */
  family: string;
  /** The API base of the record (`/suppliers`): `GET|DELETE <apiBase>/:id/creation`. */
  apiBase: string;
  /** The record's uuid on its own page, null on the draft or while it loads. */
  recordId: string | null;
  /** Where to go when no starting address was kept: the list, with its context. */
  listPath: string;
  /** Where the creation started, when the page knows it better than the link state (`?returnTo=`). */
  returnTo?: string | null;
  /** The record as Cancel's confirmation names it ("The supplier"). */
  recordLabel: string;
  /** Query keys (first element prefixes) to mark stale once the record is cancelled (its lists). */
  queryKeyPrefixes?: string[];
  /** The draft has its title and every field it needs: the record may be created. Shows nothing. */
  ready: () => boolean;
  /** Writes the draft. Null when refused: the page shows why (under the title or the field). */
  post: () => Promise<DraftCreated | null>;
  /**
   * The required fields the screen sees empty now, by key (the title aside): the draft's, then the
   * created record's. Create marks them (`marked`).
   */
  missing?: () => string[];
  /** The value a field holds now, by key: its mark goes once it changes (`useMissingMarks`). */
  valueOf?: (key: string) => unknown;
  /** A refusal of Cancel, as for a delete. */
  onError?: (message: string) => void;
};

/**
 * A new record's draft created as soon as it has its title and its required fields (reference
 * data and contracts, lot V2; interfaces, lot V3): `attempt()` (after the title commits, after
 * each change of the draft) writes it once `ready()`, and the page moves to the record, every tab
 * open, with Done and Cancel (`useRecordCreation`).
 *
 * A field is given by a choice in a list, by Enter or Tab, by the passage to another field of the
 * page, or by Create. Leaving gives nothing (`watchCreationFocus`): a field committed as the focus
 * leaves for a button, a link, the menu, another window or nowhere stays in the draft, unwritten,
 * and the next field given writes it. Cancel leaves without writing. A write that ends after the
 * person left the page brings nobody back: the record, complete, is kept.
 *
 * `create(requireTitle)` is the primary pill (`CreationActions`). On the draft it is Create: the
 * title is checked (`requireTitle`, which shows its own message and takes the focus), the required
 * fields `missing()` names are marked on their label (`marked`, until each one gets a value) and the
 * cursor goes to the first one; a complete draft is written and opens as with `attempt()`, the
 * person stays on it. On the record it created it is Done: a required field the screen sees
 * emptied is marked the same way and the person stays; otherwise the creation ends and the page
 * goes back where it started (`finishCreation`).
 */
export default function useDraftCreation({ isCreate, ready, post, missing, valueOf, returnTo: knownReturn, ...record }: Options) {
  const navigate = useNavigate();
  const startedFrom = useCreationReturn(record.listPath);
  const returnTo = knownReturn || startedFrom;
  const creation = useRecordCreation({ ...record, recordId: isCreate ? null : record.recordId });
  const latest = React.useRef({ ready, post, missing, returnTo, startCreation: creation.startCreation });
  latest.current = { ready, post, missing, returnTo, startCreation: creation.startCreation };
  const marks = useMissingMarks({
    recordKey: isCreate ? 'new' : record.recordId,
    missingNow: () => missing?.() ?? [],
    valueOf: (key) => valueOf?.(key),
  });
  const running = React.useRef(false);
  // The draft is written: the page is moving to the record, nothing more is sent.
  const written = React.useRef(false);
  const [writing, setWriting] = React.useState(false);
  const stillHere = useCreationPresence(isCreate);
  // The focus last left a field by a departure: what it committed on the way is not written.
  const away = React.useRef(false);
  // A complete draft a departure kept from being written: the next field given writes it.
  const held = React.useRef(false);
  // The page comes back to a new record without being unmounted (the same route, as Done or
  // Cancel going back to a new address): its draft starts again, unwritten.
  React.useEffect(() => {
    if (!isCreate) return;
    written.current = false;
    away.current = false;
    held.current = false;
  }, [isCreate]);

  const write = React.useCallback(async () => {
    if (written.current || running.current) return;
    held.current = false;
    running.current = true;
    setWriting(true);
    try {
      const created = await latest.current.post();
      if (!created) return;
      written.current = true;
      // The person left while it was written: the record is kept, and nobody is brought back.
      if (!stillHere()) return;
      latest.current.startCreation({ recordId: created.id, token: created.token, returnTo: latest.current.returnTo, reference: created.reference });
      navigate(created.path, { replace: true });
    } finally {
      running.current = false;
      setWriting(false);
    }
  }, [navigate, stillHere]);

  const attempt = React.useCallback(() => {
    if (!isCreate || !latest.current.ready()) return;
    if (away.current) held.current = true;
    else void write();
  }, [isCreate, write]);
  const attemptRef = React.useRef(attempt);
  attemptRef.current = attempt;

  React.useEffect(() => {
    if (!isCreate) return undefined;
    return watchCreationFocus({
      onExit: (passage) => {
        away.current = !passage;
        // The field committing now is seen once the page has rendered it.
        if (passage && held.current) window.setTimeout(() => attemptRef.current(), 0);
      },
      onReturn: () => {
        away.current = false;
      },
    });
  }, [isCreate]);

  const { beingCreated, finishCreation } = creation;
  const { mark } = marks;
  const create = React.useCallback((requireTitle?: () => unknown) => {
    if (!isCreate && !beingCreated) return;
    const titled = !isCreate || !requireTitle || !!requireTitle();
    const fields = latest.current.missing?.() ?? [];
    mark(fields);
    // An empty title has the cursor: it comes first on the screen.
    if (!titled) return;
    if (fields.length > 0) {
      focusFirstMissingField();
      return;
    }
    if (beingCreated) finishCreation();
    else if (latest.current.ready()) void write();
  }, [beingCreated, finishCreation, isCreate, mark, write]);

  return {
    beingCreated: creation.beingCreated,
    /** The draft is being written (`CreationActions`' `writing`: Cancel and Escape wait). */
    writing,
    cancelling: creation.cancelling,
    /** The required fields Create found missing: their `PropertyRow` says `missing`. */
    marked: marks.marked,
    attempt,
    create,
    finishCreation: creation.finishCreation,
    cancelCreation: creation.cancelCreation,
  };
}
