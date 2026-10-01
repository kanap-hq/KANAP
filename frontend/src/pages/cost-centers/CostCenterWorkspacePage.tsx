import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, MenuItem, Stack, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PropertyRow } from '../../components/design';
import CostCenterSelect from '../../components/fields/CostCenterSelect';
import CompanySelect from '../../components/fields/CompanySelect';
import MetadataUserPicker from '../../components/workspace/MetadataUserPicker';
import { COST_CENTER_TREE_QUERY_KEY, useCostCenterTree } from '../../hooks/useCostCenterTree';
import { useCostCenterNav } from '../../hooks/useCostCenterNav';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import {
  createCostCenter,
  deleteCostCenter,
  getCostCenter,
  updateCostCenter,
  type CostCenterDetail,
  type CostCenterKind,
  type CostCenterPatch,
} from '../../services/costCenters';
import { deriveStatusFromDisabledAt } from '../../constants/status';
import { drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx, longFormSurfaceFieldSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import CostCenterPropertiesDrawer, { ErrorLine } from './CostCenterPropertiesDrawer';
import {
  COST_CENTER_KINDS,
  costCenterDeleteBlock,
  costCenterUsageLine,
  refusalField,
  type CostCenterField,
} from './costCenterFields';

const LIST_PATH = '/master-data/cost-centers';
const EMPTY_SET: ReadonlySet<string> = new Set();
const NO_KINDS: CostCenterKind[] = [];
const CREATE_FIELDS: ReadonlySet<CostCenterField> = new Set<CostCenterField>([
  'code', 'name', 'kind', 'parent_id', 'company_id', 'owner_user_id', 'description',
]);
const UNAVAILABLE_FOR_PARENT: CostCenterKind[] = ['cost_center'];

type FieldErrors = Partial<Record<CostCenterField, string>>;

export default function CostCenterWorkspacePage() {
  const { t } = useTranslation(['master-data', 'common']);
  const { hasLevel } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const tree = useCostCenterTree();

  const id = String(params.id || '');
  const isCreate = id === 'new';
  const canEdit = hasLevel('cost_centers', 'member');
  const canDelete = hasLevel('cost_centers', 'admin');

  const detailKey = React.useMemo(() => ['cost-centers', 'detail', id] as const, [id]);
  const { data, error: loadError } = useQuery({
    queryKey: detailKey,
    queryFn: () => getCostCenter(id),
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
  // A group turned into a cost center needs its company in the same write.
  const [pendingKind, setPendingKind] = React.useState<CostCenterKind | null>(null);

  React.useEffect(() => {
    setErrors({});
    setPageError(null);
    setPendingKind(null);
  }, [id]);

  const listContext = React.useMemo(() => {
    const sp = new URLSearchParams();
    for (const key of ['sort', 'q', 'filters', 'scope']) {
      const value = searchParams.get(key);
      if (value) sp.set(key, value);
    }
    return sp.toString();
  }, [searchParams]);

  const nav = useCostCenterNav({
    id,
    sort: searchParams.get('sort'),
    q: searchParams.get('q'),
    filters: searchParams.get('filters'),
    statusScope: searchParams.get('scope'),
    enabled: !isCreate,
  });

  const goTo = React.useCallback(
    (targetId: string | null) => {
      if (targetId) navigate(`${LIST_PATH}/${targetId}/overview${listContext ? `?${listContext}` : ''}`);
    },
    [listContext, navigate],
  );

  const handleClose = React.useCallback(() => {
    navigate(`${LIST_PATH}${listContext ? `?${listContext}` : ''}`);
  }, [listContext, navigate]);

  const afterWrite = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: COST_CENTER_TREE_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: ['cost-centers-ids'] });
  }, [queryClient]);

  const patch = React.useCallback(
    (body: CostCenterPatch, field: CostCenterField): Promise<boolean> => {
      const recordId = data?.id;
      if (!recordId || !canEdit) return Promise.resolve(false);
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      const run = async (): Promise<boolean> => {
        try {
          const saved = await updateCostCenter(recordId, body);
          queryClient.setQueryData(['cost-centers', 'detail', recordId], saved);
          afterWrite();
          return true;
        } catch (e) {
          if (currentIdRef.current !== recordId) return false;
          const message = getApiErrorMessage(e, t, t('costCenters.messages.saveFailed'));
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
    [afterWrite, canEdit, data?.id, queryClient, t],
  );

  const effectiveKind: CostCenterKind | undefined = pendingKind ?? data?.kind;

  const handleKindChange = (next: CostCenterKind) => {
    if (!data) return;
    setErrors((prev) => ({ ...prev, kind: undefined, company_id: undefined }));
    if (next === data.kind) {
      setPendingKind(null);
      return;
    }
    if (next === 'group') {
      setPendingKind(null);
      void patch({ kind: 'group', company_id: null }, 'kind');
      return;
    }
    setPendingKind('cost_center');
    setErrors((prev) => ({ ...prev, company_id: t('costCenters.messages.chooseCompany') }));
  };

  const handleCompanyChange = async (companyId: string | null) => {
    if (!data || !companyId) return;
    if (pendingKind === 'cost_center') {
      const ok = await patch({ kind: 'cost_center', company_id: companyId }, 'company_id');
      if (ok) setPendingKind(null);
      return;
    }
    if (companyId !== data.company_id) void patch({ company_id: companyId }, 'company_id');
  };

  const handleDelete = async () => {
    if (!data || !canDelete) return;
    setDeleting(true);
    setPageError(null);
    try {
      await deleteCostCenter(data.id);
      void queryClient.invalidateQueries({ queryKey: ['cost-centers'] });
      afterWrite();
      handleClose();
    } catch (e) {
      setPageError(getApiErrorMessage(e, t, t('costCenters.messages.deleteFailed')));
    } finally {
      setDeleting(false);
    }
  };

  const excludeParentIds = React.useMemo(
    () => (data ? tree.descendantIds(data.id) : EMPTY_SET),
    [data, tree],
  );

  const usage = data ? costCenterUsageLine(t, data.opex_count ?? 0, data.capex_count ?? 0) : null;
  const childCount = React.useMemo(
    () => (data ? tree.nodes.filter((node) => node.parent_id === data.id).length : 0),
    [data, tree.nodes],
  );
  // The server refuses these deletes anyway; the page already knows, so it says why up front.
  const deleteBlock = data ? costCenterDeleteBlock(t, usage, childCount) : null;
  const disabled = !canEdit;

  const actions = !isCreate && canDelete && data ? (
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

  if (isCreate) {
    return <CostCenterCreate onClose={handleClose} onCreated={(newId) => goTo(newId)} canCreate={canEdit} />;
  }

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {(pageError || loadError) && (
        <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={pageError ? () => setPageError(null) : undefined}>
          {pageError ?? t('costCenters.messages.loadFailed')}
        </Alert>
      )}
      <PortfolioDetailWorkspaceShell
        activeTab="overview"
        tabs={[{ key: 'overview', label: t('shared.labels.overview') }]}
        onTabChange={() => undefined}
        drawerStorageKey="kanap.costCenters.drawerOpen"
        backLabel={t('costCenters.title')}
        onBack={handleClose}
        itemReference={data?.code ?? null}
        onCopyReference={data?.code ? () => { void navigator.clipboard?.writeText(data.code); } : undefined}
        title={data?.name ?? ''}
        titleFallback={t('costCenters.fallback')}
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
          previousLabel: t('costCenters.previous'),
          nextLabel: t('costCenters.next'),
        } : undefined}
        actions={actions}
        properties={data && effectiveKind ? (
          <CostCenterPropertiesDrawer
            key={data.id}
            node={data}
            kind={effectiveKind}
            disabled={disabled}
            errors={errors}
            excludeParentIds={excludeParentIds}
            // A group that contains nodes cannot become a cost center, so the choice is not offered.
            unavailableKinds={data.kind === 'group' && childCount > 0 ? UNAVAILABLE_FOR_PARENT : NO_KINDS}
            onCodeCommit={(code) => void patch({ code }, 'code')}
            onKindChange={handleKindChange}
            onParentChange={(parentId) => {
              if (parentId !== data.parent_id) void patch({ parent_id: parentId }, 'parent_id');
            }}
            onCompanyChange={(companyId) => void handleCompanyChange(companyId)}
            onOwnerChange={(userId) => {
              if (userId !== data.owner_user_id) void patch({ owner_user_id: userId }, 'owner_user_id');
            }}
            onDisabledAtChange={(disabledAt) => {
              if (disabledAt === data.disabled_at) return;
              void patch({ status: deriveStatusFromDisabledAt(disabledAt), disabled_at: disabledAt }, 'disabled_at');
            }}
          />
        ) : <Box />}
      >
        {data && (
          <Stack spacing={2.5} sx={{ maxWidth: 900 }}>
            {(canDelete ? deleteBlock ?? usage : usage) && (
              <Typography data-testid="cost-center-usage" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
                {canDelete ? deleteBlock ?? usage : usage}
              </Typography>
            )}
            <DescriptionField
              key={data.id}
              value={data.description ?? ''}
              disabled={disabled}
              error={errors.description}
              onCommit={(description) => void patch({ description }, 'description')}
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
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  return (
    <Box>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 1 }}>
        {t('costCenters.fields.description')}
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
        minRows={3}
        variant="standard"
        placeholder={t('costCenters.placeholders.description')}
        disabled={disabled}
        error={!!error}
        helperText={error}
        sx={longFormSurfaceFieldSx}
        inputProps={{ 'aria-label': t('costCenters.fields.description') }}
      />
    </Box>
  );
}

type CreateForm = {
  code: string;
  name: string;
  kind: CostCenterKind;
  parent_id: string | null;
  company_id: string | null;
  owner_user_id: string | null;
  description: string;
};

const EMPTY_FORM: CreateForm = {
  code: '',
  name: '',
  kind: 'cost_center',
  parent_id: null,
  company_id: null,
  owner_user_id: null,
  description: '',
};

function CostCenterCreate({
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
  const [form, setForm] = React.useState<CreateForm>(EMPTY_FORM);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const update = (next: Partial<CreateForm>) => setForm((prev) => ({ ...prev, ...next }));

  const handleCreate = async () => {
    if (!canCreate || submitting) return;
    const code = form.code.trim();
    const name = form.name.trim();
    const nextErrors: FieldErrors = {};
    if (!code) nextErrors.code = t('costCenters.messages.codeRequired');
    if (!name) nextErrors.name = t('costCenters.messages.nameRequired');
    if (form.kind === 'cost_center' && !form.company_id) nextErrors.company_id = t('costCenters.messages.companyRequired');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const saved = await createCostCenter({
        code,
        name,
        kind: form.kind,
        parent_id: form.parent_id,
        company_id: form.kind === 'cost_center' ? form.company_id : null,
        owner_user_id: form.owner_user_id,
        description: form.description.trim() || null,
      });
      void queryClient.invalidateQueries({ queryKey: ['cost-centers'] });
      void queryClient.invalidateQueries({ queryKey: ['cost-centers-ids'] });
      onCreated(saved.id);
    } catch (e) {
      const message = getApiErrorMessage(e, t, t('costCenters.messages.createFailed'));
      const field = refusalField(e);
      // A refusal goes under the field it names when the form shows that field.
      if (field && CREATE_FIELDS.has(field) && !(field === 'company_id' && form.kind !== 'cost_center')) {
        setErrors({ [field]: message });
      } else {
        setServerError(message);
      }
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
        drawerStorageKey="kanap.costCenters.drawerOpen"
        backLabel={t('costCenters.title')}
        onBack={onClose}
        title={form.name}
        titleFallback={t('costCenters.newCostCenter')}
        isCreate
        actions={(
          <Button variant="contained" size="small" onClick={() => void handleCreate()} disabled={!canCreate || submitting}>
            {t('common:buttons.create')}
          </Button>
        )}
      >
        <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
          <PropertyRow label={t('costCenters.fields.code')} required helperText={t('costCenters.hints.code')} valueSx={{ maxWidth: 520 }}>
            <TextField
              value={form.code}
              onChange={(e) => update({ code: e.target.value })}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('costCenters.placeholders.code')}
              error={!!errors.code}
              helperText={errors.code}
              inputProps={{ 'aria-label': t('costCenters.fields.code'), autoComplete: 'off', spellCheck: false }}
            />
          </PropertyRow>
          <PropertyRow label={t('costCenters.fields.name')} required valueSx={{ maxWidth: 520 }}>
            <TextField
              value={form.name}
              onChange={(e) => update({ name: e.target.value })}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('costCenters.placeholders.name')}
              error={!!errors.name}
              helperText={errors.name}
              inputProps={{ 'aria-label': t('costCenters.fields.name'), autoComplete: 'off' }}
            />
          </PropertyRow>
          <PropertyRow label={t('costCenters.fields.type')} required valueSx={{ maxWidth: 520 }}>
            <TextField
              select
              value={form.kind}
              onChange={(e) => update({ kind: e.target.value as CostCenterKind })}
              variant="standard"
              sx={drawerSelectSx}
              error={!!errors.kind}
              helperText={errors.kind}
              inputProps={{ 'aria-label': t('costCenters.fields.type') }}
            >
              {COST_CENTER_KINDS.map((value) => (
                <MenuItem key={value} value={value} sx={drawerMenuItemSx}>
                  {t(`costCenters.kinds.${value}`)}
                </MenuItem>
              ))}
            </TextField>
          </PropertyRow>
          <PropertyRow label={t('costCenters.fields.parent')} valueSx={{ maxWidth: 520 }}>
            <CostCenterSelect
              hideLabel
              selectable="groups"
              value={form.parent_id}
              onChange={(parentId) => update({ parent_id: parentId })}
              placeholder={t('costCenters.placeholders.topLevel')}
              error={!!errors.parent_id}
              helperText={errors.parent_id}
              textFieldSx={drawerFieldValueSx}
            />
          </PropertyRow>
          {form.kind === 'cost_center' && (
            <PropertyRow label={t('costCenters.fields.company')} required helperText={t('costCenters.hints.company')} valueSx={{ maxWidth: 520 }}>
              <CompanySelect
                hideLabel
                value={form.company_id}
                onChange={(companyId) => update({ company_id: companyId })}
                error={!!errors.company_id}
                helperText={errors.company_id}
                textFieldSx={drawerFieldValueSx}
              />
            </PropertyRow>
          )}
          <PropertyRow label={t('costCenters.fields.owner')} helperText={t('costCenters.hints.owner')} valueSx={{ maxWidth: 520 }}>
            <MetadataUserPicker
              value={form.owner_user_id}
              placeholder={t('costCenters.placeholders.ownerMissing')}
              searchPlaceholder={t('costCenters.fields.owner')}
              showAvatar={false}
              onChange={(userId) => update({ owner_user_id: userId })}
              sx={{ maxWidth: '100%' }}
            />
            <ErrorLine message={errors.owner_user_id} />
          </PropertyRow>
          <PropertyRow label={t('costCenters.fields.description')} valueSx={{ maxWidth: 520 }}>
            <TextField
              value={form.description}
              onChange={(e) => update({ description: e.target.value })}
              multiline
              minRows={2}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('costCenters.placeholders.description')}
              error={!!errors.description}
              helperText={errors.description}
              inputProps={{ 'aria-label': t('costCenters.fields.description') }}
            />
          </PropertyRow>
          {serverError && <Alert severity="error">{serverError}</Alert>}
        </Stack>
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}
