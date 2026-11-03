import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Stack, TextField, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useKanapDialogs } from '../../components/design';
import { useAuth } from '../../auth/AuthContext';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { CreationActions, useCreationLeave, useCreationTitle, useDraftCreation } from '../../components/workspace/creation';
import {
  WORKING_DAY_PROFILES_QUERY_KEY,
  useCalendarCountries,
  useWorkingDayProfileYear,
  workingDayProfileDetailKey,
  workingDayProfileYearsKey,
} from '../../hooks/useWorkingDayProfiles';
import { useLocale } from '../../i18n/useLocale';
import { useWorkingDayCalendarNav } from '../../hooks/useWorkingDayCalendarNav';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import {
  createWorkingDayProfile,
  deleteWorkingDayProfile,
  getWorkingDayProfile,
  isStandardCalendar,
  updateWorkingDayProfile,
  type CalendarCountry,
  type CalendarDays,
  type WorkingDayProfileDetail,
  type WorkingDayProfilePatch,
} from '../../services/workingDayProfiles';
import { STATUS_DISABLED, deriveStatusFromDisabledAt } from '../../constants/status';
import { longFormSurfaceFieldSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import WorkingDayCalendarPropertiesDrawer from './WorkingDayCalendarPropertiesDrawer';
import WorkingDayProfileEditor from './WorkingDayProfileEditor';
import CalendarSourceFields from './CalendarSourceFields';
import {
  WORKING_DAY_CALENDARS_PATH,
  calendarDeleteBlock,
  calendarSourceLabel,
  calendarUsageLine,
  refusalField,
  standardCalendarCode,
  type WorkingDayCalendarField,
} from './workingDayCalendarFields';
import DeleteIconButton from '../../components/workspace/DeleteIconButton';

type FieldErrors = Partial<Record<WorkingDayCalendarField, string>>;

/** What a new calendar starts from: a custom one until a country is chosen. */
const NEW_CALENDAR: WorkingDayProfileDetail = {
  id: '', code: '', name: '', description: null, days_by_year: {}, status: 'enabled', disabled_at: null,
  country_iso: null, region_code: null, country_name: null, region_name: null, opex_count: 0, capex_count: 0,
};

/** Years sent for a draft: a year sent replaces it, `null` removes it. */
function mergeDraftDays(days: CalendarDays, patch: Record<string, string[] | null>): CalendarDays {
  const next = { ...days };
  for (const [year, values] of Object.entries(patch)) {
    if (values) next[year] = values;
    else delete next[year];
  }
  return next;
}

export default function WorkingDayCalendarWorkspacePage() {
  const { t } = useTranslation(['master-data', 'common']);
  const dialogs = useKanapDialogs();
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

  const { data: stored, error: loadError } = useQuery({
    queryKey: workingDayProfileDetailKey(id, lang),
    queryFn: () => getWorkingDayProfile(id, lang),
    enabled: !isCreate && !!id,
  });
  // The new page is the calendar's own page on a draft: the fields write here, Create sends it.
  const [draft, setDraft] = React.useState<WorkingDayProfileDetail>(NEW_CALENDAR);
  const draftRef = React.useRef(draft);
  const data = isCreate ? draft : stored;
  const { countries, ready: countriesReady } = useCalendarCountries({ enabled: isCreate && canEdit });

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
      if (isCreate) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
        const { days_by_year: days, ...rest } = body;
        const prev = draftRef.current;
        draftRef.current = { ...prev, ...rest, days_by_year: days ? mergeDraftDays(prev.days_by_year, days) : prev.days_by_year };
        setDraft(draftRef.current);
        return Promise.resolve(true);
      }
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
    [afterWrite, canEdit, data?.id, isCreate, lang, queryClient, t],
  );

  const saveYear = React.useCallback(
    (year: number, values: string[] | null) => patch({ days_by_year: { [String(year)]: values } }, 'days_by_year'),
    [patch],
  );

  const handleDelete = async () => {
    if (!data || !canDelete) return;
    // A record page always asks first.
    const confirmed = await dialogs.confirm({
      title: t('common:delete.recordTitle', { name: data.name }),
      message: t('common:delete.cannotUndo'),
      confirmLabel: t('common:buttons.delete'),
      intent: 'danger',
    });
    if (!confirmed) return;
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

  // The draft is created once it has its name and code (a country fills both); the calendar then
  // opens, its days and every tab available, with Create (kept, back where the creation started)
  // and Cancel (deleted).
  const leave = useCreationLeave(handleClose);
  const title = useCreationTitle({
    requiredMessage: t('workingDayCalendars.messages.nameRequired'),
    onCancel: leave,
    onCommit: () => attemptCreation(),
  });
  // A country with regions waits for its region (or the whole country): both are set at creation only.
  const awaitingRegionRef = React.useRef(false);
  const attemptCreation = () => {
    if (!awaitingRegionRef.current) creation.attempt();
  };
  // The code and name the last country choice wrote: a field still holding them follows the next choice.
  const prefillRef = React.useRef<{ code: string; name: string }>({ code: '', name: '' });

  const chooseSource = (nextCountry: CalendarCountry | null, regionCode: string | null, from: 'country' | 'region') => {
    awaitingRegionRef.current = from === 'country' && !!nextCountry && nextCountry.regions.length > 0;
    const nextRegion = nextCountry && regionCode ? nextCountry.regions.find((option) => option.code === regionCode) ?? null : null;
    const source = {
      country_iso: nextCountry?.code ?? null,
      country_name: nextCountry?.name ?? null,
      region_code: nextRegion?.code ?? null,
      region_name: nextRegion?.name ?? null,
    };
    const prefill = nextCountry
      ? { code: standardCalendarCode(nextCountry.code, nextRegion?.code ?? null), name: calendarSourceLabel(source) ?? '' }
      : { code: '', name: '' };
    const previous = prefillRef.current;
    prefillRef.current = prefill;
    const follows = (value: string, last: string) => value.trim() === '' || value === last;
    const code = follows(draftRef.current.code, previous.code) ? prefill.code : draftRef.current.code;
    void patch({ ...source, code }, 'country_iso');
    if (follows(title.current(), previous.name)) title.fill(prefill.name);
  };

  const creation = useDraftCreation({
    isCreate,
    family: 'working_day_profiles',
    apiBase: '/working-day-profiles',
    recordId: stored?.id ?? null,
    listPath: `${WORKING_DAY_CALENDARS_PATH}${listContext ? `?${listContext}` : ''}`,
    recordLabel: t('workingDayCalendars.creationRecord'),
    queryKeyPrefixes: ['working-day-profiles'],
    ready: () => !!title.current().trim() && !!draftRef.current.code,
    post: async () => {
      const form = draftRef.current;
      setPageError(null);
      try {
        const created = await createWorkingDayProfile({
          code: form.code,
          name: title.current().trim(),
          description: form.description,
          status: form.status,
          disabled_at: form.disabled_at,
          ...(form.country_iso
            ? { country_iso: form.country_iso, region_code: form.region_code }
            : { days_by_year: form.days_by_year }),
        });
        void queryClient.invalidateQueries({ queryKey: ['working-day-profiles'] });
        afterWrite();
        return { id: created.id, token: created.creation_token, path: `${WORKING_DAY_CALENDARS_PATH}/${created.id}/overview${listContext ? `?${listContext}` : ''}` };
      } catch (e) {
        const message = getApiErrorMessage(e, t, t('workingDayCalendars.messages.createFailed'));
        const field = refusalField(e);
        // A refusal goes under the field it names when the page shows that field.
        if (field === 'name') title.refuse(message);
        else if (field === 'region_code') setErrors((prev) => ({ ...prev, country_iso: message }));
        else if (field) setErrors((prev) => ({ ...prev, [field]: message }));
        else setPageError(message);
        return null;
      }
    },
    onError: setPageError,
  });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => { attemptCreation(); }, [creation.attempt, draft]);
  const handleCreate = () => {
    if (creation.beingCreated) {
      creation.finishCreation();
      return;
    }
    if (!canEdit) return;
    const name = title.require();
    const { code } = draftRef.current;
    if (!code) setErrors((prev) => ({ ...prev, code: t('workingDayCalendars.messages.codeRequired') }));
    if (!name || !code) return;
    void creation.createAndLeave();
  };

  const usage = data && !isCreate ? calendarUsageLine(t, data.opex_count ?? 0, data.capex_count ?? 0) : null;
  // The server refuses this delete anyway; the page already knows, so it says why up front.
  const deleteBlock = data ? calendarDeleteBlock(t, usage) : null;
  const usageText = canDelete ? deleteBlock ?? usage : usage;
  const disabled = !canEdit;

  const actions = isCreate || creation.beingCreated ? (
    <CreationActions
      onCreate={handleCreate}
      onCancel={isCreate ? leave : () => { void creation.cancelCreation(); }}
      busy={!canEdit || creation.busy}
    />
  ) : canDelete && data ? (
    <DeleteIconButton onClick={() => void handleDelete()} disabled={deleting || !!deleteBlock} />
  ) : undefined;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={(pageError || loadError) ? (
          <Alert severity="error" onClose={pageError ? () => setPageError(null) : undefined}>
            {pageError ?? t('workingDayCalendars.messages.loadFailed')}
          </Alert>
        ) : undefined}
        activeTab="overview"
        tabs={[{ key: 'overview', label: t('shared.labels.overview') }]}
        onTabChange={() => undefined}
        drawerStorageKey="kanap.workingDayCalendars.drawerOpen"
        backLabel={t('workingDayCalendars.title')}
        onBack={isCreate ? leave : handleClose}
        itemReference={isCreate ? null : data?.code ?? null}
        onCopyReference={!isCreate && data?.code ? () => { void navigator.clipboard?.writeText(data.code); } : undefined}
        {...(isCreate ? title.shellProps : {
          title: data?.name ?? '',
          canEditTitle: canEdit && !!data,
          onTitleSave: (next: string) => {
            const name = next.trim();
            if (data && name && name !== data.name) void patch({ name }, 'name');
          },
        })}
        titleFallback={isCreate ? t('workingDayCalendars.newCalendar') : t('workingDayCalendars.fallback')}
        isCreate={isCreate}
        // A new record's required fields sit in the drawer: it stays open.
        forceDrawerOpen={isCreate}
        nav={!isCreate && nav.total > 0 ? {
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
        history={data && !isCreate ? { table: 'working_day_profiles', recordId: data.id } : undefined}
        properties={data ? (
          <WorkingDayCalendarPropertiesDrawer
            key={data.id}
            calendar={data}
            disabled={disabled}
            errors={errors}
            onCodeCommit={(code) => void patch({ code }, 'code')}
            onDisabledAtChange={(disabledAt) => {
              if (disabledAt === data.disabled_at) return;
              void patch({ status: deriveStatusFromDisabledAt(disabledAt), disabled_at: disabledAt }, 'disabled_at');
            }}
            // Disable now: the status alone, the server sets the end of validity from its own clock.
            onDisableNow={() => void patch({ status: STATUS_DISABLED }, 'disabled_at')}
            sourceFields={isCreate ? (
              <CalendarSourceFields
                countries={countries}
                loading={canEdit && !countriesReady}
                countryCode={data.country_iso}
                regionCode={data.region_code}
                error={errors.country_iso}
                onChoose={chooseSource}
              />
            ) : undefined}
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
            {/* A new standard calendar shows its years once created: they come from the server. */}
            {!(isCreate && standard) && <WorkingDayProfileEditor
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
            />}
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
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  return (
    <Box>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 1 }}>
        {t('workingDayCalendars.fields.description')}
      </Typography>
      <TextField
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        onBlur={() => {
          onBlur();
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
