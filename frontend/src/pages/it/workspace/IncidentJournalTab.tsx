import React from 'react';
import { Alert, Avatar, Box, Button, Link as MLink, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { incidentsApi, type IncidentEntry } from '../../../api/endpoints/incidents';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDateTime } from '../../../lib/dateFormat';
import { fieldResetSx } from '../../../theme/formSx';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { formatRelativeTime } from '../../../utils/portfolioI18n';
import IncidentDateTimeField from './IncidentDateTimeField';
import { incidentEntriesQueryKey, incidentInitials, incidentSeverityLabel, incidentStatusLabel } from './incidentWorkspace';

type Props = {
  incidentId: string;
  canAdd: boolean;
  onEntryAdded: () => void;
};

/** Charter composer card: editor area on top, single-line footer with a soft divider. */
const journalComposerSx = {
  bgcolor: 'kanap.bg.composer',
  border: '1px solid',
  borderColor: 'kanap.border.default',
  borderRadius: '8px',
  '&:focus-within': { borderColor: 'kanap.teal' },
} as const;

const journalEditorSx = [
  fieldResetSx,
  {
    '& .MuiInputBase-root': { p: '14px 16px', fontSize: 14, lineHeight: 1.6, alignItems: 'flex-start' },
    '& textarea::placeholder': { color: 'kanap.text.tertiary', opacity: 1 },
  },
] as const;

const journalFooterSx = {
  borderTop: '1px solid',
  borderColor: 'kanap.border.soft',
  p: '10px 16px 12px',
} as const;

// The server writes these system entries in English; they are shown in the reader's language,
// existing entries included. Any other content is someone's text and is shown as written.
const SYSTEM_ENTRY_KEYS: Record<string, string> = {
  'Incident logged': 'workspace.incident.journal.systemEntries.logged',
  'Imported from CSV': 'workspace.incident.journal.systemEntries.importedFromCsv',
  'Incident review imported from CSV': 'workspace.incident.journal.systemEntries.reviewImportedFromCsv',
  'Incident review imported': 'workspace.incident.journal.systemEntries.reviewImported',
};

/** A minute of slack covers the latency between the client's clock and the server write. */
const RECORDED_AT_TOLERANCE_MS = 60 * 1000;

/**
 * A note can be recorded later than the facts it describes: the server keeps both times and the
 * journal shows the recording time only when the two differ.
 */
function recordedAtDiffers(entry: IncidentEntry): boolean {
  const occurred = Date.parse(entry.occurred_at);
  const created = Date.parse(entry.created_at);
  if (!Number.isFinite(occurred) || !Number.isFinite(created)) return false;
  return Math.abs(created - occurred) > RECORDED_AT_TOLERANCE_MS;
}

export default function IncidentJournalTab({ incidentId, canAdd, onEntryAdded }: Props) {
  const { t } = useTranslation('it');
  const { t: tPortfolio } = useTranslation('portfolio');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [note, setNote] = React.useState('');
  const [occurredAt, setOccurredAt] = React.useState<string>(() => new Date().toISOString());
  const occurredTouchedRef = React.useRef(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const { data: entries = [] } = useQuery({
    queryKey: incidentEntriesQueryKey(incidentId),
    queryFn: () => incidentsApi.listEntries(incidentId),
  });

  const handleNoteChange = (next: string) => {
    if (!note && next && !occurredTouchedRef.current) setOccurredAt(new Date().toISOString());
    setNote(next);
  };

  const submit = async () => {
    const content = note.trim();
    if (!content || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await incidentsApi.createEntry(incidentId, { content, occurred_at: occurredAt });
      setNote('');
      occurredTouchedRef.current = false;
      setOccurredAt(new Date().toISOString());
      await queryClient.invalidateQueries({ queryKey: incidentEntriesQueryKey(incidentId) });
      onEntryAdded();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('workspace.incident.messages.entryFailed')));
    } finally {
      setSubmitting(false);
    }
  };

  /**
   * Closure/cancellation entries carry the review snapshot the server kept:
   * `{ from: null, to: { document_id, version_number, revision } }`. The document
   * reference is optional, so the line degrades to a plain version number.
   */
  const renderReviewVersion = (change: { from: unknown; to: unknown }) => {
    const value = change.to;
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    const version = Number(row.version_number);
    if (!Number.isFinite(version) || version <= 0) return null;
    const itemNumber = Number(row.item_number);
    const reference = typeof row.item_ref === 'string' && row.item_ref
      ? row.item_ref
      : (Number.isFinite(itemNumber) && itemNumber > 0 ? `DOC-${itemNumber}` : null);
    const target = reference || (typeof row.document_id === 'string' ? row.document_id : null);
    const label = t('workspace.incident.journal.reviewVersion', { version });
    return (
      <Typography sx={{ fontSize: 13, lineHeight: 1.55 }}>
        {label}
        {reference && target && (
          <>
            {' ('}
            <MLink component={Link} to={`/knowledge/${target}`} underline="hover">{reference}</MLink>
            {')'}
          </>
        )}
      </Typography>
    );
  };

  const describeChange = (field: string, change: { from: unknown; to: unknown }) => {
    const label = t(`workspace.incident.journal.fields.${field}`, { defaultValue: field });
    const format = (value: unknown) => {
      if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) return '—';
      if (Array.isArray(value)) return value.join(', ');
      if (field === 'status') return incidentStatusLabel(t, String(value));
      if (field === 'severity') return incidentSeverityLabel(t, String(value));
      if (field === 'confidential') {
        return value
          ? t('workspace.incident.journal.restricted')
          : t('workspace.incident.journal.unrestricted');
      }
      return String(value);
    };
    return `${label}: ${format(change.from)} → ${format(change.to)}`;
  };

  const authorName = (entry: IncidentEntry) => (
    entry.author_name
    || (entry.kind === 'system'
      ? t('workspace.incident.journal.systemAuthor')
      : t('workspace.incident.journal.unknownAuthor'))
  );

  return (
    <Stack spacing="22px" sx={{ pt: 1, maxWidth: 900 }}>
      {canAdd && (
        <Box sx={journalComposerSx}>
          <TextField
            value={note}
            onChange={(event) => handleNoteChange(event.target.value)}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                void submit();
              }
            }}
            multiline
            minRows={3}
            fullWidth
            variant="standard"
            placeholder={t('workspace.incident.journal.placeholder')}
            disabled={submitting}
            sx={journalEditorSx}
          />
          <Stack direction="row" alignItems="center" spacing="18px" sx={journalFooterSx}>
            <Box sx={{ width: 200 }}>
              <IncidentDateTimeField
                value={occurredAt}
                onChange={(next) => {
                  if (!next) return;
                  occurredTouchedRef.current = true;
                  setOccurredAt(next);
                }}
                disabled={submitting}
                inline
              />
            </Box>
            <Box sx={{ flex: 1 }} />
            <Button
              variant="contained"
              size="small"
              onClick={() => void submit()}
              disabled={submitting || !note.trim()}
            >
              {t('workspace.incident.journal.add')}
            </Button>
          </Stack>
        </Box>
      )}

      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}

      {entries.length === 0 && (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
          {t('workspace.incident.journal.empty')}
        </Typography>
      )}

      <Stack spacing="22px">
        {entries.map((entry) => {
          const name = authorName(entry);
          // Link changes carry a ready-made sentence; showing the raw before/after lists as well would duplicate it.
          const changes = entry.changed_fields && entry.kind !== 'link_change' ? Object.entries(entry.changed_fields) : [];
          // `renderReviewVersion` returns null for a malformed snapshot, so the
          // nodes are built first: an entry whose only change renders to nothing
          // must not leave an empty spacer block behind.
          const changeNodes = changes
            .map(([field, change]) => {
              const node = field === 'review_version' ? renderReviewVersion(change) : (
                <Typography sx={{ fontSize: 13, lineHeight: 1.55 }}>
                  {describeChange(field, change)}
                </Typography>
              );
              return node ? <React.Fragment key={field}>{node}</React.Fragment> : null;
            })
            .filter(Boolean);
          return (
            <Box key={entry.id} sx={{ display: 'flex', gap: '12px' }}>
              <Avatar sx={{ width: 26, height: 26, fontSize: '10px', fontWeight: 500, bgcolor: 'kanap.teal', color: 'kanap.tealForeground', flexShrink: 0 }}>
                {incidentInitials(name)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="baseline">
                  <Typography sx={{ fontSize: 13, fontWeight: 500 }}>{name}</Typography>
                  <Tooltip title={formatRelativeTime(tPortfolio, entry.occurred_at, locale)}>
                    <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>
                      {formatShortDateTime(entry.occurred_at, locale)}
                    </Typography>
                  </Tooltip>
                  {recordedAtDiffers(entry) && (
                    <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>
                      {t('workspace.incident.journal.recordedAt', {
                        date: formatShortDateTime(entry.created_at, locale),
                      })}
                    </Typography>
                  )}
                  {entry.kind !== 'note' && (
                    <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>
                      {t(`workspace.incident.journal.kinds.${entry.kind}`, { defaultValue: entry.kind })}
                    </Typography>
                  )}
                </Stack>
                {changeNodes.length > 0 && (
                  <Box sx={{ mt: '4px' }}>
                    {changeNodes}
                  </Box>
                )}
                {entry.content && (
                  <Typography sx={{ mt: '4px', fontSize: 13, lineHeight: 1.55, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                    {entry.kind === 'system' && Object.prototype.hasOwnProperty.call(SYSTEM_ENTRY_KEYS, entry.content)
                      ? t(SYSTEM_ENTRY_KEYS[entry.content])
                      : entry.content}
                  </Typography>
                )}
              </Box>
            </Box>
          );
        })}
      </Stack>
    </Stack>
  );
}
