import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { CreationActions, saveEditsSince, useCreatedFromDraft, useCreationLeave, useCreationTitle, useDraftCreation } from '../../components/workspace/creation';
import { useAuth } from '../../auth/AuthContext';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { KanapDialog, PropertyGroup, PropertyRow } from '../../components/design';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import LineTypeUsageSelect, { LineTypeUsageConflictNote } from '../../components/fields/LineTypeUsageSelect';
import { ANALYTICS_AXES_QUERY_KEY, analyticsAxisLabel, axisAppliesTo, useAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { useAnalyticsNav } from '../../hooks/useAnalyticsNav';
import {
  createAnalyticsValue,
  deleteAnalyticsValue,
  getAnalyticsValue,
  isAnalyticsActive,
  updateAnalyticsValue,
  type AnalyticsAxis,
  type AnalyticsValueDetail,
  type AnalyticsValuePatch,
} from '../../services/analytics';
import { STATUS_DISABLED, deriveStatusFromDisabledAt, normalizeStatus } from '../../constants/status';
import { lineTypeUsageConflict, parseLineTypeUsage, type LineType } from '../../constants/lineTypeUsage';
import { axisListColumn, oneOffListLink } from '../reports/reportListLink';
import ListLinkAnchor from '../reports/ListLinkAnchor';
import { keepValues } from '../reports/reportAggregates';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import AnalyticsDescriptionField from './AnalyticsDescriptionField';
import {
  ANALYTICS_LIST_PATH,
  analyticsRefusalField,
  deleteConfirmation,
  usedLineCount,
  type AnalyticsField,
} from './analyticsFields';
import AnalyticsLinesUsage from './AnalyticsLinesUsage';
import DeleteIconButton from '../../components/workspace/DeleteIconButton';

type FieldErrors = Partial<Record<AnalyticsField, string>>;

const DRAWER_KEY = 'kanap.analyticsValues.drawerOpen';
/** What a new value starts from; its dimension is the page's (see `fallbackAxisId`). */
const NEW_VALUE: AnalyticsValueDetail = {
  id: '', axis_id: '', name: '', description: null, applies_to: null, sort_order: 0, status: 'enabled', disabled_at: null,
};
const LIST_CONTEXT_KEYS = ['sort', 'q', 'filters', 'scope'];
/** The draft's fields that Create sends and a patch can change (the dimension is chosen at creation only). */
const DRAFT_FIELDS = ['name', 'description', 'applies_to', 'status', 'disabled_at'] as const;

/** A value of an analytics dimension, on the standard workspace shell with autosave. */
export default function AnalyticsWorkspacePage() {
  const { t } = useTranslation(['master-data', 'common']);
  const { hasLevel } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const axes = useAnalyticsAxes();

  const id = String(params.id || '');
  const isCreate = id === 'new';
  // The value the draft has just created: its fields stay mounted, so that what is typed
  // while it is written, and the field being typed in, are kept.
  const fromDraft = useCreatedFromDraft('analytics_categories', id);
  const canEdit = hasLevel('analytics', 'member');
  const canDelete = hasLevel('analytics', 'admin');

  const detailKey = React.useMemo(() => ['analytics-categories', 'detail', id] as const, [id]);
  const { data: stored, error: loadError } = useQuery({
    queryKey: detailKey,
    queryFn: () => getAnalyticsValue(id),
    enabled: !isCreate && !!id,
  });
  // The new page is the value's own page on a draft: the fields write here, Create sends it.
  const [draft, setDraft] = React.useState<AnalyticsValueDetail>(NEW_VALUE);
  const draftRef = React.useRef(draft);
  const [chosenAxisId, setChosenAxisId] = React.useState<string | null>(null);
  // A new value goes into an enabled dimension: the page's one when it is enabled, else the default.
  const requestedAxisId = searchParams.get('axis');
  const fallbackAxisId = React.useMemo(() => {
    const enabledIds = new Set(axes.enabled.map((axis) => axis.id));
    if (requestedAxisId && enabledIds.has(requestedAxisId)) return requestedAxisId;
    if (axes.defaultAxis && enabledIds.has(axes.defaultAxis.id)) return axes.defaultAxis.id;
    return axes.enabled[0]?.id ?? null;
  }, [axes.defaultAxis, axes.enabled, requestedAxisId]);
  const newAxisId = chosenAxisId ?? fallbackAxisId;
  // Under a dimension restricted to one type, a value cannot be restricted to the other: a choice
  // made under another dimension falls back to OPEX and CAPEX.
  const newAxis = newAxisId ? axes.byId.get(newAxisId) : undefined;
  const newAppliesTo = draft.applies_to && draft.applies_to === excludedLineType(newAxis) ? null : draft.applies_to;
  const excludedRef = React.useRef<LineType | null>(null);
  excludedRef.current = excludedLineType(newAxis);
  const data = isCreate ? { ...draft, axis_id: newAxisId ?? '', applies_to: newAppliesTo } : stored;

  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [pageError, setPageError] = React.useState<string | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  // Autosave never blocks the fields: writes queue one after the other, so a response never
  // overwrites a newer one, and results for a record the user has left are dropped.
  const chainRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const currentIdRef = React.useRef(id);
  currentIdRef.current = id;

  React.useEffect(() => {
    setErrors({});
    setPageError(null);
  }, [id]);

  // The value's own dimension once loaded (a stale link may name another), so prev/next and the way
  // back stay in it; the list's until then.
  const axisId = (isCreate ? null : data?.axis_id) || searchParams.get('axis') || null;

  const listContext = React.useMemo(() => {
    const sp = new URLSearchParams();
    for (const key of LIST_CONTEXT_KEYS) {
      const value = searchParams.get(key);
      if (value) sp.set(key, value);
    }
    if (axisId) sp.set('axis', axisId);
    return sp.toString();
  }, [axisId, searchParams]);

  const nav = useAnalyticsNav({
    id,
    sort: searchParams.get('sort'),
    q: searchParams.get('q'),
    filters: searchParams.get('filters'),
    statusScope: searchParams.get('scope'),
    extraParams: axisId ? { axis_id: axisId } : undefined,
    enabled: !isCreate && !!axisId,
  });

  const goTo = React.useCallback(
    (targetId: string | null, context: string = listContext) => {
      if (targetId) navigate(`${ANALYTICS_LIST_PATH}/${targetId}/overview${context ? `?${context}` : ''}`);
    },
    [listContext, navigate],
  );

  const handleClose = React.useCallback(() => {
    navigate(`${ANALYTICS_LIST_PATH}${listContext ? `?${listContext}` : ''}`);
  }, [listContext, navigate]);

  const afterWrite = React.useCallback((recordId: string) => {
    void queryClient.invalidateQueries({
      queryKey: ['analytics-categories'],
      predicate: (query) => !(query.queryKey[1] === 'detail' && query.queryKey[2] === recordId),
    });
    void queryClient.invalidateQueries({ queryKey: ['analytics-ids'] });
    // The dimensions and, by prefix, each dimension's detail: its value and line counts drive its Delete.
    void queryClient.invalidateQueries({ queryKey: ANALYTICS_AXES_QUERY_KEY });
  }, [queryClient]);

  const patch = React.useCallback(
    (body: AnalyticsValuePatch, field: AnalyticsField): Promise<boolean> => {
      if (isCreate) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
        draftRef.current = { ...draftRef.current, ...body };
        setDraft(draftRef.current);
        return Promise.resolve(true);
      }
      const recordId = data?.id;
      if (!recordId || !canEdit) return Promise.resolve(false);
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      const run = async (): Promise<boolean> => {
        try {
          const saved = await updateAnalyticsValue(recordId, body);
          // Keep the usage counts when the write response leaves them out.
          queryClient.setQueryData(['analytics-categories', 'detail', recordId], (prev: typeof data) => ({ ...prev, ...saved }));
          afterWrite(recordId);
          return true;
        } catch (e) {
          if (currentIdRef.current !== recordId) return false;
          const message = getApiErrorMessage(e, t, t('analytics.messages.saveFailed'));
          const target = analyticsRefusalField(e) ?? field;
          if (target === 'name') setPageError(message);
          else setErrors((prev) => ({ ...prev, [target]: message }));
          return false;
        }
      };
      const result = chainRef.current.then(run, run);
      chainRef.current = result.catch(() => undefined);
      return result;
    },
    [afterWrite, canEdit, data?.id, isCreate, queryClient, t],
  );

  /** `force`: the budget lines using the value lose it (the confirmation said so). */
  const handleDelete = async (force: boolean) => {
    if (!data || !canDelete) return;
    const recordId = data.id;
    setDeleting(true);
    setPageError(null);
    try {
      await (force ? deleteAnalyticsValue(recordId, { force: true }) : deleteAnalyticsValue(recordId));
      setConfirmOpen(false);
      queryClient.removeQueries({ queryKey: ['analytics-categories', 'detail', recordId] });
      afterWrite(recordId);
      // The user may have moved to another value meanwhile: the result is not theirs to see.
      if (currentIdRef.current === recordId) handleClose();
    } catch (e) {
      setConfirmOpen(false);
      if (currentIdRef.current === recordId) {
        setPageError(getApiErrorMessage(e, t, t('analytics.messages.deleteFailed')));
        // Its counts may be stale (a line linked elsewhere): the next Delete asks with the new ones.
        void queryClient.invalidateQueries({ queryKey: ['analytics-categories', 'detail', recordId] });
      }
    } finally {
      setDeleting(false);
    }
  };

  // The draft is created once it has its name and its dimension; the value then opens, every tab
  // available, with Create (kept, back where the creation started) and Cancel (deleted).
  const leave = useCreationLeave(handleClose);
  const title = useCreationTitle({
    requiredMessage: t('analytics.messages.nameRequired'),
    onCancel: leave,
    onCommit: () => creation.attempt(),
  });
  const dimensionMissing = axes.enabled.length > 0 && !newAxisId;
  /** The draft as Create sends it: the trimmed name, no line type the dimension leaves out. */
  const draftAsSent = (): AnalyticsValueDetail => {
    const values = draftRef.current;
    return {
      ...values,
      name: title.current().trim(),
      applies_to: values.applies_to && values.applies_to === excludedRef.current ? null : values.applies_to,
    };
  };
  const creation = useDraftCreation({
    isCreate,
    family: 'analytics_categories',
    apiBase: '/analytics-categories',
    recordId: stored?.id ?? null,
    listPath: `${ANALYTICS_LIST_PATH}${listContext ? `?${listContext}` : ''}`,
    recordLabel: t('analytics.valueCreationRecord'),
    queryKeyPrefixes: ['analytics'],
    ready: () => axes.ready && !!title.current().trim() && !dimensionMissing,
    post: async () => {
      const sent = draftAsSent();
      const { name, description, applies_to, status, disabled_at } = sent;
      setPageError(null);
      try {
        const created = await createAnalyticsValue({
          ...(newAxisId ? { axis_id: newAxisId } : {}),
          name,
          description,
          applies_to,
          status,
          disabled_at,
        });
        void queryClient.invalidateQueries({ queryKey: ['analytics-categories'] });
        void queryClient.invalidateQueries({ queryKey: ['analytics-ids'] });
        void queryClient.invalidateQueries({ queryKey: ANALYTICS_AXES_QUERY_KEY });
        // The page moves to the value with its data in hand, and keeps what was typed since the
        // draft was sent (the next field, while the value was written): saved on the value.
        const createdKey = ['analytics-categories', 'detail', created.id] as const;
        await queryClient.fetchQuery({ queryKey: createdKey, queryFn: () => getAnalyticsValue(created.id) }).catch(() => undefined);
        try {
          await saveEditsSince({
            sent,
            now: draftAsSent,
            fields: DRAFT_FIELDS,
            save: async (edits) => {
              const saved = await updateAnalyticsValue(created.id, edits);
              queryClient.setQueryData(createdKey, (prev: AnalyticsValueDetail | undefined) => ({ ...prev, ...saved }));
              afterWrite(created.id);
            },
          });
        } catch (e) {
          setPageError(getApiErrorMessage(e, t, t('analytics.messages.saveFailed')));
        }
        return { id: created.id, token: created.creation_token, path: `${ANALYTICS_LIST_PATH}/${created.id}/overview${listContext ? `?${listContext}` : ''}` };
      } catch (e) {
        const message = getApiErrorMessage(e, t, t('analytics.messages.createFailed'));
        const field = analyticsRefusalField(e);
        if (field === 'name') title.refuse(message);
        else if (field === 'description' || field === 'axis_id' || field === 'applies_to') setErrors((prev) => ({ ...prev, [field]: message }));
        else setPageError(message);
        return null;
      }
    },
    onError: setPageError,
  });
  React.useEffect(() => { creation.attempt(); }, [creation.attempt, draft, newAxisId, axes.ready]);
  const handleCreate = () => {
    if (creation.beingCreated) {
      creation.finishCreation();
      return;
    }
    if (!canEdit || !axes.ready) return;
    const name = title.require();
    if (dimensionMissing) setErrors((prev) => ({ ...prev, axis_id: t('analytics.messages.dimensionRequired') }));
    if (!name || dimensionMissing) return;
    void creation.createAndLeave();
  };

  const axis = data ? axes.byId.get(data.axis_id) : undefined;
  const dimensionLabel = axis ? axes.label(axis) : analyticsAxisLabel({ name: data?.axis_name ?? null }, t);
  const lineCount = usedLineCount(data?.opex_count, data?.capex_count);
  // Always asked: unused, a plain Delete; used, the dialog says the lines lose it ("Delete anyway"). Disabling stays possible.
  const confirmation = data ? deleteConfirmation(t, { kind: 'value', name: data.name, lineCount }) : null;
  const disabled = !canEdit;

  const actions = isCreate || creation.beingCreated ? (
    <CreationActions
      onCreate={handleCreate}
      onCancel={isCreate ? leave : () => { void creation.cancelCreation(); }}
      busy={!canEdit || creation.cancelling || !axes.ready}
      writing={creation.writing}
    />
  ) : canDelete && data ? (
    <DeleteIconButton onClick={() => setConfirmOpen(true)} disabled={deleting} />
  ) : undefined;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={(pageError || loadError) ? (
          <Alert severity="error" onClose={pageError ? () => setPageError(null) : undefined}>
            {pageError ?? t('analytics.messages.loadFailed')}
          </Alert>
        ) : undefined}
        activeTab="overview"
        tabs={[{ key: 'overview', label: t('shared.labels.overview') }]}
        onTabChange={() => undefined}
        drawerStorageKey={DRAWER_KEY}
        backLabel={t('analytics.title')}
        onBack={isCreate ? leave : handleClose}
        {...(isCreate ? title.shellProps : {
          title: data?.name ?? '',
          canEditTitle: canEdit && !!data,
          onTitleSave: (next: string) => {
            if (data && next !== data.name) void patch({ name: next }, 'name');
          },
        })}
        titleFallback={isCreate ? t('analytics.newValue') : t('analytics.valueFallback')}
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
          previousLabel: t('analytics.previousValue'),
          nextLabel: t('analytics.nextValue'),
        } : undefined}
        actions={actions}
        history={data && !isCreate ? { table: 'analytics_categories', recordId: data.id } : undefined}
        properties={data ? (
          <PropertyGroup>
            {isCreate ? (
              // The dimension is chosen once, at creation.
              <PropertyRow label={t('analytics.fields.dimension')} required>
                <TextField
                  select
                  value={newAxisId ?? ''}
                  onChange={(e) => {
                    setChosenAxisId(e.target.value || null);
                    setErrors((prev) => ({ ...prev, axis_id: undefined }));
                  }}
                  variant="standard"
                  sx={drawerSelectSx}
                  disabled={!axes.ready}
                  error={!!errors.axis_id}
                  helperText={errors.axis_id}
                  inputProps={{ 'aria-label': t('analytics.fields.dimension') }}
                >
                  {axes.enabled.map((option) => (
                    <MenuItem key={option.id} value={option.id} sx={drawerMenuItemSx}>
                      {axes.label(option)}
                    </MenuItem>
                  ))}
                </TextField>
              </PropertyRow>
            ) : (
              <PropertyRow label={t('analytics.fields.dimension')}>
                <Typography data-testid="analytics-value-dimension" sx={{ fontSize: 13, lineHeight: 1.4, py: '6px' }}>
                  {dimensionLabel}
                </Typography>
              </PropertyRow>
            )}
            <ValueAppliesToRow
              value={data}
              axis={axis}
              dimensionLabel={dimensionLabel}
              disabled={disabled}
              error={errors.applies_to}
              onChange={(appliesTo) => void patch({ applies_to: appliesTo }, 'applies_to')}
            />
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: '5px' }}>
              <Typography sx={{ fontSize: 12, lineHeight: 1.3, color: 'kanap.text.tertiary' }}>
                {t('analytics.fields.lifecycle')}
              </Typography>
              <StatusLifecycleField
                status={normalizeStatus(data.status)}
                // The date carries the change (the switch sets it too); the server derives the status from it.
                onStatusChange={() => undefined}
                disabledAt={data.disabled_at}
                onDisabledAtChange={(disabledAt) => {
                  if (disabledAt === data.disabled_at) return;
                  void patch({ status: deriveStatusFromDisabledAt(disabledAt), disabled_at: disabledAt }, 'disabled_at');
                }}
                // Disable now: the status alone, the server sets the end of validity from its own clock.
                onDisableNow={() => void patch({ status: STATUS_DISABLED }, 'disabled_at')}
                disabled={disabled}
                disabledAtError={!!errors.disabled_at}
                disabledAtHelperText={errors.disabled_at}
              />
            </Box>
          </PropertyGroup>
        ) : <Box />}
      >
        {data && (
          <Stack spacing={2.5} sx={{ maxWidth: 900 }}>
            {!isCreate && <Typography data-testid="analytics-value-usage" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
              {/*
                The lines holding this value, by its name in the dimension's list column. The list has no column
                for a disabled dimension and would drop the filter: plain text then (and while the dimension loads).
              */}
              <AnalyticsLinesUsage
                kind="value"
                lineCount={lineCount}
                filters={axis && isAnalyticsActive(axis) ? { [axisListColumn(axis)]: keepValues([data.name]) } : null}
              />
            </Typography>}
            <AnalyticsDescriptionField
              key={fromDraft || isCreate ? 'draft' : data.id}
              value={data.description ?? ''}
              disabled={disabled}
              error={errors.description}
              placeholder={t('analytics.placeholders.valueDescription')}
              onCommit={(description) => void patch({ description }, 'description')}
            />
          </Stack>
        )}
      </PortfolioDetailWorkspaceShell>
      {confirmation && (
        <KanapDialog
          open={confirmOpen}
          title={confirmation.title}
          onClose={() => { if (!deleting) setConfirmOpen(false); }}
          onSave={() => handleDelete(confirmation.force)}
          saveLabel={confirmation.confirmLabel}
          saveVariant="action-danger"
          saveLoading={deleting}
        >
          <Typography data-testid="analytics-delete-confirmation" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
            {confirmation.body}
          </Typography>
        </KanapDialog>
      )}
    </Box>
  );
}

/** "The Nature dimension is for OPEX lines only.", or null when the dimension is used for both types. */
function dimensionUsageHint(t: TFunction, axis: Pick<AnalyticsAxis, 'applies_to'>, dimensionLabel: string): string | null {
  const usage = parseLineTypeUsage(axis.applies_to);
  return usage ? t(`analytics.hints.valueDimensionAppliesTo.${usage}`, { dimension: dimensionLabel }) : null;
}

/** The type a value of this dimension cannot be restricted to: the one a restricted dimension leaves out. */
function excludedLineType(axis: Pick<AnalyticsAxis, 'applies_to'> | undefined): LineType | null {
  const usage = parseLineTypeUsage(axis?.applies_to);
  if (!usage) return null;
  return usage === 'opex' ? 'capex' : 'opex';
}

/**
 * "Used for" of a value: which lines may choose it. Under a dimension restricted to one type, a
 * line says so and the other type cannot be chosen; both types and the dimension's own type stay
 * open, so a redundant restriction can be cleared before the dimension changes type. When lines of the other type
 * hold the value, they keep and show it: one line counts them, with a link opening them in the OPEX
 * or CAPEX list in a new tab (every status, filtered on this value, as a one-off view). That line
 * shows only while the dimension is enabled and shows on those lines.
 */
function ValueAppliesToRow({
  value,
  axis,
  dimensionLabel,
  disabled,
  error,
  onChange,
}: {
  value: AnalyticsValueDetail;
  axis: AnalyticsAxis | undefined;
  dimensionLabel: string;
  disabled: boolean;
  error?: string;
  onChange: (appliesTo: LineType | null) => void;
}) {
  const { t } = useTranslation(['master-data']);
  const appliesTo = parseLineTypeUsage(value.applies_to);
  const dimensionHint = axis ? dimensionUsageHint(t, axis, dimensionLabel) : null;
  const excluded = excludedLineType(axis);
  const conflict = lineTypeUsageConflict(appliesTo, { opex: value.opex_count ?? 0, capex: value.capex_count ?? 0 });
  const shownConflict = conflict && axis && isAnalyticsActive(axis) && axisAppliesTo(axis, conflict.scope) ? conflict : null;
  const link = shownConflict && axis
    ? oneOffListLink(shownConflict.scope, { [axisListColumn(axis)]: keepValues([value.name]) })
    : null;
  return (
    <PropertyRow label={t('shared.lineTypeUsage.label')} hint={dimensionHint ?? undefined}>
      <LineTypeUsageSelect
        value={appliesTo}
        label={t('shared.lineTypeUsage.label')}
        disabled={disabled}
        excluded={excluded}
        error={error}
        onChange={(next) => {
          if (next !== appliesTo) onChange(next);
        }}
      />
      {shownConflict && link && (
        <LineTypeUsageConflictNote testId="analytics-value-applies-to-conflict">
          {t(`analytics.valueAppliesToConflict.${shownConflict.scope}`, { count: shownConflict.count })}{' '}
          <ListLinkAnchor link={link}>{t('analytics.showLines')}</ListLinkAnchor>
        </LineTypeUsageConflictNote>
      )}
    </PropertyRow>
  );
}
