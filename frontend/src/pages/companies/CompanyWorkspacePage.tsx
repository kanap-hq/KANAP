import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, FormHelperText, Stack, TextField, Typography } from '@mui/material';
import { CreationActions, useCreationLeave, useCreationTitle, useDraftCreation } from '../../components/workspace/creation';
import { useTheme } from '@mui/material/styles';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useDataAccessAdmin } from '../../auth/dataAccess';
import { useCompanyNav } from '../../hooks/useCompanyNav';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PortfolioMetadataItem, PortfolioStatusMetadata } from '../portfolio/workspace/PortfolioMetadataBar';
import { PropertyGroup, PropertyRow } from '../../components/design';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import {
  STATUS_DISABLED,
  STATUS_ENABLED,
  type StatusValue,
  deriveStatusFromDisabledAt,
  normalizeStatus,
} from '../../constants/status';
import { drawerFieldValueSx, longFormSurfaceFieldSx } from '../../theme/formSx';
import { EditableTitleDisplay } from '../../components/workspace/EditableTitle';
import { getApiErrorMessage, isDuplicateError } from '../../utils/apiErrorMessage';
import { getDotColor } from '../../utils/statusColors';
import { useCoaList } from '../coa/useCoaList';
import { CoaField, CountryField, CurrencyField, defaultCoaFor } from './CompanyFields';
import { currencyForCountry } from '../../constants/countryCurrency';
import RecordDeleteButton from '../../components/workspace/RecordDeleteButton';
import { WorkspaceTabBoundary, retryableLazy } from '../../components/workspace/WorkspaceTabBoundary';
import { RECORD_HISTORY_TAB_KEY } from '../../components/history/recordHistoryTabKey';
import CompanyMetricsTab from './CompanyMetricsTab';
import CompanyAccessTab from './CompanyAccessTab';
import { displayedCompanyCity } from './companyCity';

type TabKey = 'overview' | 'details' | 'access' | typeof RECORD_HISTORY_TAB_KEY;
const TAB_KEYS: TabKey[] = ['overview', 'details', 'access', RECORD_HISTORY_TAB_KEY];

// The History tab loads its code when opened; a failed load shows a retry in its place.
const historyTab = retryableLazy(() => import('../../components/history/RecordHistoryTab'));
const HistoryTab = historyTab.Component;
const LIST_PATH = '/master-data/companies';
/** How long Saved stays after a field is saved. */
const SAVED_LINGER_MS = 1500;

type Company = {
  id: string;
  name: string;
  coa_id: string | null;
  country_iso: string;
  base_currency: string | null;
  city: string;
  address1: string | null;
  address2: string | null;
  postal_code: string | null;
  state: string | null;
  reg_number: string | null;
  vat_number: string | null;
  notes: string | null;
  status: string;
  disabled_at: string | null;
};

/** What a new company starts from. */
const NEW_COMPANY: Company = {
  id: '', name: '', coa_id: null, country_iso: '', base_currency: null, city: '', address1: null, address2: null,
  postal_code: null, state: null, reg_number: null, vat_number: null, notes: null, status: STATUS_ENABLED, disabled_at: null,
};

type TextKey = 'city' | 'address1' | 'address2' | 'postal_code' | 'state' | 'reg_number' | 'vat_number' | 'notes';
type CompanyField = 'name' | 'country_iso' | 'base_currency' | 'coa_id' | 'disabled_at' | TextKey;
type FieldErrors = Partial<Record<CompanyField, string>>;

const COMPANY_FIELDS: ReadonlySet<string> = new Set<CompanyField>([
  'name', 'country_iso', 'base_currency', 'coa_id', 'disabled_at',
  'city', 'address1', 'address2', 'postal_code', 'state', 'reg_number', 'vat_number', 'notes',
]);

/** The field a refusal names in its 400 body (`{ message, field }`), when the form shows it. */
function companyRefusalField(error: unknown): CompanyField | null {
  const raw = (error as { response?: { data?: { field?: unknown } } } | null)?.response?.data?.field;
  const field = raw === 'status' ? 'disabled_at' : raw;
  return typeof field === 'string' && COMPANY_FIELDS.has(field) ? (field as CompanyField) : null;
}

const sectionLabelSx = { fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 1 } as const;
const twoColumnsSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
  columnGap: 3,
} as const;

type AddressField = { field: TextKey; label: string; placeholder: string; required?: boolean };

/** Address and registration rows, shared by the overview and the create form. */
function useOptionalSections() {
  const { t } = useTranslation(['master-data']);
  const address: AddressField[] = [
    { field: 'address1', label: t('companies.fields.address1'), placeholder: t('companies.placeholders.address1') },
    { field: 'address2', label: t('companies.fields.address2'), placeholder: t('companies.placeholders.address2') },
    { field: 'postal_code', label: t('companies.fields.postalCode'), placeholder: t('companies.placeholders.postalCode') },
    { field: 'city', label: t('companies.fields.city'), placeholder: t('companies.placeholders.city'), required: true },
    { field: 'state', label: t('companies.fields.state'), placeholder: t('companies.placeholders.state') },
  ];
  const registration: AddressField[] = [
    { field: 'reg_number', label: t('companies.fields.regNumber'), placeholder: t('companies.placeholders.regNumber') },
    { field: 'vat_number', label: t('companies.fields.vatNumber'), placeholder: t('companies.placeholders.vatNumber') },
  ];
  return { address, registration };
}

export default function CompanyWorkspacePage() {
  const { t } = useTranslation(['master-data', 'common']);
  const theme = useTheme();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const canAdminDataAccess = useDataAccessAdmin();
  const { addToRecent } = useRecentlyViewed();
  const { coas } = useCoaList();
  const sections = useOptionalSections();

  const id = String(params.id || '');
  const isCreate = id === 'new';
  const rawTab = (params.tab as TabKey) || 'overview';
  const tab: TabKey = TAB_KEYS.includes(rawTab)
    && !(isCreate && rawTab !== 'overview')
    && (rawTab !== 'access' || canAdminDataAccess)
    ? rawTab
    : 'overview';
  const canEdit = hasLevel('companies', 'manager');
  const canDelete = hasLevel('companies', 'admin');

  const year = React.useMemo(() => {
    const parsed = Number(searchParams.get('year'));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : new Date().getFullYear();
  }, [searchParams]);

  const nav = useCompanyNav({
    id,
    sort: searchParams.get('sort'),
    q: searchParams.get('q'),
    filters: searchParams.get('filters'),
    year: searchParams.get('year'),
    statusScope: searchParams.get('scope'),
    enabled: !isCreate,
  });

  const detailKey = React.useMemo(() => ['companies', id] as const, [id]);
  // Once deleted, the company is never loaded again, even while the page waits for the list.
  const [deletedId, setDeletedId] = React.useState<string | null>(null);
  const { data: stored, error: loadError } = useQuery({
    queryKey: detailKey,
    queryFn: async () => (await api.get<Company>(`/companies/${id}`)).data,
    enabled: !isCreate && !!id && deletedId !== id,
  });
  // The new page is the company's own page on a draft: the fields write here, Create sends it.
  const [draft, setDraft] = React.useState<Company>(NEW_COMPANY);
  const draftRef = React.useRef(draft);
  const data = isCreate ? draft : stored;

  React.useEffect(() => {
    if (!isCreate && data?.id && data.name) addToRecent('company', data.id, data.name);
  }, [addToRecent, data?.id, data?.name, isCreate]);

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

  // A hidden Access tab falls back to the overview: the URL follows, as on the cost center page.
  React.useEffect(() => {
    if (isCreate || rawTab !== 'access' || canAdminDataAccess) return;
    navigate(`${LIST_PATH}/${id}/overview${listContext ? `?${listContext}` : ''}`, { replace: true });
  }, [canAdminDataAccess, id, isCreate, listContext, navigate, rawTab]);

  const withContext = (path: string) => `${path}${listContext ? `?${listContext}` : ''}`;

  const handleClose = () => navigate(withContext(LIST_PATH));
  const goTo = (targetId: string | null, nextTab: TabKey = tab) => {
    if (targetId) navigate(withContext(`${LIST_PATH}/${targetId}/${nextTab}`));
  };

  const patch = React.useCallback(
    (body: Partial<Company>, field: CompanyField): Promise<boolean> => {
      if (isCreate) {
        // A field filled for the person (the country's currency) loses its mark too.
        setErrors((prev) => ({ ...prev, ...Object.fromEntries(Object.keys(body).map((key) => [key, undefined])), [field]: undefined }));
        draftRef.current = { ...draftRef.current, ...body };
        setDraft(draftRef.current);
        return Promise.resolve(true);
      }
      const recordId = data?.id;
      if (!recordId || !canEdit) return Promise.resolve(false);
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      const run = async (): Promise<boolean> => {
        try {
          const res = await api.patch<Company>(`/companies/${recordId}`, body);
          queryClient.setQueryData(['companies', recordId], res.data);
          void queryClient.invalidateQueries({ queryKey: ['companies'], predicate: (q) => q.queryKey[1] !== recordId });
          return true;
        } catch (e) {
          if (currentIdRef.current !== recordId) return false;
          const target = companyRefusalField(e) ?? field;
          const message = target === 'name' && isDuplicateError(e)
            ? t('companies.messages.nameTaken')
            : getApiErrorMessage(e, t, t('companies.messages.saveFailed'));
          setErrors((prev) => ({ ...prev, [target]: message }));
          return false;
        }
      };
      const result = chainRef.current.then(run, run);
      chainRef.current = result.then(() => undefined, () => undefined);
      return result;
    },
    [canEdit, data?.id, isCreate, queryClient, t],
  );

  // Fields saved on blur show Saving, then Saved. A skipped or refused save does not.
  const [fieldSaves, setFieldSaves] = React.useState(0);
  const [fieldSaved, setFieldSaved] = React.useState(false);
  const savedTimerRef = React.useRef<number | null>(null);
  React.useEffect(() => () => {
    if (savedTimerRef.current != null) window.clearTimeout(savedTimerRef.current);
  }, []);
  const trackSave = React.useCallback((pending: Promise<boolean>) => {
    // A draft is not saved: nothing to show.
    if (isCreate) return;
    if (savedTimerRef.current != null) window.clearTimeout(savedTimerRef.current);
    setFieldSaved(false);
    setFieldSaves((n) => n + 1);
    void pending.then((saved) => {
      if (!saved) return;
      setFieldSaved(true);
      savedTimerRef.current = window.setTimeout(() => {
        savedTimerRef.current = null;
        setFieldSaved(false);
      }, SAVED_LINGER_MS);
    }).finally(() => setFieldSaves((n) => n - 1));
  }, [isCreate]);

  const clearError = (field: CompanyField) => {
    setErrors((prev) => (prev[field] ? { ...prev, [field]: undefined } : prev));
  };

  /**
   * Text fields commit on blur. An empty city is refused here (the column cannot be empty):
   * `false` tells the field to show the stored city again and keep the message.
   */
  const commitText = (field: TextKey, next: string | null): boolean => {
    if (!data) return true;
    // A new company's missing city is said on Create.
    if (field === 'city' && !next && !isCreate) {
      setErrors((prev) => ({ ...prev, city: t('companies.messages.cityRequired') }));
      return false;
    }
    if (next === (data[field] ?? null)) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      return true;
    }
    trackSave(patch({ [field]: next }, field));
    return true;
  };

  /**
   * A chart of accounts tied to another country does not follow the company abroad: the country
   * change carries the new country's default chart (else the global default, else none).
   */
  const currencyChosenRef = React.useRef(false);
  const changeCountry = (country: string) => {
    if (!data || !country || country === data.country_iso) return;
    const body: Partial<Company> = { country_iso: country };
    const current = coas.find((coa) => coa.id === data.coa_id);
    if (current && current.scope === 'COUNTRY' && current.country_iso !== country) {
      body.coa_id = defaultCoaFor(coas, country);
    }
    // A new company gets a chart from its country: the country default, else the global default, else any global chart.
    if (isCreate && !body.coa_id && !(current && current.scope !== 'COUNTRY')) {
      body.coa_id = defaultCoaFor(coas, country) ?? coas.find((coa) => coa.scope === 'GLOBAL')?.id ?? null;
    }
    // A new company takes its country's currency, until the person chooses one.
    const currency = currencyForCountry(country);
    if (isCreate && currency && !currencyChosenRef.current) body.base_currency = currency;
    trackSave(patch(body, 'country_iso'));
  };

  const setYear = (next: number) => {
    const sp = new URLSearchParams(searchParams);
    sp.set('year', String(next));
    setSearchParams(sp, { replace: true });
  };

  // The draft is created once it has its name, country, currency and city; the company then opens,
  // every tab available, with Create (kept, back where the creation started) and Cancel (deleted).
  const leave = useCreationLeave(handleClose);
  const title = useCreationTitle({
    requiredMessage: t('companies.messages.nameRequired'),
    onCancel: leave,
    onCommit: () => creation.attempt(),
  });
  const [createError, setCreateError] = React.useState<string | null>(null);
  const missingFields = (): FieldErrors => {
    const values = draftRef.current;
    const missing: FieldErrors = {};
    if (!values.country_iso) missing.country_iso = t('companies.messages.countryRequired');
    if (!values.base_currency) missing.base_currency = t('companies.messages.currencyRequired');
    if (!values.city) missing.city = t('companies.messages.cityRequired');
    return missing;
  };
  const creation = useDraftCreation({
    isCreate,
    family: 'companies',
    apiBase: '/companies',
    recordId: stored?.id ?? null,
    listPath: withContext(LIST_PATH),
    recordLabel: t('companies.creationRecord'),
    queryKeyPrefixes: ['companies'],
    ready: () => !!title.current().trim() && Object.keys(missingFields()).length === 0,
    post: async () => {
      setCreateError(null);
      try {
        const { id: _id, name: _name, ...fields } = draftRef.current;
        const { data: created } = await api.post<Company & { creation_token: string }>('/companies', { ...fields, name: title.current().trim() });
        void queryClient.invalidateQueries({ queryKey: ['companies'] });
        return { id: created.id, token: created.creation_token, path: withContext(`${LIST_PATH}/${created.id}/overview`) };
      } catch (e) {
        const message = getApiErrorMessage(e, t, t('companies.messages.createFailed'));
        const field = isDuplicateError(e) ? 'name' : companyRefusalField(e);
        if (field === 'name') title.refuse(isDuplicateError(e) ? t('companies.messages.nameTaken') : message);
        else if (field) setErrors((prev) => ({ ...prev, [field]: message }));
        else setCreateError(message);
        return null;
      }
    },
    onError: setCreateError,
  });
  React.useEffect(() => { creation.attempt(); }, [creation.attempt, draft]);
  const handleCreate = () => {
    if (creation.beingCreated) {
      creation.finishCreation();
      return;
    }
    if (!canEdit) return;
    const name = title.require();
    const missing = missingFields();
    setErrors((prev) => ({ ...prev, ...missing }));
    if (!name || Object.keys(missing).length > 0) return;
    void creation.createAndLeave();
  };

  const disabled = !canEdit;
  const tabs = [
    { key: 'overview', label: t('shared.labels.overview') },
    { key: 'details', label: t('shared.labels.details'), disabled: isCreate },
    ...(canAdminDataAccess ? [{ key: 'access', label: t('shared.labels.access'), disabled: isCreate }] : []),
    { key: RECORD_HISTORY_TAB_KEY, label: t('shared.labels.history'), disabled: isCreate },
  ];

  // The header shows the status as the supplier's does: the menu disables at once (end of
  // validity now, set by the server) or enables again (no end of validity).
  const status = normalizeStatus(data?.status);
  const enabledColor = getDotColor('success', theme.palette.mode);
  const disabledColor = getDotColor('default', theme.palette.mode);
  const statusLabel = (value: StatusValue) => (value === STATUS_DISABLED ? t('companies.status.disabled') : t('companies.status.enabled'));
  const changeStatus = (next: StatusValue) => {
    if (!data || next === status) return;
    if (next === STATUS_DISABLED) trackSave(patch({ status: STATUS_DISABLED }, 'disabled_at'));
    else trackSave(patch({ status: STATUS_ENABLED, disabled_at: null }, 'disabled_at'));
  };
  const metadata = data ? (
    <PortfolioMetadataItem label={t('companies.fields.status')}>
      <PortfolioStatusMetadata
        value={status}
        label={statusLabel(status)}
        color={status === STATUS_DISABLED ? disabledColor : enabledColor}
        options={[
          { value: STATUS_ENABLED, label: statusLabel(STATUS_ENABLED), color: enabledColor },
          { value: STATUS_DISABLED, label: statusLabel(STATUS_DISABLED), color: disabledColor },
        ]}
        onChange={(value) => changeStatus(value as StatusValue)}
        disabled={disabled}
      />
    </PortfolioMetadataItem>
  ) : undefined;

  const properties = data ? (
    <PropertyGroup>
      <PropertyRow label={t('companies.fields.country')} required>
        <CountryField
          value={data.country_iso}
          onChange={changeCountry}
          clearable={false}
          disabled={disabled}
          error={errors.country_iso}
        />
      </PropertyRow>
      <PropertyRow label={t('companies.fields.baseCurrency')} required>
        <CurrencyField
          value={data.base_currency ?? ''}
          onChange={(currency) => {
            currencyChosenRef.current = true;
            if (currency && currency !== data.base_currency) trackSave(patch({ base_currency: currency }, 'base_currency'));
          }}
          clearable={false}
          disabled={disabled}
          error={errors.base_currency}
        />
      </PropertyRow>
      <PropertyRow label={t('companies.fields.chartOfAccounts')}>
        <CoaField
          coas={coas}
          country={data.country_iso}
          value={data.coa_id}
          onChange={(coaId) => {
            if (coaId && coaId !== data.coa_id) trackSave(patch({ coa_id: coaId }, 'coa_id'));
          }}
          // The server gives an emptied chart the country default back, so it is not cleared here.
          clearable={false}
          disabled={disabled}
          error={errors.coa_id}
        />
      </PropertyRow>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: '5px' }}>
        <Typography sx={{ fontSize: 12, lineHeight: 1.3, color: 'kanap.text.tertiary' }}>
          {t('companies.fields.lifecycle')}
        </Typography>
        <StatusLifecycleField
          status={status}
          // The date carries the change (the switch sets it too); the server derives the status from it.
          onStatusChange={() => undefined}
          disabledAt={data.disabled_at}
          onDisabledAtChange={(disabledAt) => {
            if (disabledAt === data.disabled_at) return;
            trackSave(patch({ status: deriveStatusFromDisabledAt(disabledAt), disabled_at: disabledAt }, 'disabled_at'));
          }}
          // Disable now: the status alone, the server sets the end of validity from its own clock.
          onDisableNow={() => trackSave(patch({ status: STATUS_DISABLED }, 'disabled_at'))}
          disabled={disabled}
          disabledAtError={!!errors.disabled_at}
          disabledAtHelperText={errors.disabled_at}
        />
      </Box>
    </PropertyGroup>
  ) : <Box />;

  const renderTextRow = (row: AddressField) => (
    <CompanyTextRow
      key={row.field}
      label={row.label}
      placeholder={row.placeholder}
      required={row.required}
      value={row.field === 'city' ? displayedCompanyCity(data?.[row.field]) : (data?.[row.field] ?? '')}
      disabled={disabled}
      error={errors[row.field]}
      onCommit={(next) => commitText(row.field, next)}
      onEdit={() => clearError(row.field)}
    />
  );

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={loadError ? <Alert severity="error">{t('companies.loadError')}</Alert> : undefined}
        activeTab={tab}
        tabs={tabs}
        onTabChange={(next) => goTo(id, next as TabKey)}
        drawerStorageKey="kanap.companies.drawerOpen"
        backLabel={t('companies.title')}
        onBack={isCreate ? leave : handleClose}
        {...(isCreate ? title.shellProps : { title: data?.name ?? '' })}
        titleFallback={isCreate ? t('companies.newCompany') : t('companies.companyFallback')}
        isCreate={isCreate}
        // A new record's required fields sit in the drawer: it stays open.
        forceDrawerOpen={isCreate}
        titleEditor={data && !isCreate ? (
          <CompanyNameTitle
            key={data.id}
            name={data.name}
            fallback={t('companies.companyFallback')}
            canEdit={canEdit}
            error={errors.name}
            onSave={(next) => { trackSave(patch({ name: next }, 'name')); }}
            onClearError={() => clearError('name')}
          />
        ) : undefined}
        nav={!isCreate && nav.total > 0 ? {
          currentIndex: nav.index + 1,
          totalCount: nav.total,
          hasPrev: nav.hasPrev,
          hasNext: nav.hasNext,
          onPrev: () => goTo(nav.prevId),
          onNext: () => goTo(nav.nextId),
          previousLabel: t('companies.previous'),
          nextLabel: t('companies.next'),
        } : undefined}
        metadata={metadata}
        actions={isCreate || creation.beingCreated ? (
          <CreationActions
            onCreate={handleCreate}
            onCancel={isCreate ? leave : () => { void creation.cancelCreation(); }}
            busy={!canEdit || creation.busy}
          />
        ) : (fieldSaves > 0 || fieldSaved || (data && canDelete)) ? (
          <>
            {(fieldSaves > 0 || fieldSaved) && (
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', alignSelf: 'center' }}>
                {fieldSaves > 0 ? t('common:status.saving') : t('common:status.saved')}
              </Typography>
            )}
            {data && canDelete && (
              <RecordDeleteButton base="/companies" id={data.id} name={data.name} deleteFailed="companies.messages.deleteFailed" onDeleted={() => { setDeletedId(data.id); handleClose(); }} />
            )}
          </>
        ) : undefined}
        properties={properties}
      >
        {data && tab === 'overview' && (
          // Keyed by company: drafts start afresh on the next record.
          <Stack key={data.id} spacing={3} sx={{ maxWidth: 900 }}>
            <Box>
              <Typography sx={sectionLabelSx}>{t('companies.sections.address')}</Typography>
              <Box sx={twoColumnsSx}>{sections.address.map(renderTextRow)}</Box>
            </Box>
            <Box>
              <Typography sx={sectionLabelSx}>{t('companies.sections.registration')}</Typography>
              <Box sx={twoColumnsSx}>{sections.registration.map(renderTextRow)}</Box>
            </Box>
            <NotesField
              value={data.notes ?? ''}
              disabled={disabled}
              error={errors.notes}
              onCommit={(notes) => commitText('notes', notes)}
              onEdit={() => clearError('notes')}
            />
            {createError && <Alert severity="error">{createError}</Alert>}
          </Stack>
        )}
        {data && tab === 'details' && (
          <CompanyMetricsTab
            companyId={data.id}
            year={year}
            onYearChange={setYear}
            readOnly={!canEdit}
            baseCurrency={data.base_currency ?? ''}
            onSave={trackSave}
          />
        )}
        {data && tab === 'access' && canAdminDataAccess && (
          <CompanyAccessTab companyId={data.id} nodeLabel={data.name} />
        )}
        {data && tab === RECORD_HISTORY_TAB_KEY && (
          <WorkspaceTabBoundary resetKey={tab} onRetry={() => historyTab.retry()}>
            <React.Suspense fallback={null}>
              <HistoryTab table="companies" recordId={data.id} />
            </React.Suspense>
          </WorkspaceTabBoundary>
        )}
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}

/**
 * The company name as the page title. A name the server refuses stays on screen with its message.
 * The message goes as soon as the name changes, and cancelling shows the stored name again.
 */
function CompanyNameTitle({
  name,
  fallback,
  canEdit,
  error,
  onSave,
  onClearError,
}: {
  name: string;
  fallback: string;
  canEdit: boolean;
  error?: string;
  onSave: (next: string) => void;
  onClearError: () => void;
}) {
  const { t } = useTranslation(['master-data']);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(name);
  // The name just sent, kept until the stored name catches up or the user leaves it.
  // Not dropped when the save clears the error at the start of the request.
  const [pending, setPending] = React.useState<string | null>(null);
  const openRef = React.useRef(false);
  const shown = pending ?? name;

  React.useEffect(() => {
    if (pending !== null && name === pending) setPending(null);
  }, [name, pending]);

  const helper = error ? <FormHelperText error sx={{ mt: 0.5 }}>{error}</FormHelperText> : null;

  if (!editing) {
    return (
      <>
        <EditableTitleDisplay
          canEdit={canEdit}
          placeholder={!shown}
          onEdit={() => {
            setDraft(shown);
            openRef.current = true;
            setEditing(true);
          }}
        >
          {shown || fallback}
        </EditableTitleDisplay>
        {helper}
      </>
    );
  }

  const closeAsStored = () => {
    openRef.current = false;
    setPending(null);
    onClearError();
    setEditing(false);
  };
  const commit = () => {
    if (!openRef.current) return;
    const next = draft.trim();
    if (!next || next === name) {
      closeAsStored();
      return;
    }
    openRef.current = false;
    setPending(next);
    setEditing(false);
    onSave(next);
  };

  return (
    <>
      <Box
        component="input"
        autoFocus
        value={draft}
        aria-label={t('companies.fields.name')}
        aria-invalid={error ? true : undefined}
        onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
          setDraft(event.target.value);
          onClearError();
        }}
        onBlur={commit}
        onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            closeAsStored();
          }
        }}
        sx={(theme) => ({
          font: 'inherit',
          color: 'inherit',
          bgcolor: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${error ? theme.palette.error.main : theme.palette.kanap.border.default}`,
          outline: 'none',
          p: 0,
          m: 0,
          width: '100%',
          '&:focus': { borderBottomColor: error ? theme.palette.error.main : theme.palette.kanap.teal },
        })}
      />
      {helper}
    </>
  );
}

function CompanyTextRow({
  label,
  placeholder,
  required,
  value,
  disabled,
  error,
  onCommit,
  onEdit,
}: {
  label: string;
  placeholder: string;
  required?: boolean;
  value: string;
  disabled: boolean;
  error?: string;
  onCommit: (next: string | null) => boolean;
  onEdit: () => void;
}) {
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  return (
    <PropertyRow label={label} required={required}>
      <TextField
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onEdit();
        }}
        onFocus={onFocus}
        onBlur={() => {
          onBlur();
          if (!onCommit(draft.trim() || null)) setDraft(value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        variant="standard"
        sx={drawerFieldValueSx}
        placeholder={placeholder}
        disabled={disabled}
        error={!!error}
        helperText={error}
        inputProps={{ 'aria-label': label }}
      />
    </PropertyRow>
  );
}

function NotesField({
  value,
  disabled,
  error,
  onCommit,
  onEdit,
}: {
  value: string;
  disabled: boolean;
  error?: string;
  onCommit: (next: string | null) => boolean;
  onEdit: () => void;
}) {
  const { t } = useTranslation(['master-data']);
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  return (
    <Box>
      <Typography sx={sectionLabelSx}>{t('companies.fields.notes')}</Typography>
      <TextField
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          onEdit();
        }}
        onFocus={onFocus}
        onBlur={() => {
          onBlur();
          onCommit(draft.trim() || null);
        }}
        multiline
        minRows={3}
        variant="standard"
        placeholder={t('companies.placeholders.notes')}
        disabled={disabled}
        error={!!error}
        helperText={error}
        sx={longFormSurfaceFieldSx}
        inputProps={{ 'aria-label': t('companies.fields.notes') }}
      />
    </Box>
  );
}
