import React from 'react';
import { useNavigate } from 'react-router-dom';
import useCreationReturn from './useCreationReturn';
import useRecordCreation from './useRecordCreation';

/** The record the draft created: its uuid, the token of its create route, and its page. */
export type DraftCreated = { id: string; token: string; path: string };

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
  /** The record as Cancel's confirmation names it ("The supplier"). */
  recordLabel: string;
  /** Query keys (first element prefixes) to mark stale once the record is cancelled (its lists). */
  queryKeyPrefixes?: string[];
  /** The draft has its title and every field it needs: the record may be created. Shows nothing. */
  ready: () => boolean;
  /** Writes the draft. Null when refused: the page shows why (under the title or the field). */
  post: () => Promise<DraftCreated | null>;
  /** A refusal of Cancel, as for a delete. */
  onError?: (message: string) => void;
};

/**
 * A new record's draft created as soon as it has its title and its required fields (reference
 * data and contracts, lot V2; interfaces, lot V3): `attempt()` (after the title commits, after
 * each change of the draft) writes it once `ready()`, and the page moves to the record, every tab
 * open, with Create and Cancel (`useRecordCreation`). `createAndLeave()` is Create on a complete
 * draft: it writes the draft, or waits for the write under way, and goes back where the creation
 * started, the record kept.
 */
export default function useDraftCreation({ isCreate, ready, post, ...record }: Options) {
  const navigate = useNavigate();
  const returnTo = useCreationReturn(record.listPath);
  const creation = useRecordCreation({ ...record, recordId: isCreate ? null : record.recordId });
  const latest = React.useRef({ ready, post, returnTo, startCreation: creation.startCreation });
  latest.current = { ready, post, returnTo, startCreation: creation.startCreation };
  const running = React.useRef(false);
  const finishAfter = React.useRef(false);
  const [writing, setWriting] = React.useState(false);

  const write = React.useCallback(async (finish: boolean) => {
    if (running.current) {
      if (finish) finishAfter.current = true;
      return;
    }
    running.current = true;
    finishAfter.current = finish;
    setWriting(true);
    try {
      const created = await latest.current.post();
      if (!created) return;
      if (finishAfter.current) {
        navigate(latest.current.returnTo, { replace: true });
        return;
      }
      latest.current.startCreation({ recordId: created.id, token: created.token, returnTo: latest.current.returnTo });
      navigate(created.path, { replace: true });
    } finally {
      running.current = false;
      setWriting(false);
    }
  }, [navigate]);

  const attempt = React.useCallback(() => {
    if (isCreate && latest.current.ready()) void write(false);
  }, [isCreate, write]);

  const createAndLeave = React.useCallback(() => write(true), [write]);

  return {
    beingCreated: creation.beingCreated,
    busy: writing || creation.cancelling,
    attempt,
    createAndLeave,
    finishCreation: creation.finishCreation,
    cancelCreation: creation.cancelCreation,
  };
}
