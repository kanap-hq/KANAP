import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Stack, Switch, TextField, Typography } from '@mui/material';
import { CreationActions, useCreationLeave, useCreationTitle } from '../../components/workspace/creation';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { isDataAccessLimited } from '../../auth/dataAccess';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { KanapDialog, PropertyGroup, PropertyRow } from '../../components/design';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import { ANALYTICS_AXES_QUERY_KEY, useAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { useAnalyticsDimensionNav } from '../../hooks/useAnalyticsNav';
import {
  createAnalyticsAxis,
  deleteAnalyticsAxis,
  getAnalyticsAxis,
  isAnalyticsActive,
  updateAnalyticsAxis,
  type AnalyticsAxisDetail,
  type AnalyticsAxisPatch,
} from '../../services/analytics';
import { STATUS_DISABLED, deriveStatusFromDisabledAt, normalizeStatus } from '../../constants/status';
import { drawerFieldValueSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import {
  ANALYTICS_AXIS_DETAIL_KEY,
  ANALYTICS_DIMENSIONS_PATH,
  ANALYTICS_LIST_PATH,
  DIMENSION_CODE_PATTERN,
  analyticsRefusalField,
  deleteConfirmation,
  proposeDimensionCode,
  requiredMissingLine,
  requiredUnusableLine,
  usedLineCount,
  type AnalyticsField,
} from './analyticsFields';
import AnalyticsLinesUsage from './AnalyticsLinesUsage';
import AnalyticsDescriptionField from './AnalyticsDescriptionField';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import LineTypeUsageSelect, { LineTypeUsageConflictNote } from '../../components/fields/LineTypeUsageSelect';
import { lineTypeUsageConflict, parseLineTypeUsage, type LineType } from '../../constants/lineTypeUsage';
import { axisListColumn, oneOffListLink } from '../reports/reportListLink';
import { dropValues, keepValues } from '../reports/reportAggregates';
import ListLinkAnchor from '../reports/ListLinkAnchor';
import DeleteIconButton from '../../components/workspace/DeleteIconButton';

type FieldErrors = Partial<Record<AnalyticsField, string>>;
/** `title` is the click-to-edit name in the header: its refusals show above the workspace. */
type PatchSource = AnalyticsField | 'title';

const DRAWER_KEY = 'kanap.analyticsDimensions.drawerOpen';
/** What a new dimension starts from. */
const NEW_DIMENSION: AnalyticsAxisDetail = {
  id: '', code: '', name: '', description: null, sort_order: 0, is_default: false, applies_to: null, required: false,
  open_values: false, status: 'enabled', disabled_at: null, value_count: 0, opex_count: 0, capex_count: 0,
};

export default function AnalyticsDimensionWorkspacePage() {
  const { t } = useTranslation(['master-data', 'common']);
  const { hasLevel, dataAccess } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const queryClient = useQueryClient();
  const axes = useAnalyticsAxes();

  const id = String(params.id || '');
  const isCreate = id === 'new';
  const canEdit = hasLevel('analytics', 'member');
  const canDelete = hasLevel('analytics', 'admin');
  // Who may create values from a line is set by people who administer dimensions with access to all
  // data (spec §3.5, §7.9): a limited person never sees the switch.
  const canSetOpenValues = canEdit && !isDataAccessLimited(dataAccess);

  const detailKey = React.useMemo(() => [...ANALYTICS_AXIS_DETAIL_KEY, id], [id]);
  const { data: stored, error: loadError } = useQuery({
    queryKey: detailKey,
    queryFn: () => getAnalyticsAxis(id),
    enabled: !isCreate && !!id,
    // The admin fills the lines without a value in the list tab: coming back shows the new count.
    refetchOnWindowFocus: true,
  });
  // The new page is the dimension's own page on a draft: the fields write here, Create sends it.
  const [draft, setDraft] = React.useState<AnalyticsAxisDetail>(NEW_DIMENSION);
  const draftRef = React.useRef(draft);
  // The code follows the name typed in the header until the user types one.
  const [newName, setNewName] = React.useState('');
  const [codeTouched, setCodeTouched] = React.useState(false);
  const newCode = codeTouched ? draft.code : proposeDimensionCode(newName);
  const data = isCreate ? { ...draft, name: newName, code: newCode } : stored;

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
      if (isCreate) {
        if (source !== 'title') setErrors((prev) => ({ ...prev, [source]: undefined }));
        if (body.code !== undefined) setCodeTouched(true);
        draftRef.current = { ...draftRef.current, ...body };
        setDraft(draftRef.current);
        return Promise.resolve(true);
      }
      const recordId = data?.id;
      if (!recordId || !canEdit) return Promise.resolve(false);
      if (source !== 'title') setErrors((prev) => ({ ...prev, [source]: undefined }));
      const run = async (): Promise<boolean> => {
        try {
          const saved = await updateAnalyticsAxis(recordId, body);
          // The response is the full detail, the lines without a value included.
          queryClient.setQueryData<AnalyticsAxisDetail>(
            [...ANALYTICS_AXIS_DETAIL_KEY, recordId],
            (prev) => (prev ? { ...prev, ...saved } : saved),
          );
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
    [canEdit, data?.id, isCreate, queryClient, t],
  );

  /** `force`: the values go too, and the lines lose their value on it (the confirmation said so). */
  const handleDelete = async (force: boolean) => {
    if (!data || !canDelete) return;
    const recordId = data.id;
    setDeleting(true);
    setPageError(null);
    try {
      await (force ? deleteAnalyticsAxis(recordId, { force: true }) : deleteAnalyticsAxis(recordId));
      setConfirmOpen(false);
      queryClient.removeQueries({ queryKey: [...ANALYTICS_AXIS_DETAIL_KEY, recordId] });
      void queryClient.invalidateQueries({ queryKey: ANALYTICS_AXES_QUERY_KEY, exact: true });
      // The values and the lines' values on it are gone too.
      void queryClient.invalidateQueries({ queryKey: ['analytics-categories'] });
      void queryClient.invalidateQueries({ queryKey: ['analytics-ids'] });
      // The user may have moved to another dimension meanwhile: the result is not theirs to see.
      if (currentIdRef.current === recordId) navigate(ANALYTICS_LIST_PATH);
    } catch (e) {
      setConfirmOpen(false);
      if (currentIdRef.current === recordId) {
        setPageError(getApiErrorMessage(e, t, t('analytics.messages.dimensionDeleteFailed')));
        // Its counts may be stale (a value added elsewhere): the next Delete asks with the new ones.
        void queryClient.invalidateQueries({ queryKey: [...ANALYTICS_AXIS_DETAIL_KEY, recordId] });
      }
    } finally {
      setDeleting(false);
    }
  };

  // Create sends the draft with the header's name, then goes back where the creation started.
  const leave = useCreationLeave(handleClose);
  const title = useCreationTitle({ requiredMessage: t('analytics.messages.nameRequired'), onCancel: leave, onChange: setNewName });
  const [creating, setCreating] = React.useState(false);
  const handleCreate = async () => {
    if (!canEdit || creating) return;
    const name = title.require();
    const code = newCode.trim();
    let codeError: string | undefined;
    if (!code) codeError = t('analytics.messages.codeRequired');
    else if (!DIMENSION_CODE_PATTERN.test(code)) codeError = t('analytics.messages.codeInvalid');
    if (codeError) setErrors((prev) => ({ ...prev, code: codeError }));
    if (!name || codeError) return;
    const form = draftRef.current;
    setCreating(true);
    setPageError(null);
    try {
      await createAnalyticsAxis({
        code,
        name,
        description: form.description,
        applies_to: form.applies_to,
        required: form.required,
        ...(canSetOpenValues ? { open_values: !!form.open_values } : {}),
        status: form.status,
        disabled_at: form.disabled_at,
      });
      void queryClient.invalidateQueries({ queryKey: ANALYTICS_AXES_QUERY_KEY, exact: true });
      leave();
    } catch (e) {
      const message = getApiErrorMessage(e, t, t('analytics.messages.dimensionCreateFailed'));
      const field = analyticsRefusalField(e);
      if (field === 'name') title.refuse(message);
      else if (field) setErrors((prev) => ({ ...prev, [field]: message }));
      else setPageError(message);
    } finally {
      setCreating(false);
    }
  };

  const isDefault = !!data?.is_default;
  const disabled = !canEdit;
  const valueCount = data?.value_count ?? 0;
  // Always asked: without values a plain Delete; with values the dialog says what goes with it (from the detail's counts).
  const confirmation = data ? deleteConfirmation(t, {
    kind: 'dimension',
    name: axes.label(data),
    valueCount,
    lineCount: usedLineCount(data.opex_count, data.capex_count),
  }) : null;

  // The default dimension is never deleted: no button, its reason sits under the lifecycle.
  const actions = isCreate ? (
    <CreationActions onCreate={() => void handleCreate()} onCancel={leave} busy={!canEdit || creating} />
  ) : canDelete && data && !isDefault ? (
    <DeleteIconButton onClick={() => setConfirmOpen(true)} disabled={deleting} />
  ) : undefined;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={(pageError || loadError) ? (
          <Alert severity="error" onClose={pageError ? () => setPageError(null) : undefined}>
            {pageError ?? t('analytics.messages.dimensionLoadFailed')}
          </Alert>
        ) : undefined}
        activeTab="overview"
        tabs={[{ key: 'overview', label: t('shared.labels.overview') }]}
        onTabChange={() => undefined}
        drawerStorageKey={DRAWER_KEY}
        backLabel={t('analytics.title')}
        onBack={isCreate ? leave : handleClose}
        {...(isCreate ? title.shellProps : {
          // The default dimension without a name shows its translated label, like every other screen.
          title: data ? axes.label(data) : '',
          canEditTitle: canEdit && !!data,
          onTitleSave: (next: string) => {
            if (data && next !== data.name) void patch({ name: next }, 'title');
          },
        })}
        titleFallback={isCreate ? t('analytics.newDimension') : t('analytics.dimensionFallback')}
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
          previousLabel: t('analytics.previousDimension'),
          nextLabel: t('analytics.nextDimension'),
        } : undefined}
        actions={actions}
        history={data && !isCreate ? { table: 'analytics_axes', recordId: data.id } : undefined}
        properties={data ? (
          <DimensionProperties
            key={data.id}
            axis={data}
            defaultLabel={t('analytics.analyticsCategoryFallback')}
            disabled={disabled}
            errors={errors}
            onNameCommit={(name) => void patch({ name }, 'name')}
            onCodeCommit={(code) => void patch({ code }, 'code')}
            onAppliesToChange={(appliesTo) => void patch({ applies_to: appliesTo }, 'applies_to')}
            onRequiredChange={(required) => void patch({ required }, 'required')}
            canSetOpenValues={canSetOpenValues}
            onOpenValuesChange={(openValues) => void patch({ open_values: openValues }, 'open_values')}
            onDisabledAtChange={(disabledAt) => {
              if (disabledAt === data.disabled_at) return;
              void patch({ status: deriveStatusFromDisabledAt(disabledAt), disabled_at: disabledAt }, 'disabled_at');
            }}
            // Disable now: the status alone, the server sets the end of validity from its own clock.
            onDisableNow={() => void patch({ status: STATUS_DISABLED }, 'disabled_at')}
            onFieldError={(field, message) => setErrors((prev) => ({ ...prev, [field]: message }))}
          />
        ) : <Box />}
      >
        {data && (
          <Stack spacing={2.5} sx={{ maxWidth: 900 }}>
            {!isCreate && <Box>
              <Typography data-testid="analytics-dimension-usage" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
                {valueCount > 0 ? (
                  <>
                    {t('analytics.usage.values', { count: valueCount })}
                    {' · '}
                    {/*
                      Every line with a value on this dimension: the list's column, blank left out. The list has
                      no column for a disabled dimension and would drop the filter: plain text then.
                    */}
                    <AnalyticsLinesUsage
                      kind="dimension"
                      lineCount={usedLineCount(data.opex_count, data.capex_count)}
                      filters={isAnalyticsActive(data) ? { [axisListColumn(data)]: dropValues([null]) } : null}
                    />
                  </>
                ) : t('analytics.usage.noValues')}
              </Typography>
            </Box>}
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

function DimensionProperties({
  axis,
  defaultLabel,
  disabled,
  errors,
  onNameCommit,
  onCodeCommit,
  onAppliesToChange,
  onRequiredChange,
  canSetOpenValues,
  onOpenValuesChange,
  onDisabledAtChange,
  onDisableNow,
  onFieldError,
}: {
  axis: AnalyticsAxisDetail;
  defaultLabel: string;
  disabled: boolean;
  errors: FieldErrors;
  onNameCommit: (name: string | null) => void;
  onCodeCommit: (code: string) => void;
  onAppliesToChange: (appliesTo: LineType | null) => void;
  onRequiredChange: (required: boolean) => void;
  /** The open values switch shows (people who administer dimensions with access to all data). */
  canSetOpenValues: boolean;
  onOpenValuesChange: (openValues: boolean) => void;
  onDisabledAtChange: (disabledAt: string | null) => void;
  /** Switched off: disable now, on the server's clock (the status alone). */
  onDisableNow: () => void;
  /** Shows (or clears, with undefined) a refusal found before any request. */
  onFieldError: (field: AnalyticsField, message: string | undefined) => void;
}) {
  const { t } = useTranslation(['master-data', 'common']);
  // A refused value stays in its field so it can be corrected; a stored change replaces it.
  const nameDraft = useFieldDraft(axis.name ?? '');
  const codeDraft = useFieldDraft(axis.code);
  const name = nameDraft.draft;
  const code = codeDraft.draft;

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

  const blurOnEnter = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
  };

  const appliesTo = parseLineTypeUsage(axis.applies_to);
  // Lines of the other type keep their value on the dimension, hidden while it does not apply to them.
  const appliesToConflict = lineTypeUsageConflict(appliesTo, { opex: axis.opex_count ?? 0, capex: axis.capex_count ?? 0 });

  return (
    <>
      <PropertyGroup>
        {/* The name is the header title; the default dimension keeps this field, which may be emptied for the translated label. */}
        {axis.is_default && (
          <PropertyRow
            label={t('analytics.fields.name')}
            helperText={t('analytics.hints.nameDefault', { label: defaultLabel })}
          >
            <TextField
              value={name}
              onChange={(event) => nameDraft.setDraft(event.target.value)}
              onFocus={nameDraft.onFocus}
              onBlur={commitName}
              onKeyDown={blurOnEnter}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={defaultLabel}
              disabled={disabled}
              error={!!errors.name}
              helperText={errors.name}
              inputProps={{ 'aria-label': t('analytics.fields.name'), autoComplete: 'off' }}
            />
          </PropertyRow>
        )}
        <PropertyRow
          label={t('analytics.fields.code')}
          required
          helperText={t(axis.is_default ? 'analytics.hints.codeDefault' : axis.id ? 'analytics.hints.code' : 'analytics.hints.codeCreate', { code: axis.code })}
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
        <PropertyRow
          label={t('shared.lineTypeUsage.label')}
          helperText={axis.is_default ? t('analytics.hints.appliesToDefault') : undefined}
        >
          <LineTypeUsageSelect
            value={appliesTo}
            label={t('shared.lineTypeUsage.label')}
            // The default dimension applies to both types, always.
            disabled={disabled || axis.is_default}
            error={errors.applies_to}
            onChange={(next) => {
              if (next !== appliesTo) onAppliesToChange(next);
            }}
          />
          {appliesToConflict && (
            <LineTypeUsageConflictNote testId="analytics-dimension-applies-to-conflict">
              {t(`analytics.appliesToConflict.${appliesToConflict.scope}`, { count: appliesToConflict.count })}
            </LineTypeUsageConflictNote>
          )}
        </PropertyRow>
        <PropertyRow label={t('analytics.fields.required')}>
          <SettingSwitch
            label={t('analytics.fields.required')}
            checked={!!axis.required}
            disabled={disabled}
            error={errors.required}
            onChange={(next) => {
              if (next !== !!axis.required) onRequiredChange(next);
            }}
          />
          {axis.required && <RequiredNotes axis={axis} />}
        </PropertyRow>
        {canSetOpenValues && (
          <PropertyRow label={t('analytics.fields.openValues')} helperText={t('analytics.hints.openValues')}>
            <SettingSwitch
              label={t('analytics.fields.openValues')}
              checked={!!axis.open_values}
              disabled={disabled}
              error={errors.open_values}
              onChange={(next) => {
                if (next !== !!axis.open_values) onOpenValuesChange(next);
              }}
            />
          </PropertyRow>
        )}
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
            onDisableNow={onDisableNow}
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

function SettingSwitch({
  label,
  checked,
  disabled,
  error,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  error?: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <Box>
      <Switch
        size="small"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        inputProps={{ 'aria-label': label }}
      />
      {error && (
        <Typography role="alert" sx={{ mt: '3px', fontSize: 12, lineHeight: 1.35, color: 'error.main' }}>{error}</Typography>
      )}
    </Box>
  );
}

/**
 * Under a required dimension's switch. Disabled: one hint, nothing is checked. Enabled: the lines
 * that have no value yet (they stay editable), each type with a link opening them in its list in a
 * new tab (every status, a one-off view), and a warning when a type it applies to has no enabled
 * value to choose, so no new line of that type can be created.
 */
function RequiredNotes({ axis }: { axis: AnalyticsAxisDetail }) {
  const { t } = useTranslation(['master-data']);
  if (!isAnalyticsActive(axis)) {
    return (
      <Typography data-testid="analytics-dimension-required-disabled" sx={{ mt: '6px', fontSize: 12, lineHeight: 1.35, color: 'kanap.text.tertiary' }}>
        {t('analytics.required.disabledHint')}
      </Typography>
    );
  }
  const opexMissing = axis.opex_missing ?? 0;
  const capexMissing = axis.capex_missing ?? 0;
  const missing = requiredMissingLine(t, opexMissing, capexMissing);
  const unusable = requiredUnusableLine(t, axis.unusable_for);
  const scopes = ([['opex', opexMissing], ['capex', capexMissing]] as const)
    .filter(([, count]) => count > 0)
    .map(([scope]) => scope);
  const column = axisListColumn(axis);
  return (
    <>
      {missing && (
        <LineTypeUsageConflictNote testId="analytics-dimension-required-missing">
          {missing}{' '}
          {scopes.map((scope, index) => (
            <React.Fragment key={scope}>
              {index > 0 && ' · '}
              <ListLinkAnchor link={oneOffListLink(scope, { [column]: keepValues([null]) })}>
                {scopes.length > 1 ? t(`analytics.required.showLines.${scope}`) : t('analytics.showLines')}
              </ListLinkAnchor>
            </React.Fragment>
          ))}
        </LineTypeUsageConflictNote>
      )}
      {unusable && (
        <LineTypeUsageConflictNote testId="analytics-dimension-required-unusable">{unusable}</LineTypeUsageConflictNote>
      )}
    </>
  );
}
