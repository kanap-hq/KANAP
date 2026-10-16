import React from 'react';
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import EntityKnowledgePanel from '../../../components/EntityKnowledgePanel';
// Lazy like the eight other call sites: a static import here pulls the MDX editor and its
// whole Lexical dependency tree into the entry chunk for every user, including those who
// never open a note editor. The Suspense boundary below was already in place.
const MarkdownEditor = React.lazy(() => import('../../../components/MarkdownEditor'));
import LocationSubItemsTable from './LocationSubItemsTable';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

type Props = {
  locationId: string;
  initialNotes: string;
  canManage: boolean;
  onNotesSaved?: (next: string) => void;
  onSubLocationsCountChange?: (count: number) => void;
  subItemsAnchorRef?: React.RefObject<HTMLDivElement>;
};

const NOTES_DEBOUNCE_MS = 900;

export default function LocationOverviewTab({
  locationId,
  initialNotes,
  canManage,
  onNotesSaved,
  onSubLocationsCountChange,
  subItemsAnchorRef,
}: Props) {
  const { t } = useTranslation(['it', 'common']);
  const [notes, setNotes] = React.useState(initialNotes);
  const [status, setStatus] = React.useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [error, setError] = React.useState<string | null>(null);
  const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = React.useRef(initialNotes);
  const baselineRef = React.useRef(initialNotes);

  React.useEffect(() => {
    setNotes(initialNotes);
    latestRef.current = initialNotes;
    baselineRef.current = initialNotes;
  }, [initialNotes, locationId]);

  const persist = React.useCallback(
    async (next: string) => {
      if (next === baselineRef.current) return;
      setStatus('saving');
      setError(null);
      try {
        await api.patch(`/locations/${locationId}`, {
          additional_info: next.trim().length > 0 ? next : null,
        });
        baselineRef.current = next;
        setStatus('saved');
        onNotesSaved?.(next);
        setTimeout(() => {
          setStatus((current) => (current === 'saved' ? 'idle' : current));
        }, 1500);
      } catch (e: any) {
        setStatus('error');
        setError(getApiErrorMessage(e, t, t('messages.saveLocationFailed')));
      }
    },
    [locationId, onNotesSaved, t],
  );

  const handleNotesChange = (value: string) => {
    setNotes(value);
    latestRef.current = value;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void persist(latestRef.current);
    }, NOTES_DEBOUNCE_MS);
  };

  React.useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>
            {t('it:common.notes')}
          </Typography>
          {status === 'saving' && (
            <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>{t('common:status.saving')}</Typography>
          )}
          {status === 'saved' && (
            <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary' }}>{t('common:status.saved')}</Typography>
          )}
          {status === 'error' && error && (
            <Typography sx={{ fontSize: 11, color: 'error.main' }}>{error}</Typography>
          )}
        </Box>
        <React.Suspense
          fallback={
            <Box
              sx={(theme) => ({
                minHeight: 154,
                maxWidth: 900,
                border: `1px solid ${theme.palette.kanap.border.default}`,
                borderRadius: '8px',
                bgcolor: theme.palette.kanap.bg.composer,
              })}
            />
          }
        >
          <MarkdownEditor
            value={notes}
            onChange={handleNotesChange}
            placeholder={t('it:workspace.location.overview.notesPlaceholder')}
            minRows={4}
            maxRows={14}
            disabled={!canManage}
            hideToolbarUntilFocus
            surface
          />
        </React.Suspense>
      </Box>

      <Box ref={subItemsAnchorRef}>
        <LocationSubItemsTable
          locationId={locationId}
          canManage={canManage}
          onCountChange={onSubLocationsCountChange}
        />
      </Box>

      <Box>
        <EntityKnowledgePanel entityType="locations" entityId={locationId} canCreate={canManage} />
      </Box>
    </Box>
  );
}
