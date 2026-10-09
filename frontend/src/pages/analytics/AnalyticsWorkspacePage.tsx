import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Link, MenuItem, Stack, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useAuth } from '../../auth/AuthContext';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PropertyGroup, PropertyRow } from '../../components/design';
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
import { deriveStatusFromDisabledAt, normalizeStatus } from '../../constants/status';
import { lineTypeUsageConflict, parseLineTypeUsage, type LineType } from '../../constants/lineTypeUsage';
import { axisListColumn, oneOffListLink } from '../reports/reportListLink';
import { openSavedListLink } from '../reports/ReportGroupLinkCell';
import { keepValues } from '../reports/reportAggregates';
import { drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import AnalyticsDescriptionField from './AnalyticsDescriptionField';
import {
  ANALYTICS_LIST_PATH,
  analyticsRefusalField,
  valueUsageLine,
  type AnalyticsField,
} from './analyticsFields';

type FieldErrors = Partial<Record<AnalyticsField, string>>;

const DRAWER_KEY = 'kanap.analyticsValues.drawerOpen';
const LIST_CONTEXT_KEYS = ['sort', 'q', 'filters', 'scope'];

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
  const canEdit = hasLevel('analytics', 'member');
  const canDelete = hasLevel('analytics', 'admin');

  const detailKey = React.useMemo(() => ['analytics-categories', 'detail', id] as const, [id]);
  const { data, error: loadError } = useQuery({
    queryKey: detailKey,
    queryFn: () => getAnalyticsValue(id),
    enabled: !isCreate && !!id,
  });

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

  // The value's own dimension once loaded (a stale link may name another), so prev/next and the way
  // back stay in it; the list's until then.
  const axisId = data?.axis_id || searchParams.get('axis') || null;

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
    [afterWrite, canEdit, data?.id, queryClient, t],
  );

  const handleDelete = async () => {
    if (!data || !canDelete) return;
    const recordId = data.id;
    setDeleting(true);
    setPageError(null);
    try {
      await deleteAnalyticsValue(recordId);
      queryClient.removeQueries({ queryKey: ['analytics-categories', 'detail', recordId] });
      afterWrite(recordId);
      // The user may have moved to another value meanwhile: the result is not theirs to see.
      if (currentIdRef.current === recordId) handleClose();
    } catch (e) {
      if (currentIdRef.current === recordId) setPageError(getApiErrorMessage(e, t, t('analytics.messages.deleteFailed')));
    } finally {
      setDeleting(false);
    }
  };

  if (isCreate) {
    return (
      <ValueCreate
        canCreate={canEdit}
        requestedAxisId={searchParams.get('axis')}
        onClose={handleClose}
        onCreated={(newId, newAxisId) => {
          const sp = new URLSearchParams(listContext);
          sp.set('axis', newAxisId);
          goTo(newId, sp.toString());
        }}
      />
    );
  }

  const axis = data ? axes.byId.get(data.axis_id) : undefined;
  const dimensionLabel = axis ? axes.label(axis) : analyticsAxisLabel({ name: data?.axis_name ?? null }, t);
  const usage = data ? valueUsageLine(t, data.opex_count ?? 0, data.capex_count ?? 0) : null;
  // The server refuses deleting a value in use: Delete stays disabled while the usage line shows.
  const inUse = !!usage;
  const disabled = !canEdit;

  const actions = canDelete && data ? (
    <Button
      variant="action-danger"
      startIcon={<DeleteIcon sx={{ fontSize: '14px !important' }} />}
      size="small"
      onClick={() => void handleDelete()}
      disabled={deleting || inUse}
    >
      {t('common:buttons.delete')}
    </Button>
  ) : undefined;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {(pageError || loadError) && (
        <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={pageError ? () => setPageError(null) : undefined}>
          {pageError ?? t('analytics.messages.loadFailed')}
        </Alert>
      )}
      <PortfolioDetailWorkspaceShell
        activeTab="overview"
        tabs={[{ key: 'overview', label: t('shared.labels.overview') }]}
        onTabChange={() => undefined}
        drawerStorageKey={DRAWER_KEY}
        backLabel={t('analytics.title')}
        onBack={handleClose}
        title={data?.name ?? ''}
        titleFallback={t('analytics.valueFallback')}
        canEditTitle={canEdit && !!data}
        onTitleSave={(next) => {
          if (data && next !== data.name) void patch({ name: next }, 'name');
        }}
        nav={nav.total > 0 ? {
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
        properties={data ? (
          <PropertyGroup>
            <PropertyRow label={t('analytics.fields.dimension')}>
              <Typography data-testid="analytics-value-dimension" sx={{ fontSize: 13, lineHeight: 1.4, py: '6px' }}>
                {dimensionLabel}
              </Typography>
            </PropertyRow>
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
            {usage && (
              <Typography data-testid="analytics-value-usage" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
                {usage}
              </Typography>
            )}
            <AnalyticsDescriptionField
              key={data.id}
              value={data.description ?? ''}
              disabled={disabled}
              error={errors.description}
              placeholder={t('analytics.placeholders.valueDescription')}
              onCommit={(description) => void patch({ description }, 'description')}
            />
          </Stack>
        )}
      </PortfolioDetailWorkspaceShell>
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
  const save = link?.save;
  return (
    <PropertyRow label={t('shared.lineTypeUsage.label')} helperText={dimensionHint}>
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
          <Link
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ fontSize: 12 }}
            // Filters too long for a URL are saved first.
            onClick={save ? (event) => { event.preventDefault(); void openSavedListLink({ ...link, save }); } : undefined}
          >
            {t('analytics.showLines')}
          </Link>
        </LineTypeUsageConflictNote>
      )}
    </PropertyRow>
  );
}

function ValueCreate({
  canCreate,
  requestedAxisId,
  onClose,
  onCreated,
}: {
  canCreate: boolean;
  requestedAxisId: string | null;
  onClose: () => void;
  onCreated: (id: string, axisId: string) => void;
}) {
  const { t } = useTranslation(['master-data', 'common']);
  const queryClient = useQueryClient();
  const axes = useAnalyticsAxes();
  const [chosenAxisId, setChosenAxisId] = React.useState<string | null>(null);
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [appliesTo, setAppliesTo] = React.useState<LineType | null>(null);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // A new value goes into an enabled dimension: the page's one when it is enabled, else the default.
  const fallbackAxisId = React.useMemo(() => {
    const enabledIds = new Set(axes.enabled.map((axis) => axis.id));
    if (requestedAxisId && enabledIds.has(requestedAxisId)) return requestedAxisId;
    if (axes.defaultAxis && enabledIds.has(axes.defaultAxis.id)) return axes.defaultAxis.id;
    return axes.enabled[0]?.id ?? null;
  }, [axes.defaultAxis, axes.enabled, requestedAxisId]);
  const axisId = chosenAxisId ?? fallbackAxisId;
  const chosenAxis = axisId ? axes.byId.get(axisId) : undefined;
  // Under a dimension restricted to one type, a value cannot be restricted to the other: a choice
  // made under another dimension falls back to OPEX and CAPEX.
  const dimensionHint = chosenAxis ? dimensionUsageHint(t, chosenAxis, axes.label(chosenAxis)) : null;
  const excluded = excludedLineType(chosenAxis);
  const shownAppliesTo = appliesTo && appliesTo === excluded ? null : appliesTo;

  const handleCreate = async () => {
    if (!canCreate || submitting) return;
    const trimmed = name.trim();
    const nextErrors: FieldErrors = {};
    if (!trimmed) nextErrors.name = t('analytics.messages.nameRequired');
    if (axes.enabled.length > 0 && !axisId) nextErrors.axis_id = t('analytics.messages.dimensionRequired');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const saved = await createAnalyticsValue({
        ...(axisId ? { axis_id: axisId } : {}),
        name: trimmed,
        description: description.trim() || null,
        applies_to: shownAppliesTo,
      });
      void queryClient.invalidateQueries({ queryKey: ['analytics-categories'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics-ids'] });
      void queryClient.invalidateQueries({ queryKey: ANALYTICS_AXES_QUERY_KEY });
      onCreated(saved.id, saved.axis_id ?? axisId ?? '');
    } catch (e) {
      const message = getApiErrorMessage(e, t, t('analytics.messages.createFailed'));
      const field = analyticsRefusalField(e);
      if (field === 'name' || field === 'description' || field === 'axis_id' || field === 'applies_to') setErrors({ [field]: message });
      else setServerError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        activeTab="overview"
        tabs={[{ key: 'overview', label: t('shared.labels.overview') }]}
        onTabChange={() => undefined}
        drawerStorageKey={DRAWER_KEY}
        backLabel={t('analytics.title')}
        onBack={onClose}
        title={name}
        titleFallback={t('analytics.newValue')}
        isCreate
        actions={(
          <Button
            variant="contained"
            size="small"
            onClick={() => void handleCreate()}
            disabled={!canCreate || submitting || !axes.ready}
          >
            {t('common:buttons.create')}
          </Button>
        )}
      >
        <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
          <PropertyRow label={t('analytics.fields.dimension')} required valueSx={{ maxWidth: 520 }}>
            <TextField
              select
              value={axisId ?? ''}
              onChange={(e) => setChosenAxisId(e.target.value || null)}
              variant="standard"
              sx={drawerSelectSx}
              disabled={!axes.ready}
              error={!!errors.axis_id}
              helperText={errors.axis_id}
              inputProps={{ 'aria-label': t('analytics.fields.dimension') }}
            >
              {axes.enabled.map((axis) => (
                <MenuItem key={axis.id} value={axis.id} sx={drawerMenuItemSx}>
                  {axes.label(axis)}
                </MenuItem>
              ))}
            </TextField>
          </PropertyRow>
          <PropertyRow label={t('shared.lineTypeUsage.label')} helperText={dimensionHint} valueSx={{ maxWidth: 520 }}>
            <LineTypeUsageSelect
              value={shownAppliesTo}
              label={t('shared.lineTypeUsage.label')}
              excluded={excluded}
              error={errors.applies_to}
              onChange={setAppliesTo}
            />
          </PropertyRow>
          <PropertyRow label={t('analytics.fields.name')} required valueSx={{ maxWidth: 520 }}>
            <TextField
              value={name}
              onChange={(e) => setName(e.target.value)}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('analytics.placeholders.valueName')}
              error={!!errors.name}
              helperText={errors.name}
              inputProps={{ 'aria-label': t('analytics.fields.name'), autoComplete: 'off' }}
            />
          </PropertyRow>
          <PropertyRow label={t('analytics.fields.description')} valueSx={{ maxWidth: 520 }}>
            <TextField
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              minRows={2}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('analytics.placeholders.valueDescription')}
              error={!!errors.description}
              helperText={errors.description}
              inputProps={{ 'aria-label': t('analytics.fields.description') }}
            />
          </PropertyRow>
          {serverError && <Alert severity="error">{serverError}</Alert>}
        </Stack>
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}
