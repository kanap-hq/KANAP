import React from 'react';
import { Button, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { KanapDialog } from '../../design';
import { missingFieldsList } from './missingFieldsList';

type Options = {
  /**
   * The record's words, under this key (`ops:budget.creation`): `leaveTitle`, `leaveComplete`,
   * `leaveDelete`, `leaveAnyway` and `missing` (`{{fields}}`), so each language can agree them with
   * the record ("La compléter", "Le compléter").
   */
  keys: string;
  /** The record is being created: the other answer deletes it (Cancel), instead of leaving it as it is. */
  beingCreated: boolean;
  /** The labels of the fields the record still needs, in screen order, with their keys. */
  missing: () => Array<{ key: string; label: string }>;
  /** « Complete it »: the page focuses this field (opening its tab or panel). */
  focus: (key: string) => void;
  /** « Delete it » of a record being created: true once deleted (its own confirmation may keep it). */
  onDelete: () => Promise<boolean>;
};

type Asking = { labels: string[]; firstKey: string };

/**
 * Leaving a record that lacks a field it needs (budget lines, lot 1c; assets and connections, lot 3):
 * a record being created asks « Complete it » (stay, focus the first missing field) or « Delete it »
 * (the page's Cancel); a record left incomplete earlier asks « Complete it » or « Leave anyway ».
 * `confirm()` resolves true when the move may go on. A question left unanswered (the page goes) stays.
 */
export default function useIncompleteLeave({ keys, beingCreated, missing, focus, onDelete }: Options) {
  const { t, i18n } = useTranslation(['common']);
  const latest = React.useRef({ beingCreated, missing, focus, onDelete });
  latest.current = { beingCreated, missing, focus, onDelete };
  const [asking, setAsking] = React.useState<Asking | null>(null);
  const pending = React.useRef<((leave: boolean) => void) | null>(null);
  const settle = React.useCallback((leave: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setAsking(null);
    resolve?.(leave);
  }, []);
  React.useEffect(() => () => {
    const resolve = pending.current;
    pending.current = null;
    resolve?.(false);
  }, []);

  const confirm = React.useCallback((): Promise<boolean> => {
    const lacking = latest.current.missing();
    if (lacking.length === 0) return Promise.resolve(true);
    if (pending.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      pending.current = resolve;
      setAsking({ labels: lacking.map((field) => field.label), firstKey: lacking[0].key });
    });
  }, []);

  const stay = React.useCallback(() => {
    if (!asking) return;
    settle(false);
    latest.current.focus(asking.firstKey);
  }, [asking, settle]);

  const other = React.useCallback(async () => {
    if (!latest.current.beingCreated) {
      settle(true);
      return;
    }
    // The question closes first: the delete may ask its own confirmation.
    const resolve = pending.current;
    pending.current = null;
    setAsking(null);
    resolve?.(await latest.current.onDelete());
  }, [settle]);

  const dialog = asking ? (
    <KanapDialog
      open
      title={t(`${keys}.leaveTitle`)}
      onClose={stay}
      onSave={stay}
      saveLabel={t(`${keys}.leaveComplete`)}
      saveAutoFocus
      showCancel={false}
      secondaryActions={(
        <Button variant={beingCreated ? 'action-danger' : 'action'} onClick={() => { void other(); }}>
          {beingCreated ? t(`${keys}.leaveDelete`) : t(`${keys}.leaveAnyway`)}
        </Button>
      )}
    >
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
        {t(`${keys}.missing`, { fields: missingFieldsList(asking.labels, i18n.resolvedLanguage || i18n.language) })}
      </Typography>
    </KanapDialog>
  ) : null;

  return { confirm, dialog };
}
