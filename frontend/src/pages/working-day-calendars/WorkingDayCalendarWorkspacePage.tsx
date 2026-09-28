import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import {
  WORKING_DAY_PROFILES_QUERY_KEY,
  useWorkingDayProfileYear,
  workingDayProfileDetailKey,
  workingDayProfileYearsKey,
} from '../../hooks/useWorkingDayProfiles';
import { useLocale } from '../../i18n/useLocale';
import { useWorkingDayCalendarNav } from '../../hooks/useWorkingDayCalendarNav';
import {
  deleteWorkingDayProfile,
  getWorkingDayProfile,
  isStandardCalendar,
  updateWorkingDayProfile,
  type WorkingDayProfilePatch,
} from '../../services/workingDayProfiles';
import { deriveStatusFromDisabledAt } from '../../constants/status';
import { longFormSurfaceFieldSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import WorkingDayCalendarPropertiesDrawer from './WorkingDayCalendarPropertiesDrawer';
import WorkingDayProfileEditor from './WorkingDayProfileEditor';
import WorkingDayCalendarCreate from './WorkingDayCalendarCreate';
import {
  WORKING_DAY_CALENDARS_PATH,
  calendarDeleteBlock,
  calendarSourceLabel,
  calendarUsageLine,
  refusalField,
  type WorkingDayCalendarField,
} from './workingDayCalendarFields';

type FieldErrors = Partial<Record<WorkingDayCalendarField, string>>;

export default function WorkingDayCalendarWorkspacePage() {
  const { t } = useTranslation(['master-data', 'common']);
  const { hasLevel } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const lang = useLocale();

  const id = String(params.id || '');
  const isCreate = id === 'new';
  const canEdit = hasLevel('working_day_profiles', 'member');
  const canDelete = hasLevel('working_day_profiles', 'admin');

  const { data, error: loadError } = useQuery({
    queryKey: workingDayProfileDetailKey(id, lang),
    queryFn: () => getWorkingDayProfile(id, lang),
    enabled: !isCreate && !!id,
  });

  // A standard calendar loads the shown year's standard values and public holidays.
  const standard = isStandardCalendar(data);
  const [shownYear, setShownYear] = React.useState(() => new Date().getFullYear());
  const yearQuery = useWorkingDayProfileYear(data?.id ?? null, shownYear, { enabled: standard });

  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [pageError, setPageError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  // Autosave never blocks the fields: writes queue one after the other, so a response never
  // overwrites a newer one, and results for a record the user has left are dropped.
  const chainRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const currentIdRef = React.useRef(id);
  currentIdRef.current = id;

  React.useEffect(() => {
    setErrors({});
    setPageError(null);
  }, [id]);

  const listContext = React.useMemo(() => {
    const sp = new URLSearchParams();
    for (const key of ['sort', 'q', 'filters', 'scope']) {
      const value = searchParams.get(key);
      if (value) sp.set(key, value);
    }
    return sp.toString();
  }, [searchParams]);

  const nav = useWorkingDayCalendarNav({
    id,
    sort: searchParams.get('sort'),
    q: searchParams.get('q'),
    filters: searchParams.get('filters'),
    statusScope: searchParams.get('scope'),
    enabled: !isCreate,
  });

  const goTo = React.useCallback(
    (targetId: string | null) => {
      if (targetId) navigate(`${WORKING_DAY_CALENDARS_PATH}/${targetId}/overview${listContext ? `?${listContext}` : ''}`);
    },
    [listContext, navigate],
  );

  const handleClose = React.useCallback(() => {
    navigate(`${WORKING_DAY_CALENDARS_PATH}${listContext ? `?${listContext}` : ''}`);
  }, [listContext, navigate]);

  const afterWrite = React.useCallback(() => {
    // The lists only: the detail was just replaced by the response.
    void queryClient.invalidateQueries({ queryKey: WORKING_DAY_PROFILES_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['working-day-profiles-ids'] });
  }, [queryClient]);

  const patch = React.useCallback(
    (body: WorkingDayProfilePatch, field: WorkingDayCalendarField): Promise<boolean> => {
      const recordId = data?.id;
      if (!recordId || !canEdit) return Promise.resolve(false);
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      const run = async (): Promise<boolean> => {
        try {
          const saved = await updateWorkingDayProfile(recordId, body, lang);
          queryClient.setQueryData(workingDayProfileDetailKey(recordId, lang), saved);
          afterWrite();
          // The days in effect changed: the year shown here and the budget tab's working-days note follow.
          if (body.days_by_year) void queryClient.invalidateQueries({ queryKey: workingDayProfileYearsKey(recordId) });
          return true;
        } catch (e) {
          if (currentIdRef.current !== recordId) return false;
          const message = getApiErrorMessage(e, t, t('workingDayCalendars.messages.saveFailed'));
          const target = refusalField(e) ?? field;
          if (target === 'name') setPageError(message);
          else setErrors((prev) => ({ ...prev, [target]: message }));
          return false;
        }
      };
      const result = chainRef.current.then(run, run);
      chainRef.current = result.catch(() => undefined);
      return result;
    },
    [afterWrite, canEdit, data?.id, lang, queryClient, t],
  );

  const saveYear = React.useCallback(
    (year: number, values: string[] | null) => patch({ days_by_year: { [String(year)]: values } }, 'days_by_year'),
    [patch],
  );

  const handleDelete = async () => {
    if (!data || !canDelete) return;
    setDeleting(true);
    setPageError(null);
    try {
      await deleteWorkingDayProfile(data.id);
      void queryClient.invalidateQueries({ queryKey: ['working-day-profiles'] });
      afterWrite();
      handleClose();
    } catch (e) {
      setPageError(getApiErrorMessage(e, t, t('workingDayCalendars.messages.deleteFailed')));
    } finally {
      setDeleting(false);
    }
  };

  const usage = data ? calendarUsageLine(t, data.opex_count ?? 0, data.capex_count ?? 0) : null;
  // The server refuses this delete anyway; the page already knows, so it says why up front.
  const deleteBlock = data ? calendarDeleteBlock(t, usage) : null;
  const usageText = canDelete ? deleteBlock ?? usage : usage;
  const disabled = !canEdit;

  if (isCreate) {
    return <WorkingDayCalendarCreate onClose={handleClose} onCreated={(newId) => goTo(newId)} canCreate={canEdit} />;
  }

  const actions = canDelete && data ? (
    <Button
      variant="action-danger"
      startIcon={<DeleteIcon sx={{ fontSize: '14px !important' }} />}
      size="small"
      onClick={() => void handleDelete()}
      disabled={deleting || !!deleteBlock}
    >
      {t('common:buttons.delete')}
    </Button>
  ) : undefined;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {(pageError || loadError) && (
        <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={pageError ? () => setPageError(null) : undefined}>
          {pageError ?? t('workingDayCalendars.messages.loadFailed')}
        </Alert>
      )}
      <PortfolioDetailWorkspaceShell
        activeTab="overview"
        tabs={[{ key: 'overview', label: t('shared.labels.overview') }]}
        onTabChange={() => undefined}
        drawerStorageKey="kanap.workingDayCalendars.drawerOpen"
        backLabel={t('workingDayCalendars.title')}
        onBack={handleClose}
        itemReference={data?.code ?? null}
        onCopyReference={data?.code ? () => { void navigator.clipboard?.writeText(data.code); } : undefined}
        title={data?.name ?? ''}
        titleFallback={t('workingDayCalendars.fallback')}
        canEditTitle={canEdit && !!data}
        onTitleSave={(next) => {
          const name = next.trim();
          if (data && name && name !== data.name) void patch({ name }, 'name');
        }}
        nav={nav.total > 0 ? {
          currentIndex: nav.index + 1,
          totalCount: nav.total,
          hasPrev: nav.hasPrev,
          hasNext: nav.hasNext,
          onPrev: () => goTo(nav.prevId),
          onNext: () => goTo(nav.nextId),
          previousLabel: t('workingDayCalendars.previous'),
          nextLabel: t('workingDayCalendars.next'),
        } : undefined}
        actions={actions}
        properties={data ? (
          <WorkingDayCalendarPropertiesDrawer
            calendar={data}
            disabled={disabled}
            errors={errors}
            onCodeCommit={(code) => void patch({ code }, 'code')}
            onDisabledAtChange={(disabledAt) => {
              if (disabledAt === data.disabled_at) return;
              void patch({ status: deriveStatusFromDisabledAt(disabledAt), disabled_at: disabledAt }, 'disabled_at');
            }}
          />
        ) : <Box />}
      >
        {data && (
          <Stack spacing={3} sx={{ maxWidth: 900 }}>
            {usageText && (
              <Typography data-testid="working-day-calendar-usage" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
                {usageText}
              </Typography>
            )}
            <DescriptionField
              key={`description-${data.id}`}
              value={data.description ?? ''}
              disabled={disabled}
              error={errors.description}
              onCommit={(description) => void patch({ description }, 'description')}
            />
            <WorkingDayProfileEditor
              key={`days-${data.id}`}
              daysByYear={data.days_by_year ?? {}}
              disabled={disabled}
              error={errors.days_by_year}
              usage={usage}
              onSaveYear={saveYear}
              standard={standard ? {
                source: calendarSourceLabel(data) ?? '',
                year: yearQuery.data,
                failed: yearQuery.isError,
              } : null}
              onYearChange={setShownYear}
            />
          </Stack>
        )}
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}

function DescriptionField({
  value,
  disabled,
  error,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  error?: string;
  onCommit: (next: string | null) => void;
}) {
  const { t } = useTranslation(['master-data']);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => { setDraft(value); }, [value]);
  return (
    <Box>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 1 }}>
        {t('workingDayCalendars.fields.description')}
      </Typography>
      <TextField
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const next = draft.trim();
          if (next !== value.trim()) onCommit(next || null);
        }}
        multiline
        minRows={2}
        variant="standard"
        placeholder={t('workingDayCalendars.placeholders.description')}
        disabled={disabled}
        error={!!error}
        helperText={error}
        sx={longFormSurfaceFieldSx}
        inputProps={{ 'aria-label': t('workingDayCalendars.fields.description') }}
      />
    </Box>
  );
}
