import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PropertyGroup, PropertyRow } from '../../components/design';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import { ANALYTICS_AXES_QUERY_KEY, useAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { useAnalyticsDimensionNav } from '../../hooks/useAnalyticsNav';
import {
  createAnalyticsAxis,
  deleteAnalyticsAxis,
  getAnalyticsAxis,
  updateAnalyticsAxis,
  type AnalyticsAxisDetail,
  type AnalyticsAxisPatch,
} from '../../services/analytics';
import { deriveStatusFromDisabledAt, normalizeStatus } from '../../constants/status';
import { drawerFieldValueSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import {
  ANALYTICS_AXIS_DETAIL_KEY,
  ANALYTICS_DIMENSIONS_PATH,
  ANALYTICS_LIST_PATH,
  DIMENSION_CODE_PATTERN,
  analyticsRefusalField,
  dimensionDeleteBlock,
  dimensionUsageLine,
  proposeDimensionCode,
  type AnalyticsField,
} from './analyticsFields';
import AnalyticsDescriptionField from './AnalyticsDescriptionField';
import { useFieldDraft } from './useFieldDraft';

type FieldErrors = Partial<Record<AnalyticsField, string>>;
/** `title` is the click-to-edit name in the header: its refusals show above the workspace. */
type PatchSource = AnalyticsField | 'title';

const DRAWER_KEY = 'kanap.analyticsDimensions.drawerOpen';

export default function AnalyticsDimensionWorkspacePage() {
  const { t } = useTranslation(['master-data', 'common']);
  const { hasLevel } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const queryClient = useQueryClient();
  const axes = useAnalyticsAxes();

  const id = String(params.id || '');
  const isCreate = id === 'new';
  const canEdit = hasLevel('analytics', 'member');
  const canDelete = hasLevel('analytics', 'admin');

  const detailKey = React.useMemo(() => [...ANALYTICS_AXIS_DETAIL_KEY, id], [id]);
  const { data, error: loadError } = useQuery({
    queryKey: detailKey,
    queryFn: () => getAnalyticsAxis(id),
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

  const nav = useAnalyticsDimensionNav(id, { enabled: !isCreate });

  const goTo = React.useCallback(
    (targetId: string | null) => {
      if (targetId) navigate(`${ANALYTICS_DIMENSIONS_PATH}/${targetId}/overview`);
    },
    [navigate],
  );

  const handleClose = React.useCallback(() => {
    navigate(isCreate || !id ? ANALYTICS_LIST_PATH : `${ANALYTICS_LIST_PATH}?axis=${encodeURIComponent(id)}`);
  }, [id, isCreate, navigate]);

  const patch = React.useCallback(
    (body: AnalyticsAxisPatch, source: PatchSource): Promise<boolean> => {
      const recordId = data?.id;
      if (!recordId || !canEdit) return Promise.resolve(false);
      if (source !== 'title') setErrors((prev) => ({ ...prev, [source]: undefined }));
      const run = async (): Promise<boolean> => {
        try {
          const saved = await updateAnalyticsAxis(recordId, body);
          queryClient.setQueryData([...ANALYTICS_AXIS_DETAIL_KEY, recordId], saved);
          void queryClient.invalidateQueries({ queryKey: ANALYTICS_AXES_QUERY_KEY, exact: true });
          return true;
        } catch (e) {
          if (currentIdRef.current !== recordId) return false;
          const message = getApiErrorMessage(e, t, t('analytics.messages.dimensionSaveFailed'));
          if (source === 'title') {
            setPageError(message);
          } else {
            const target = analyticsRefusalField(e) ?? source;
            setErrors((prev) => ({ ...prev, [target]: message }));
          }
          return false;
        }
      };
      const result = chainRef.current.then(run, run);
      chainRef.current = result.catch(() => undefined);
      return result;
    },
    [canEdit, data?.id, queryClient, t],
  );

  const handleDelete = async () => {
    if (!data || !canDelete) return;
    const recordId = data.id;
    setDeleting(true);
    setPageError(null);
    try {
      await deleteAnalyticsAxis(recordId);
      queryClient.removeQueries({ queryKey: [...ANALYTICS_AXIS_DETAIL_KEY, recordId] });
      void queryClient.invalidateQueries({ queryKey: ANALYTICS_AXES_QUERY_KEY, exact: true });
      // The user may have moved to another dimension meanwhile: the result is not theirs to see.
      if (currentIdRef.current === recordId) navigate(ANALYTICS_LIST_PATH);
    } catch (e) {
      if (currentIdRef.current === recordId) {
        setPageError(getApiErrorMessage(e, t, t('analytics.messages.dimensionDeleteFailed')));
      }
    } finally {
      setDeleting(false);
    }
  };

  if (isCreate) {
    return <DimensionCreate canCreate={canEdit} onClose={handleClose} onCreated={goTo} />;
  }

  const isDefault = !!data?.is_default;
  const disabled = !canEdit;
  const usage = data ? dimensionUsageLine(t, data.value_count ?? 0, data.opex_count ?? 0, data.capex_count ?? 0) : null;
  // The server refuses this delete anyway; the page already knows, so it says why up front.
  const deleteBlock = data ? dimensionDeleteBlock(t, data.value_count ?? 0) : null;

  // The default dimension is never deleted: no button, its reason sits under the lifecycle.
  const actions = canDelete && data && !isDefault ? (
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
          {pageError ?? t('analytics.messages.dimensionLoadFailed')}
        </Alert>
      )}
      <PortfolioDetailWorkspaceShell
        activeTab="overview"
        tabs={[{ key: 'overview', label: t('shared.labels.overview') }]}
        onTabChange={() => undefined}
        drawerStorageKey={DRAWER_KEY}
        backLabel={t('analytics.title')}
        onBack={handleClose}
        // The default dimension without a name shows its translated label, like every other screen.
        title={data ? axes.label(data) : ''}
        titleFallback={t('analytics.dimensionFallback')}
        canEditTitle={canEdit && !!data}
        onTitleSave={(next) => {
          if (data && next !== data.name) void patch({ name: next }, 'title');
        }}
        nav={nav.total > 0 ? {
          currentIndex: nav.index + 1,
          totalCount: nav.total,
          hasPrev: nav.hasPrev,
          hasNext: nav.hasNext,
          onPrev: () => goTo(nav.prevId),
          onNext: () => goTo(nav.nextId),
          previousLabel: t('analytics.previousDimension'),
          nextLabel: t('analytics.nextDimension'),
        } : undefined}
        actions={actions}
        properties={data ? (
          <DimensionProperties
            key={data.id}
            axis={data}
            defaultLabel={t('analytics.analyticsCategoryFallback')}
            disabled={disabled}
            errors={errors}
            onNameCommit={(name) => void patch({ name }, 'name')}
            onCodeCommit={(code) => void patch({ code }, 'code')}
            onOrderCommit={(sortOrder) => void patch({ sort_order: sortOrder }, 'sort_order')}
            onDisabledAtChange={(disabledAt) => {
              if (disabledAt === data.disabled_at) return;
              void patch({ status: deriveStatusFromDisabledAt(disabledAt), disabled_at: disabledAt }, 'disabled_at');
            }}
            onFieldError={(field, message) => setErrors((prev) => ({ ...prev, [field]: message }))}
          />
        ) : <Box />}
      >
        {data && (
          <Stack spacing={2.5} sx={{ maxWidth: 900 }}>
            <Box>
              <Typography data-testid="analytics-dimension-usage" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
                {usage}
              </Typography>
              {canDelete && !isDefault && deleteBlock && (
                <Typography data-testid="analytics-dimension-delete-block" sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
                  {deleteBlock}
                </Typography>
              )}
            </Box>
            <AnalyticsDescriptionField
              key={data.id}
              value={data.description ?? ''}
              disabled={disabled}
              error={errors.description}
              placeholder={t('analytics.placeholders.dimensionDescription')}
              onCommit={(description) => void patch({ description }, 'description')}
            />
          </Stack>
        )}
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}

function DimensionProperties({
  axis,
  defaultLabel,
  disabled,
  errors,
  onNameCommit,
  onCodeCommit,
  onOrderCommit,
  onDisabledAtChange,
  onFieldError,
}: {
  axis: AnalyticsAxisDetail;
  defaultLabel: string;
  disabled: boolean;
  errors: FieldErrors;
  onNameCommit: (name: string | null) => void;
  onCodeCommit: (code: string) => void;
  onOrderCommit: (sortOrder: number) => void;
  onDisabledAtChange: (disabledAt: string | null) => void;
  /** Shows (or clears, with undefined) a refusal found before any request. */
  onFieldError: (field: AnalyticsField, message: string | undefined) => void;
}) {
  const { t } = useTranslation(['master-data', 'common']);
  // A refused value stays in its field so it can be corrected; a stored change replaces it.
  const nameDraft = useFieldDraft(axis.name ?? '');
  const codeDraft = useFieldDraft(axis.code);
  const orderDraft = useFieldDraft(String(axis.sort_order ?? 0));
  const name = nameDraft.draft;
  const code = codeDraft.draft;
  const order = orderDraft.draft;

  const commitName = () => {
    nameDraft.onBlur();
    const trimmed = name.trim();
    if (trimmed === (axis.name ?? '')) return;
    if (!trimmed) {
      // Only the default dimension may go back to the translated label; the others need a name.
      if (axis.is_default) onNameCommit(null);
      else nameDraft.setDraft(axis.name ?? '');
      return;
    }
    onNameCommit(trimmed);
  };

  const commitCode = () => {
    codeDraft.onBlur();
    onFieldError('code', undefined);
    const trimmed = code.trim();
    if (!trimmed) {
      codeDraft.setDraft(axis.code);
      return;
    }
    if (trimmed === axis.code) return;
    if (!DIMENSION_CODE_PATTERN.test(trimmed)) {
      onFieldError('code', t('analytics.messages.codeInvalid'));
      return;
    }
    onCodeCommit(trimmed);
  };

  const commitOrder = () => {
    orderDraft.onBlur();
    onFieldError('sort_order', undefined);
    const trimmed = order.trim();
    if (!trimmed) {
      orderDraft.setDraft(String(axis.sort_order ?? 0));
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isInteger(parsed)) {
      onFieldError('sort_order', t('analytics.messages.orderInvalid'));
      return;
    }
    if (parsed !== axis.sort_order) onOrderCommit(parsed);
  };

  const blurOnEnter = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
  };

  return (
    <>
      <PropertyGroup>
        <PropertyRow
          label={t('analytics.fields.name')}
          required={!axis.is_default}
          helperText={axis.is_default ? t('analytics.hints.nameDefault', { label: defaultLabel }) : undefined}
        >
          <TextField
            value={name}
            onChange={(event) => nameDraft.setDraft(event.target.value)}
            onFocus={nameDraft.onFocus}
            onBlur={commitName}
            onKeyDown={blurOnEnter}
            variant="standard"
            sx={drawerFieldValueSx}
            placeholder={axis.is_default ? defaultLabel : t('analytics.placeholders.dimensionName')}
            disabled={disabled}
            error={!!errors.name}
            helperText={errors.name}
            inputProps={{ 'aria-label': t('analytics.fields.name'), autoComplete: 'off' }}
          />
        </PropertyRow>
        <PropertyRow
          label={t('analytics.fields.code')}
          required
          helperText={t(axis.is_default ? 'analytics.hints.codeDefault' : 'analytics.hints.code', { code: axis.code })}
        >
          <TextField
            value={code}
            onChange={(event) => codeDraft.setDraft(event.target.value)}
            onFocus={codeDraft.onFocus}
            onBlur={commitCode}
            onKeyDown={blurOnEnter}
            variant="standard"
            sx={drawerFieldValueSx}
            placeholder={t('analytics.placeholders.dimensionCode')}
            disabled={disabled}
            error={!!errors.code}
            helperText={errors.code}
            inputProps={{ 'aria-label': t('analytics.fields.code'), autoComplete: 'off', spellCheck: false }}
          />
        </PropertyRow>
        <PropertyRow label={t('analytics.fields.order')} helperText={t('analytics.hints.order')}>
          <TextField
            value={order}
            onChange={(event) => orderDraft.setDraft(event.target.value)}
            onFocus={orderDraft.onFocus}
            onBlur={commitOrder}
            onKeyDown={blurOnEnter}
            variant="standard"
            sx={drawerFieldValueSx}
            disabled={disabled}
            error={!!errors.sort_order}
            helperText={errors.sort_order}
            inputProps={{ 'aria-label': t('analytics.fields.order'), inputMode: 'numeric', autoComplete: 'off' }}
          />
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: '5px' }}>
          <Typography sx={{ fontSize: 12, lineHeight: 1.3, color: 'kanap.text.tertiary' }}>
            {t('analytics.fields.lifecycle')}
          </Typography>
          <StatusLifecycleField
            status={normalizeStatus(axis.status)}
            // The date carries the change (the switch sets it too); the server derives the status from it.
            onStatusChange={() => undefined}
            disabledAt={axis.disabled_at}
            onDisabledAtChange={onDisabledAtChange}
            disabled={disabled || axis.is_default}
            disabledAtError={!!errors.disabled_at}
            disabledAtHelperText={errors.disabled_at}
          />
          {axis.is_default && (
            <Typography data-testid="analytics-dimension-locked" sx={{ fontSize: 12, lineHeight: 1.35, color: 'kanap.text.tertiary' }}>
              {t('analytics.hints.defaultLocked')}
            </Typography>
          )}
        </Box>
      </PropertyGroup>
    </>
  );
}

type CreateForm = {
  name: string;
  code: string;
  description: string;
  order: string;
};

const EMPTY_FORM: CreateForm = { name: '', code: '', description: '', order: '' };

function DimensionCreate({
  canCreate,
  onClose,
  onCreated,
}: {
  canCreate: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation(['master-data', 'common']);
  const queryClient = useQueryClient();
  const axes = useAnalyticsAxes();
  const [form, setForm] = React.useState<CreateForm>(EMPTY_FORM);
  // The code follows the name until the user types one.
  const [codeTouched, setCodeTouched] = React.useState(false);
  const [orderTouched, setOrderTouched] = React.useState(false);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  // A new dimension goes last unless the user picks another place.
  const proposedOrder = React.useMemo(
    () => (axes.axes.length > 0 ? Math.max(...axes.axes.map((axis) => axis.sort_order ?? 0)) + 1 : 0),
    [axes.axes],
  );
  const order = orderTouched ? form.order : (axes.ready ? String(proposedOrder) : '');
  const code = codeTouched ? form.code : proposeDimensionCode(form.name);

  const update = (next: Partial<CreateForm>) => setForm((prev) => ({ ...prev, ...next }));

  const handleCreate = async () => {
    if (!canCreate || submitting) return;
    const name = form.name.trim();
    const trimmedCode = code.trim();
    const trimmedOrder = order.trim();
    const nextErrors: FieldErrors = {};
    if (!name) nextErrors.name = t('analytics.messages.nameRequired');
    if (!trimmedCode) nextErrors.code = t('analytics.messages.codeRequired');
    else if (!DIMENSION_CODE_PATTERN.test(trimmedCode)) nextErrors.code = t('analytics.messages.codeInvalid');
    if (trimmedOrder && !Number.isInteger(Number(trimmedOrder))) nextErrors.sort_order = t('analytics.messages.orderInvalid');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const saved = await createAnalyticsAxis({
        code: trimmedCode,
        name,
        description: form.description.trim() || null,
        ...(trimmedOrder ? { sort_order: Number(trimmedOrder) } : {}),
      });
      void queryClient.invalidateQueries({ queryKey: ANALYTICS_AXES_QUERY_KEY, exact: true });
      onCreated(saved.id);
    } catch (e) {
      const message = getApiErrorMessage(e, t, t('analytics.messages.dimensionCreateFailed'));
      const field = analyticsRefusalField(e);
      if (field === 'name' || field === 'code' || field === 'description' || field === 'sort_order') setErrors({ [field]: message });
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
        title={form.name}
        titleFallback={t('analytics.newDimension')}
        isCreate
        actions={(
          <Button variant="contained" size="small" onClick={() => void handleCreate()} disabled={!canCreate || submitting}>
            {t('common:buttons.create')}
          </Button>
        )}
      >
        <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
          <PropertyRow label={t('analytics.fields.name')} required valueSx={{ maxWidth: 520 }}>
            <TextField
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('analytics.placeholders.dimensionName')}
              error={!!errors.name}
              helperText={errors.name}
              inputProps={{ 'aria-label': t('analytics.fields.name'), autoComplete: 'off' }}
            />
          </PropertyRow>
          <PropertyRow label={t('analytics.fields.code')} required helperText={t('analytics.hints.codeCreate')} valueSx={{ maxWidth: 520 }}>
            <TextField
              value={code}
              onChange={(e) => {
                setCodeTouched(true);
                update({ code: e.target.value });
              }}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('analytics.placeholders.dimensionCode')}
              error={!!errors.code}
              helperText={errors.code}
              inputProps={{ 'aria-label': t('analytics.fields.code'), autoComplete: 'off', spellCheck: false }}
            />
          </PropertyRow>
          <PropertyRow label={t('analytics.fields.order')} helperText={t('analytics.hints.order')} valueSx={{ maxWidth: 520 }}>
            <TextField
              value={order}
              onChange={(e) => {
                setOrderTouched(true);
                update({ order: e.target.value });
              }}
              variant="standard"
              sx={drawerFieldValueSx}
              error={!!errors.sort_order}
              helperText={errors.sort_order}
              inputProps={{ 'aria-label': t('analytics.fields.order'), inputMode: 'numeric', autoComplete: 'off' }}
            />
          </PropertyRow>
          <PropertyRow label={t('analytics.fields.description')} valueSx={{ maxWidth: 520 }}>
            <TextField
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              multiline
              minRows={2}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('analytics.placeholders.dimensionDescription')}
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
