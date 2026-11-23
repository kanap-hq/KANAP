import React from 'react';
import { Box, Checkbox, CircularProgress, Link, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import type { AiBulkEditPreview, AiBulkEditRow, AiMutationPreview } from '../aiTypes';
import { setBulkExclusions } from '../previewChains';
import { ActionLink } from '../../components/csv/ImportMatchesView';
import { useAuth } from '../../auth/AuthContext';
import { referencePageUrl } from '../utils/referenceLinks';

/** The records listed at once; the others unfold on a click, as the rows of an import's check. */
const SHOWN_ROWS = 10;

const MONO = "'JetBrains Mono Variable', ui-monospace, monospace";

type Message = { text: string; detail?: string | null; error: boolean };

const excludedOf = (bulk: AiBulkEditPreview): string[] => bulk.rows.filter((row) => !row.kept).map((row) => row.id);
const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

/**
 * The records of a change in bulk on Kad's card (lot K2e of 26.12.1): one line each, its reference
 * (opening the record), its name, its value before and after. On a pending card a box keeps each
 * record; a change sends the whole list of the records left out and the card answered, recounted by
 * the server, replaces this one (`onReplace`), as an import card's choices do. One request at a time:
 * a box changed while a count runs shows at once and is sent once it ends, the last state counting (a
 * count of many budget lines may take a while). Read only otherwise: the
 * records left out say so, and once approved the records changed are marked.
 */
export default function BulkEditList({
  preview,
  bulk,
  onReplace,
  disabled = false,
  onCounting,
}: {
  preview: AiMutationPreview;
  bulk: AiBulkEditPreview;
  /** Absent, the list is read only. */
  onReplace?: (previous: AiMutationPreview, next: AiMutationPreview) => void;
  disabled?: boolean;
  /** A count runs on the server: the card's actions wait for it. */
  onCounting?: (counting: boolean) => void;
}) {
  const { t } = useTranslation(['ai', 'ops']);
  const { hasLevel } = useAuth();
  const [unfolded, setUnfolded] = React.useState(false);
  const [counting, setCounting] = React.useState(false);
  const [stale, setStale] = React.useState(false);
  const [message, setMessage] = React.useState<Message | null>(null);
  // The records left out as the boxes show them while a count runs; null: as the card says.
  const [shown, setShownState] = React.useState<string[] | null>(null);
  const shownRef = React.useRef<string[] | null>(null);
  const setShown = (ids: string[] | null) => {
    shownRef.current = ids;
    setShownState(ids);
  };
  const inFlight = React.useRef(false);
  const queued = React.useRef<string[] | null>(null);
  const boxes = React.useRef(new Map<string, HTMLInputElement>());
  const focusId = React.useRef<string | null>(null);
  const firstUnfolded = React.useRef<string | null>(null);
  const countingRef = React.useRef(onCounting);
  countingRef.current = onCounting;

  const interactive = preview.status === 'pending' && !!onReplace && !!preview.conversation_id && !stale;
  const inert = disabled;
  const excluded = shown ?? excludedOf(bulk);

  React.useEffect(() => () => countingRef.current?.(false), []);

  // The card replaced, the box the person changed keeps the focus, unless it went elsewhere.
  React.useEffect(() => {
    const id = focusId.current;
    const active = document.activeElement;
    if (id && (!active || active === document.body)) boxes.current.get(id)?.focus();
  }, [preview.preview_id]);

  // The rows unfolded: the focus goes to the first one shown, the link that unfolded them being gone.
  React.useEffect(() => {
    if (!unfolded || !firstUnfolded.current) return;
    const row = document.getElementById(`bulk-row-${preview.preview_id}-${firstUnfolded.current}`);
    row?.querySelector<HTMLElement>('input, a')?.focus();
    firstUnfolded.current = null;
  }, [unfolded, preview.preview_id]);

  const finish = () => {
    inFlight.current = false;
    setShown(null);
    setCounting(false);
    countingRef.current?.(false);
  };

  const send = (card: AiMutationPreview, ids: string[]) => {
    inFlight.current = true;
    setCounting(true);
    countingRef.current?.(true);
    setMessage(null);
    setBulkExclusions(card.conversation_id!, card.preview_id, ids)
      .then((next) => {
        onReplace?.(card, next);
        const again = queued.current;
        queued.current = null;
        if (again && next.status === 'pending' && next.bulk_edit && !sameIds(again, excludedOf(next.bulk_edit))) {
          send(next, again);
          return;
        }
        finish();
      })
      .catch((error: unknown) => {
        queued.current = null;
        finish();
        const response = (error as { response?: { status?: number; data?: { code?: unknown; message?: unknown } } })?.response;
        if (response?.status === 409 && response.data?.code === 'operation_running') {
          // Another budget operation runs: the boxes come back, the card stays to approve.
          setMessage({ text: t('ai:previewCard.bulkEdit.busy'), error: false });
        } else if (response?.status === 409) {
          // The card can no longer be changed: no longer pending, or its selection grew past the
          // records a card lists (the server says so in the person's language).
          setStale(true);
          const grew = response.data?.code === 'bulk_list_grew' && typeof response.data.message === 'string';
          setMessage({ text: grew ? String(response.data!.message) : t('ai:previewCard.importChoices.stale'), error: true });
        } else {
          setMessage({
            text: t('ai:previewCard.notApplied'),
            detail: typeof response?.data?.message === 'string' ? response.data.message : null,
            error: true,
          });
        }
      });
  };

  const toggle = (id: string) => {
    if (!interactive || inert) return;
    const base = shownRef.current ?? excludedOf(bulk);
    const next = base.includes(id) ? base.filter((other) => other !== id) : [...base, id];
    setShown(next);
    focusId.current = id;
    if (inFlight.current) {
      queued.current = next;
      return;
    }
    send(preview, next);
  };

  const folded = !unfolded && bulk.rows.length > SHOWN_ROWS;
  const rows = folded ? bulk.rows.slice(0, SHOWN_ROWS) : bulk.rows;
  const kept = bulk.rows.length - excluded.length;

  const mark = (row: AiBulkEditRow): string | null => {
    if (interactive) return null;
    if (!row.kept) return t('ai:previewCard.bulkEdit.leftOut');
    if (row.changed === true) return t('ai:previewCard.bulkEdit.changed');
    if (row.changed === false) return t('ai:previewCard.bulkEdit.notChanged');
    return null;
  };

  const line = (row: AiBulkEditRow) => {
    const isKept = !excluded.includes(row.id);
    const url = referencePageUrl(row.ref, (resource) => hasLevel(resource, 'reader'));
    const state = mark(row);
    return (
      <Box
        component="li"
        key={row.id}
        id={`bulk-row-${preview.preview_id}-${row.id}`}
        sx={{ display: 'flex', alignItems: 'flex-start', columnGap: 0.75, py: 0.25 }}
      >
        {interactive && (
          <Checkbox
            size="small"
            checked={isKept}
            onChange={() => toggle(row.id)}
            inputRef={(element: HTMLInputElement | null) => {
              if (element) boxes.current.set(row.id, element);
              else boxes.current.delete(row.id);
            }}
            disabled={inert}
            inputProps={{ 'aria-label': t('ai:previewCard.bulkEdit.keep', { ref: row.ref, title: row.title }) }}
            sx={{ p: 0.25, mt: '-1px' }}
          />
        )}
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            lineHeight: 1.45,
            overflowWrap: 'anywhere',
            color: isKept ? 'kanap.text.primary' : 'kanap.text.tertiary',
          }}
        >
          <Box component="span" sx={{ fontFamily: MONO, fontSize: 12, color: isKept ? 'kanap.text.secondary' : 'inherit' }}>
            {url ? <Link href={url} target="_blank" rel="noopener noreferrer" underline="hover">{row.ref}</Link> : row.ref}
          </Box>
          {' '}
          {row.title}
          <Box component="span" sx={{ ml: 1, fontSize: 12, whiteSpace: 'nowrap' }}>
            <Box
              component="span"
              sx={{
                color: 'kanap.text.tertiary',
                textDecoration: isKept && row.before_state === 'value' ? 'line-through' : 'none',
              }}
            >
              {row.before}
            </Box>
            <Box component="span" sx={{ color: 'kanap.text.tertiary', mx: 0.5 }}>→</Box>
            <Box component="span" sx={{ color: isKept ? 'warning.main' : 'inherit', fontWeight: isKept ? 500 : 400 }}>
              {bulk.after}
            </Box>
          </Box>
          {state && <Box component="span" sx={{ color: 'kanap.text.secondary' }}>{` · ${state}`}</Box>}
        </Box>
      </Box>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 0.75 }}>
        <Typography role="status" sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.secondary' }}>
          {t('ai:previewCard.bulkEdit.kept', { count: kept, total: bulk.rows.length })}
        </Typography>
        {counting && <CircularProgress size={12} thickness={5} aria-label={t('ai:previewCard.bulkEdit.counting')} sx={{ color: 'kanap.text.tertiary' }} />}
      </Box>
      <Box component="ul" aria-busy={counting} sx={{ m: 0, p: 0, listStyle: 'none' }}>
        {rows.map(line)}
      </Box>
      {folded && (
        <Box>
          <ActionLink
            onClick={() => {
              firstUnfolded.current = bulk.rows[SHOWN_ROWS]?.id ?? null;
              setUnfolded(true);
            }}
          >
            {t('ops:operations.budgetFile.andMoreInline', { count: bulk.rows.length - SHOWN_ROWS })}
          </ActionLink>
        </Box>
      )}
      {message && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <Typography variant="caption" sx={{ fontSize: 12, color: message.error ? 'error.main' : 'kanap.text.secondary' }}>
            {message.text}
          </Typography>
          {message.detail && (
            <Typography variant="caption" sx={{ fontSize: 11, color: 'kanap.text.tertiary', overflowWrap: 'anywhere' }}>
              {message.detail}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
