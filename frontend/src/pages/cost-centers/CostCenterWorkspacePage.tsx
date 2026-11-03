import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Stack, TextField, Typography } from '@mui/material';
import { CreationActions, useCreationLeave, useCreationTitle } from '../../components/workspace/creation';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { useDataAccessAdmin } from '../../auth/dataAccess';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { useKanapDialogs } from '../../components/design';
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
import { STATUS_DISABLED, deriveStatusFromDisabledAt } from '../../constants/status';
import { longFormSurfaceFieldSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import CostCenterPropertiesDrawer from './CostCenterPropertiesDrawer';
import {
  costCenterDeleteBlock,
  costCenterUsageLine,
  refusalField,
  type CostCenterField,
} from './costCenterFields';
import DeleteIconButton from '../../components/workspace/DeleteIconButton';
import CostCenterAccessTab from './CostCenterAccessTab';

const LIST_PATH = '/master-data/cost-centers';
const EMPTY_SET: ReadonlySet<string> = new Set();
const NO_KINDS: CostCenterKind[] = [];
const CREATE_FIELDS: ReadonlySet<CostCenterField> = new Set<CostCenterField>([
  'code', 'name', 'kind', 'parent_id', 'company_id', 'owner_user_id', 'description',
]);
const UNAVAILABLE_FOR_PARENT: CostCenterKind[] = ['cost_center'];

type TabKey = 'overview' | 'access';
const TAB_KEYS: TabKey[] = ['overview', 'access'];

type FieldErrors = Partial<Record<CostCenterField, string>>;

/** What a new cost center starts from. */
const NEW_COST_CENTER: CostCenterDetail = {
  id: '', code: '', name: '', kind: 'cost_center', parent_id: null, company_id: null, company_name: null,
  owner_user_id: null, owner_name: null, status: 'enabled', disabled_at: null, sort_order: 0, depth: 0,
  path: '', path_ids: [], parent_code: null, parent_name: null, description: null, opex_count: 0, capex_count: 0,
};

export default function CostCenterWorkspacePage() {
  const { t } = useTranslation(['master-data', 'common']);
  const dialogs = useKanapDialogs();
  const { hasLevel } = useAuth();
  const canAdminDataAccess = useDataAccessAdmin();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const tree = useCostCenterTree();

  const id = String(params.id || '');
  const isCreate = id === 'new';
  const rawTab = (params.tab as TabKey) || 'overview';
  const tab: TabKey = TAB_KEYS.includes(rawTab) && !(rawTab === 'access' && !canAdminDataAccess)
    ? rawTab
    : 'overview';
  const canEdit = hasLevel('cost_centers', 'member');
  const canDelete = hasLevel('cost_centers', 'admin');

  const detailKey = React.useMemo(() => ['cost-centers', 'detail', id] as const, [id]);
  const { data: stored, error: loadError } = useQuery({
    queryKey: detailKey,
    queryFn: () => getCostCenter(id),
    enabled: !isCreate && !!id,
  });
  // The new page is the cost center's own page on a draft: the fields write here, Create sends it.
  const [draft, setDraft] = React.useState<CostCenterDetail>(NEW_COST_CENTER);
  const draftRef = React.useRef(draft);
  const data = isCreate ? draft : stored;

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
    (targetId: string | null, nextTab: TabKey = tab) => {
      if (targetId) navigate(`${LIST_PATH}/${targetId}/${nextTab}${listContext ? `?${listContext}` : ''}`);
    },
    [listContext, navigate, tab],
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
    [afterWrite, canEdit, data?.id, isCreate, queryClient, t],
  );

  const effectiveKind: CostCenterKind | undefined = pendingKind ?? data?.kind;

  const handleKindChange = (next: CostCenterKind) => {
    if (!data) return;
    setErrors((prev) => ({ ...prev, kind: undefined, company_id: undefined }));
    // A draft takes the type alone; Create asks for the company of a cost center.
    if (isCreate) {
      void patch(next === 'group' ? { kind: next, company_id: null } : { kind: next }, 'kind');
      return;
    }
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
    if (pendingKind === 'cost_center' && !isCreate) {
      const ok = await patch({ kind: 'cost_center', company_id: companyId }, 'company_id');
      if (ok) setPendingKind(null);
      return;
    }
    if (companyId !== data.company_id) void patch({ company_id: companyId }, 'company_id');
  };

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

  // Create sends the draft with the header's name, then goes back where the creation started.
  const leave = useCreationLeave(handleClose);
  const title = useCreationTitle({ requiredMessage: t('costCenters.messages.nameRequired'), onCancel: leave });
  const [creating, setCreating] = React.useState(false);
  const handleCreate = async () => {
    if (!canEdit || creating) return;
    const name = title.require();
    const form = draftRef.current;
    const nextErrors: FieldErrors = {};
    if (!form.code) nextErrors.code = t('costCenters.messages.codeRequired');
    if (form.kind === 'cost_center' && !form.company_id) nextErrors.company_id = t('costCenters.messages.companyRequired');
    setErrors((prev) => ({ ...prev, ...nextErrors }));
    if (!name || Object.keys(nextErrors).length > 0) return;
    setCreating(true);
    setPageError(null);
    try {
      await createCostCenter({
        code: form.code,
        name,
        kind: form.kind,
        parent_id: form.parent_id,
        company_id: form.kind === 'cost_center' ? form.company_id : null,
        owner_user_id: form.owner_user_id,
        description: form.description,
        status: form.status,
        disabled_at: form.disabled_at,
      });
      void queryClient.invalidateQueries({ queryKey: ['cost-centers'] });
      afterWrite();
      leave();
    } catch (e) {
      const message = getApiErrorMessage(e, t, t('costCenters.messages.createFailed'));
      const field = refusalField(e);
      // A refusal goes under the field it names when the page shows that field.
      if (field === 'name') title.refuse(message);
      else if (field && CREATE_FIELDS.has(field) && !(field === 'company_id' && form.kind !== 'cost_center')) {
        setErrors((prev) => ({ ...prev, [field]: message }));
      } else setPageError(message);
    } finally {
      setCreating(false);
    }
  };

  const actions = isCreate ? (
    <CreationActions onCreate={() => void handleCreate()} onCancel={leave} busy={!canEdit || creating} />
  ) : canDelete && data ? (
    <DeleteIconButton onClick={() => void handleDelete()} disabled={deleting || !!deleteBlock} />
  ) : undefined;


  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={(pageError || loadError) ? (
          <Alert severity="error" onClose={pageError ? () => setPageError(null) : undefined}>
            {pageError ?? t('costCenters.messages.loadFailed')}
          </Alert>
        ) : undefined}
        activeTab={tab}
        tabs={[
          { key: 'overview', label: t('shared.labels.overview') },
          ...(canAdminDataAccess ? [{ key: 'access', label: t('shared.labels.access'), disabled: isCreate }] : []),
        ]}
        onTabChange={(next) => goTo(id, next as TabKey)}
        drawerStorageKey="kanap.costCenters.drawerOpen"
        backLabel={t('costCenters.title')}
        onBack={isCreate ? leave : handleClose}
        itemReference={isCreate ? null : data?.code ?? null}
        onCopyReference={!isCreate && data?.code ? () => { void navigator.clipboard?.writeText(data.code); } : undefined}
        {...(isCreate ? title.shellProps : {
          title: data?.name ?? '',
          canEditTitle: canEdit && !!data,
          onTitleSave: (next: string) => {
            if (data && next !== data.name) void patch({ name: next }, 'name');
          },
        })}
        titleFallback={isCreate ? t('costCenters.newCostCenter') : t('costCenters.fallback')}
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
          previousLabel: t('costCenters.previous'),
          nextLabel: t('costCenters.next'),
        } : undefined}
        actions={actions}
        history={id && !isCreate ? { table: 'cost_centers', recordId: id } : undefined}
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
            // Disable now: the status alone, the server sets the end of validity from its own clock.
            onDisableNow={() => void patch({ status: STATUS_DISABLED }, 'disabled_at')}
          />
        ) : <Box />}
      >
        {data && tab === 'overview' && (
          <Stack spacing={2.5} sx={{ maxWidth: 900 }}>
            {!isCreate && (canDelete ? deleteBlock ?? usage : usage) && (
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
        {data && tab === 'access' && canAdminDataAccess && (
          <CostCenterAccessTab
            costCenterId={data.id}
            companyId={data.company_id}
            nodeLabel={data.code ? `${data.name} (${data.code})` : data.name}
          />
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
