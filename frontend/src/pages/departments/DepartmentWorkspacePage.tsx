import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Stack, TextField, Typography } from '@mui/material';
import { CreationActions, useCreationLeave, useCreationTitle } from '../../components/workspace/creation';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useDepartmentNav } from '../../hooks/useDepartmentNav';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PropertyGroup, PropertyRow } from '../../components/design';
import CompanySelect from '../../components/fields/CompanySelect';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import { STATUS_DISABLED, STATUS_ENABLED, deriveStatusFromDisabledAt, normalizeStatus } from '../../constants/status';
import { drawerFieldValueSx, longFormSurfaceFieldSx } from '../../theme/formSx';
import { getApiErrorMessage, isDuplicateError } from '../../utils/apiErrorMessage';
import RecordDeleteButton from '../../components/workspace/RecordDeleteButton';
import DepartmentHeadcountTab from './DepartmentHeadcountTab';
import { WorkspaceTabBoundary, retryableLazy } from '../../components/workspace/WorkspaceTabBoundary';
import { RECORD_HISTORY_TAB_KEY } from '../../components/history/recordHistoryTabKey';

type TabKey = 'overview' | 'details' | typeof RECORD_HISTORY_TAB_KEY;
const TAB_KEYS: TabKey[] = ['overview', 'details', RECORD_HISTORY_TAB_KEY];

// The History tab loads its code when opened; a failed load shows a retry in its place.
const historyTab = retryableLazy(() => import('../../components/history/RecordHistoryTab'));
const HistoryTab = historyTab.Component;
const LIST_PATH = '/master-data/departments';

type Department = {
  id: string;
  name: string;
  company_id: string;
  description: string | null;
  status: string;
  disabled_at: string | null;
};

type DepartmentField = 'name' | 'company_id' | 'description' | 'disabled_at';
type FieldErrors = Partial<Record<DepartmentField, string>>;

/** What a new department starts from. */
const NEW_DEPARTMENT: Department = { id: '', name: '', company_id: '', description: null, status: STATUS_ENABLED, disabled_at: null };

const DEPARTMENT_FIELDS: ReadonlySet<string> = new Set<DepartmentField>(['name', 'company_id', 'description', 'disabled_at']);

/** The field a refusal names in its 400 body (`{ message, field }`), when the form shows it. */
function departmentRefusalField(error: unknown): DepartmentField | null {
  const raw = (error as { response?: { data?: { field?: unknown } } } | null)?.response?.data?.field;
  const field = raw === 'status' ? 'disabled_at' : raw;
  return typeof field === 'string' && DEPARTMENT_FIELDS.has(field) ? (field as DepartmentField) : null;
}

export default function DepartmentWorkspacePage() {
  const { t } = useTranslation(['master-data', 'common']);
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();

  const id = String(params.id || '');
  const isCreate = id === 'new';
  const rawTab = (params.tab as TabKey) || 'overview';
  const tab: TabKey = TAB_KEYS.includes(rawTab) && !(isCreate && rawTab !== 'overview') ? rawTab : 'overview';
  const canEdit = hasLevel('departments', 'member');
  const canDelete = hasLevel('departments', 'admin');

  const year = React.useMemo(() => {
    const parsed = Number(searchParams.get('year'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : new Date().getFullYear();
  }, [searchParams]);

  const nav = useDepartmentNav({
    id,
    sort: searchParams.get('sort'),
    q: searchParams.get('q'),
    filters: searchParams.get('filters'),
    year: searchParams.get('year'),
    statusScope: searchParams.get('scope'),
    enabled: !isCreate,
  });

  const detailKey = React.useMemo(() => ['departments', id] as const, [id]);
  // Set once the department is deleted: the page leaves without loading it again.
  const [deletedId, setDeletedId] = React.useState<string | null>(null);
  const { data: stored, error: loadError } = useQuery({
    queryKey: detailKey,
    queryFn: async () => (await api.get<Department>(`/departments/${id}`)).data,
    enabled: !isCreate && !!id && deletedId !== id,
  });
  // The new page is the department's own page on a draft: the fields write here, Create sends it.
  const [draft, setDraft] = React.useState<Department>(NEW_DEPARTMENT);
  const draftRef = React.useRef(draft);
  const data = isCreate ? draft : stored;

  const [errors, setErrors] = React.useState<FieldErrors>({});
  // Autosave never blocks the fields: writes queue one after the other, so a response never
  // overwrites a newer one, and results for a record the user has left are dropped.
  const chainRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const currentIdRef = React.useRef(id);
  currentIdRef.current = id;

  React.useEffect(() => {
    setErrors({});
  }, [id]);

  const listContext = React.useMemo(() => {
    const sp = new URLSearchParams();
    for (const key of ['sort', 'q', 'filters', 'scope', 'year']) {
      const value = searchParams.get(key);
      if (value) sp.set(key, value);
    }
    return sp.toString();
  }, [searchParams]);
  const withContext = (path: string) => `${path}${listContext ? `?${listContext}` : ''}`;

  const handleClose = () => navigate(withContext(LIST_PATH));
  const goTo = (targetId: string | null, nextTab: TabKey = tab) => {
    if (targetId) navigate(withContext(`${LIST_PATH}/${targetId}/${nextTab}`));
  };

  const patch = React.useCallback(
    (body: Partial<Department>, field: DepartmentField): Promise<void> => {
      if (isCreate) {
        setErrors((prev) => ({ ...prev, [field]: undefined }));
        draftRef.current = { ...draftRef.current, ...body };
        setDraft(draftRef.current);
        return Promise.resolve();
      }
      const recordId = data?.id;
      if (!recordId || !canEdit) return Promise.resolve();
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      const run = async () => {
        try {
          const res = await api.patch<Department>(`/departments/${recordId}`, body);
          queryClient.setQueryData(['departments', recordId], res.data);
          void queryClient.invalidateQueries({ queryKey: ['departments'], predicate: (q) => q.queryKey[1] !== recordId });
        } catch (e) {
          if (currentIdRef.current !== recordId) return;
          const target = departmentRefusalField(e) ?? field;
          // A name another department of the company has shows under the field saved (the name or the company).
          const message = isDuplicateError(e)
            ? t('departments.messages.nameTaken')
            : getApiErrorMessage(e, t, t('departments.messages.saveFailed'));
          setErrors((prev) => ({ ...prev, [target]: message }));
        }
      };
      const result = chainRef.current.then(run, run);
      chainRef.current = result.catch(() => undefined);
      return result;
    },
    [canEdit, data?.id, isCreate, queryClient, t],
  );

  const setYear = (next: number) => {
    const sp = new URLSearchParams(searchParams);
    sp.set('year', String(next));
    setSearchParams(sp, { replace: true });
  };

  // Create sends the draft with the header's name, then goes back where the creation started.
  const leave = useCreationLeave(handleClose);
  const title = useCreationTitle({ requiredMessage: t('departments.messages.nameRequired'), onCancel: leave });
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);
  const handleCreate = async () => {
    if (!canEdit || creating) return;
    const name = title.require();
    const { company_id, description, status, disabled_at } = draftRef.current;
    if (!company_id) setErrors((prev) => ({ ...prev, company_id: t('departments.messages.companyRequired') }));
    if (!name || !company_id) return;
    setCreating(true);
    setCreateError(null);
    try {
      await api.post<Department>('/departments', { name, company_id, description, status, disabled_at });
      void queryClient.invalidateQueries({ queryKey: ['departments'] });
      leave();
    } catch (e) {
      const message = getApiErrorMessage(e, t, t('departments.messages.createFailed'));
      const field = departmentRefusalField(e);
      if (isDuplicateError(e)) title.refuse(t('departments.messages.nameTaken'));
      else if (field === 'name') title.refuse(message);
      else if (field) setErrors((prev) => ({ ...prev, [field]: message }));
      else setCreateError(message);
    } finally {
      setCreating(false);
    }
  };

  const disabled = !canEdit;
  const tabs = [
    { key: 'overview', label: t('shared.labels.overview') },
    { key: 'details', label: t('shared.labels.details'), disabled: isCreate },
    { key: RECORD_HISTORY_TAB_KEY, label: t('shared.labels.history'), disabled: isCreate },
  ];

  const properties = data ? (
    <PropertyGroup>
      <PropertyRow label={t('departments.fields.company')} required>
        <CompanySelect
          hideLabel
          label={t('departments.fields.company')}
          value={data.company_id || null}
          onChange={(companyId) => {
            if (companyId && companyId !== data.company_id) void patch({ company_id: companyId }, 'company_id');
          }}
          disabled={disabled}
          disableClearable
          error={!!errors.company_id}
          helperText={errors.company_id}
          textFieldSx={drawerFieldValueSx}
        />
      </PropertyRow>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: '5px' }}>
        <Typography sx={{ fontSize: 12, lineHeight: 1.3, color: 'kanap.text.tertiary' }}>
          {t('departments.fields.lifecycle')}
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
  ) : <Box />;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={loadError ? <Alert severity="error">{t('departments.loadError')}</Alert> : undefined}
        activeTab={tab}
        tabs={tabs}
        onTabChange={(next) => goTo(id, next as TabKey)}
        drawerStorageKey="kanap.departments.drawerOpen"
        backLabel={t('departments.title')}
        onBack={isCreate ? leave : handleClose}
        {...(isCreate ? title.shellProps : {
          title: data?.name ?? '',
          titleError: errors.name,
          canEditTitle: canEdit && !!data,
          onTitleSave: (next: string) => {
            if (data && next !== data.name) void patch({ name: next }, 'name');
          },
        })}
        titleFallback={isCreate ? t('departments.newDepartment') : t('departments.departmentFallback')}
        isCreate={isCreate}
        nav={!isCreate && nav.total > 0 ? {
          currentIndex: nav.index + 1,
          totalCount: nav.total,
          hasPrev: nav.hasPrev,
          hasNext: nav.hasNext,
          onPrev: () => goTo(nav.prevId),
          onNext: () => goTo(nav.nextId),
          previousLabel: t('departments.previous'),
          nextLabel: t('departments.next'),
        } : undefined}
        actions={isCreate ? (
          <CreationActions onCreate={() => void handleCreate()} onCancel={leave} busy={!canEdit || creating} />
        ) : data && canDelete ? (
          <RecordDeleteButton
            base="/departments"
            id={data.id}
            name={data.name}
            deleteFailed="departments.messages.deleteFailed"
            onDeleted={() => { setDeletedId(data.id); handleClose(); }}
          />
        ) : undefined}
        properties={properties}
      >
        {data && tab === 'overview' && (
          <Stack spacing={3}>
            <DescriptionField
              key={data.id}
              value={data.description ?? ''}
              disabled={disabled}
              error={errors.description}
              onCommit={(description) => void patch({ description }, 'description')}
            />
            {createError && <Alert severity="error" sx={{ maxWidth: 900 }}>{createError}</Alert>}
          </Stack>
        )}
        {data && tab === 'details' && (
          <DepartmentHeadcountTab
            departmentId={data.id}
            year={year}
            onYearChange={setYear}
            readOnly={!canEdit}
          />
        )}
        {data && tab === RECORD_HISTORY_TAB_KEY && (
          <WorkspaceTabBoundary resetKey={tab} onRetry={() => historyTab.retry()}>
            <React.Suspense fallback={null}>
              <HistoryTab table="departments" recordId={data.id} />
            </React.Suspense>
          </WorkspaceTabBoundary>
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
    <Box sx={{ maxWidth: 900 }}>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 1 }}>
        {t('departments.fields.description')}
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
        placeholder={t('departments.placeholders.description')}
        disabled={disabled}
        error={!!error}
        helperText={error}
        sx={longFormSurfaceFieldSx}
        inputProps={{ 'aria-label': t('departments.fields.description') }}
      />
    </Box>
  );
}
