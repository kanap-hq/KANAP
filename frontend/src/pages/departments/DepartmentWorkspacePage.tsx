import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useDepartmentNav } from '../../hooks/useDepartmentNav';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PropertyGroup, PropertyRow } from '../../components/design';
import CompanySelect from '../../components/fields/CompanySelect';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import { deriveStatusFromDisabledAt, normalizeStatus } from '../../constants/status';
import { drawerFieldValueSx, longFormSurfaceFieldSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import DepartmentHeadcountTab from './DepartmentHeadcountTab';

type TabKey = 'overview' | 'details';
const TAB_KEYS: TabKey[] = ['overview', 'details'];
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
  const { data, error: loadError } = useQuery({
    queryKey: detailKey,
    queryFn: async () => (await api.get<Department>(`/departments/${id}`)).data,
    enabled: !isCreate && !!id,
  });

  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [pageError, setPageError] = React.useState<string | null>(null);
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
          const message = getApiErrorMessage(e, t, t('departments.messages.saveFailed'));
          const target = departmentRefusalField(e) ?? field;
          if (target === 'name') setPageError(message);
          else setErrors((prev) => ({ ...prev, [target]: message }));
        }
      };
      const result = chainRef.current.then(run, run);
      chainRef.current = result.catch(() => undefined);
      return result;
    },
    [canEdit, data?.id, queryClient, t],
  );

  const setYear = (next: number) => {
    const sp = new URLSearchParams(searchParams);
    sp.set('year', String(next));
    setSearchParams(sp, { replace: true });
  };

  if (isCreate) {
    return (
      <DepartmentCreate
        canCreate={canEdit}
        onClose={handleClose}
        onCreated={(newId) => goTo(newId, 'overview')}
      />
    );
  }

  const disabled = !canEdit;
  const tabs = [
    { key: 'overview', label: t('shared.labels.overview') },
    { key: 'details', label: t('shared.labels.details') },
  ];

  const properties = data ? (
    <PropertyGroup>
      <PropertyRow label={t('departments.fields.company')} required>
        <CompanySelect
          hideLabel
          value={data.company_id}
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
          disabled={disabled}
          disabledAtError={!!errors.disabled_at}
          disabledAtHelperText={errors.disabled_at}
        />
      </Box>
    </PropertyGroup>
  ) : <Box />;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {(pageError || loadError) && (
        <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={pageError ? () => setPageError(null) : undefined}>
          {pageError ?? t('departments.loadError')}
        </Alert>
      )}
      <PortfolioDetailWorkspaceShell
        activeTab={tab}
        tabs={tabs}
        onTabChange={(next) => goTo(id, next as TabKey)}
        drawerStorageKey="kanap.departments.drawerOpen"
        backLabel={t('departments.title')}
        onBack={handleClose}
        title={data?.name ?? ''}
        titleFallback={t('departments.departmentFallback')}
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
          previousLabel: t('departments.previous'),
          nextLabel: t('departments.next'),
        } : undefined}
        properties={properties}
      >
        {data && tab === 'overview' && (
          <DescriptionField
            key={data.id}
            value={data.description ?? ''}
            disabled={disabled}
            error={errors.description}
            onCommit={(description) => void patch({ description }, 'description')}
          />
        )}
        {data && tab === 'details' && (
          <DepartmentHeadcountTab
            departmentId={data.id}
            year={year}
            onYearChange={setYear}
            readOnly={!canEdit}
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

function DepartmentCreate({
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
  const [name, setName] = React.useState('');
  const [companyId, setCompanyId] = React.useState<string | null>(null);
  const [description, setDescription] = React.useState('');
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const handleCreate = async () => {
    if (!canCreate || submitting) return;
    const trimmed = name.trim();
    const nextErrors: FieldErrors = {};
    if (!trimmed) nextErrors.name = t('departments.messages.nameRequired');
    if (!companyId) nextErrors.company_id = t('departments.messages.companyRequired');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await api.post<Department>('/departments', {
        name: trimmed,
        company_id: companyId,
        description: description.trim() || null,
      });
      void queryClient.invalidateQueries({ queryKey: ['departments'] });
      onCreated(res.data.id);
    } catch (e) {
      const message = getApiErrorMessage(e, t, t('departments.messages.createFailed'));
      const field = departmentRefusalField(e);
      if (field === 'name' || field === 'company_id' || field === 'description') setErrors({ [field]: message });
      else setServerError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        activeTab="overview"
        tabs={[
          { key: 'overview', label: t('shared.labels.overview') },
          { key: 'details', label: t('shared.labels.details'), disabled: true },
        ]}
        onTabChange={() => undefined}
        drawerStorageKey="kanap.departments.drawerOpen"
        backLabel={t('departments.title')}
        onBack={onClose}
        title={name}
        titleFallback={t('departments.newDepartment')}
        isCreate
        actions={(
          <Button variant="contained" size="small" onClick={() => void handleCreate()} disabled={!canCreate || submitting}>
            {t('common:buttons.create')}
          </Button>
        )}
      >
        <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{t('departments.detailsTabHint')}</Typography>
          <PropertyRow label={t('departments.fields.name')} required valueSx={{ maxWidth: 520 }}>
            <TextField
              value={name}
              onChange={(e) => setName(e.target.value)}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('departments.placeholders.name')}
              error={!!errors.name}
              helperText={errors.name}
              inputProps={{ 'aria-label': t('departments.fields.name'), autoComplete: 'off' }}
            />
          </PropertyRow>
          <PropertyRow label={t('departments.fields.company')} required valueSx={{ maxWidth: 520 }}>
            <CompanySelect
              hideLabel
              value={companyId}
              onChange={setCompanyId}
              error={!!errors.company_id}
              helperText={errors.company_id}
              textFieldSx={drawerFieldValueSx}
            />
          </PropertyRow>
          <PropertyRow label={t('departments.fields.description')} valueSx={{ maxWidth: 520 }}>
            <TextField
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              multiline
              minRows={2}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('departments.placeholders.description')}
              error={!!errors.description}
              helperText={errors.description}
              inputProps={{ 'aria-label': t('departments.fields.description') }}
            />
          </PropertyRow>
          {serverError && <Alert severity="error">{serverError}</Alert>}
        </Stack>
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}
