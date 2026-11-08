import React from 'react';
import { flushSync } from 'react-dom';
import { Box, Button } from '@mui/material';
import { useTranslation } from 'react-i18next';

type Props = {
  /** Keeps the record and closes it (the page saves what is still being typed first). */
  onCreate: () => void;
  /** Closes without keeping: leaves a new page, deletes a record being created. */
  onCancel: () => void;
  /** A check or a cancel is running: both wait. */
  busy?: boolean;
  /** The record is being written: Cancel waits (the page would move to it after the leave); Create still counts. */
  writing?: boolean;
};

/**
 * The two actions of a record being created, in its header in place of the close button: Create
 * (the primary pill) and Cancel. Shown on the new page and on the created record while the person
 * stays on it (`useRecordCreation`). Ctrl+S (Cmd+S) is Create.
 */
export default function CreationActions({ onCreate, onCancel, busy = false, writing = false }: Props) {
  const { t } = useTranslation('common');
  const createRef = React.useRef<HTMLButtonElement>(null);

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
      // As from the keyboard: the field being typed commits as the focus leaves it, and Create runs
      // on the page rendered with it (a title that writes its record is then under way). A busy
      // Create takes neither.
      flushSync(() => create.focus());
      create.click();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // The marker tells the page's Tab it is a record being created (`followCreationFields`).
  return (
    <Box component="span" data-creation-actions="" sx={{ display: 'contents' }}>
      <Button variant="action" size="small" onClick={onCancel} disabled={busy || writing}>
        {t('common:buttons.cancel')}
      </Button>
      <Button ref={createRef} variant="action-primary" size="small" onClick={onCreate} disabled={busy}>
        {t('common:buttons.create')}
      </Button>
    </Box>
  );
}
