import React from 'react';
import { flushSync } from 'react-dom';
import { Box, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { visuallyHiddenSx } from '../../design/FieldLabel';
import { armCreationFieldFocus } from './creationFieldFocus';
import useMissingAnnouncement from './missingAnnouncement';

type Props = {
  /**
   * Create on the new page (the title's commit writes the record, the page opens it); Done on the
   * created record: the page saves what is still being typed, checks the fields the record needs,
   * then closes it, kept.
   */
  onCreate: () => void;
  /** Closes without keeping: leaves a new page, deletes a record being created. */
  onCancel: () => void;
  /** A check or a cancel is running: both wait. */
  busy?: boolean;
  /**
   * The record is being written: Cancel and Escape in the title wait (the page would move to the
   * record after the leave); Create still counts.
   */
  writing?: boolean;
  /** The record is created: the primary pill says Done. */
  done?: boolean;
};

/**
 * The record shown around `from` (its page, else the whole screen) is being written: a leave now
 * would be followed by the page moving to the record, so the title's Escape waits as Cancel does.
 */
export function isCreationWriting(from: Element | null): boolean {
  const scope: ParentNode = from?.closest('[data-workspace-shell]') ?? document;
  return !!scope.querySelector('[data-creation-actions][data-creation-writing]');
}

/**
 * The two actions of a record being created, in its header in place of the close button: the
 * primary pill and Cancel. Shown on the new page, where the pill says Create, and on the created
 * record while the person stays on it (`useRecordCreation`), where it says Done. Ctrl+S (Cmd+S) is
 * the pill. The page's one announcement region sits here: when Create or Done marks fields
 * missing, it says "Missing: …" with their labels (`useMissingAnnouncement`).
 *
 * Done is never reached from Create: a pointer click counts as Done only when its press began on
 * Done, and only as the first click of a series. The press on Create blurs the title, whose commit
 * writes the record; it may come back, and the pill turn to Done, before the click lands, or
 * between the two clicks of a double-click. A click from the keyboard (detail 0) counts.
 */
export default function CreationActions({ onCreate, onCancel, busy = false, writing = false, done = false }: Props) {
  const { t } = useTranslation('common');
  const createRef = React.useRef<HTMLButtonElement>(null);
  const announcement = useMissingAnnouncement(createRef);
  const doneRef = React.useRef(done);
  doneRef.current = done;
  // What the pill said when the pointer last pressed it.
  const pressedOnDone = React.useRef(false);

  // Listens after the fields, which keep the keys they use (a comment sends itself), and before
  // the page's own save shortcut on the window.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing || event.key.toLowerCase() !== 's') return;
      const create = createRef.current;
      const target = event.target instanceof Element ? event.target : null;
      // A menu or dialog over the page keeps its keys, as it keeps the pointer from Create. So
      // does a panel beside the page.
      const page = create?.closest('[data-workspace-shell]');
      if (!create || target?.closest('.MuiModal-root, [role="dialog"]')) return;
      if (page && target && target !== document.body && !page.contains(target)) return;
      event.preventDefault();
      event.stopPropagation();
      // A key held down repeats: its first press is the one meant.
      if (event.repeat) return;
      // As from the keyboard: the field being typed commits as the focus leaves it, and the pill runs
      // on the page rendered with it (a title that writes its record is then under way). A busy
      // pill takes neither.
      if (!doneRef.current && !create.disabled) armCreationFieldFocus();
      flushSync(() => create.focus());
      create.click();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // The marker tells the page's Tab it is a record being created (`followCreationFields`), and its
  // title that the record is being written (`isCreationWriting`).
  return (
    <Box component="span" data-creation-actions="" data-creation-writing={writing ? '' : undefined} sx={{ display: 'contents' }}>
      {/* The one announcement of the page: the fields a check marked missing, said once per check. */}
      <Box component="span" role="status" aria-live="polite" sx={visuallyHiddenSx}>{announcement}</Box>
      <Button variant="action" size="small" onClick={onCancel} disabled={busy || writing}>
        {t('common:buttons.cancel')}
      </Button>
      <Button
        ref={createRef}
        variant="action-primary"
        size="small"
        disabled={busy}
        onPointerDown={() => {
          pressedOnDone.current = done;
          // The record the title creates under this press puts the cursor in its first field to fill.
          if (!done) armCreationFieldFocus();
        }}
        onClick={(event) => {
          if (done && event.detail > 0 && (!pressedOnDone.current || event.detail > 1)) return;
          onCreate();
        }}
      >
        {done ? t('common:buttons.done') : t('common:buttons.create')}
      </Button>
    </Box>
  );
}
