import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useCompanyNav } from '../../hooks/useCompanyNav';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PropertyGroup, PropertyRow } from '../../components/design';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import { STATUS_ENABLED, deriveStatusFromDisabledAt, normalizeStatus } from '../../constants/status';
import { drawerFieldValueSx, longFormSurfaceFieldSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useCoaList } from '../coa/useCoaList';
import { CoaField, CountryField, CurrencyField, defaultCoaFor } from './CompanyFields';
import CompanyMetricsTab from './CompanyMetricsTab';

type TabKey = 'overview' | 'details';
const TAB_KEYS: TabKey[] = ['overview', 'details'];
const LIST_PATH = '/master-data/companies';

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
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const { coas } = useCoaList();
  const sections = useOptionalSections();

  const id = String(params.id || '');
  const isCreate = id === 'new';
  const rawTab = (params.tab as TabKey) || 'overview';
  const tab: TabKey = TAB_KEYS.includes(rawTab) && !(isCreate && rawTab !== 'overview') ? rawTab : 'overview';
  const canEdit = hasLevel('companies', 'manager');

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
  const { data, error: loadError } = useQuery({
    queryKey: detailKey,
    queryFn: async () => (await api.get<Company>(`/companies/${id}`)).data,
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
    (body: Partial<Company>, field: CompanyField): Promise<void> => {
      const recordId = data?.id;
      if (!recordId || !canEdit) return Promise.resolve();
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      const run = async () => {
        try {
          const res = await api.patch<Company>(`/companies/${recordId}`, body);
          queryClient.setQueryData(['companies', recordId], res.data);
          void queryClient.invalidateQueries({ queryKey: ['companies'], predicate: (q) => q.queryKey[1] !== recordId });
        } catch (e) {
          if (currentIdRef.current !== recordId) return;
          const message = getApiErrorMessage(e, t, t('companies.messages.saveFailed'));
          const target = companyRefusalField(e) ?? field;
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

  /** Text fields commit on blur; an empty city is refused here, the column cannot be empty. */
  const commitText = (field: TextKey, next: string | null) => {
    if (!data) return;
    if (field === 'city' && !next) {
      setErrors((prev) => ({ ...prev, city: t('companies.messages.cityRequired') }));
      return;
    }
    if (next === (data[field] ?? null)) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      return;
    }
    void patch({ [field]: next }, field);
  };

  /**
   * A chart of accounts tied to another country does not follow the company abroad: the country
   * change carries the new country's default chart (else the global default, else none).
   */
  const changeCountry = (country: string) => {
    if (!data || !country || country === data.country_iso) return;
    const body: Partial<Company> = { country_iso: country };
    const current = coas.find((coa) => coa.id === data.coa_id);
    if (current && current.scope === 'COUNTRY' && current.country_iso !== country) {
      body.coa_id = defaultCoaFor(coas, country);
    }
    void patch(body, 'country_iso');
  };

  const setYear = (next: number) => {
    const sp = new URLSearchParams(searchParams);
    sp.set('year', String(next));
    setSearchParams(sp, { replace: true });
  };

  if (isCreate) {
    return (
      <CompanyCreate
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
            if (currency && currency !== data.base_currency) void patch({ base_currency: currency }, 'base_currency');
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
            if (coaId && coaId !== data.coa_id) void patch({ coa_id: coaId }, 'coa_id');
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

  const renderTextRow = (row: AddressField) => (
    <CompanyTextRow
      key={row.field}
      label={row.label}
      placeholder={row.placeholder}
      required={row.required}
      value={data?.[row.field] ?? ''}
      disabled={disabled}
      error={errors[row.field]}
      onCommit={(next) => commitText(row.field, next)}
    />
  );

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {(pageError || loadError) && (
        <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={pageError ? () => setPageError(null) : undefined}>
          {pageError ?? t('companies.loadError')}
        </Alert>
      )}
      <PortfolioDetailWorkspaceShell
        activeTab={tab}
        tabs={tabs}
        onTabChange={(next) => goTo(id, next as TabKey)}
        drawerStorageKey="kanap.companies.drawerOpen"
        backLabel={t('companies.title')}
        onBack={handleClose}
        title={data?.name ?? ''}
        titleFallback={t('companies.companyFallback')}
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
          previousLabel: t('companies.previous'),
          nextLabel: t('companies.next'),
        } : undefined}
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
            />
          </Stack>
        )}
        {data && tab === 'details' && (
          <CompanyMetricsTab
            companyId={data.id}
            year={year}
            onYearChange={setYear}
            readOnly={!canEdit}
          />
        )}
      </PortfolioDetailWorkspaceShell>
    </Box>
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
}: {
  label: string;
  placeholder: string;
  required?: boolean;
  value: string;
  disabled: boolean;
  error?: string;
  onCommit: (next: string | null) => void;
}) {
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  return (
    <PropertyRow label={label} required={required}>
      <TextField
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        onBlur={() => {
          onBlur();
          onCommit(draft.trim() || null);
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
      <Typography sx={sectionLabelSx}>{t('companies.fields.notes')}</Typography>
      <TextField
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
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

type CreateValues = {
  name: string;
  country_iso: string;
  base_currency: string;
  coa_id: string | null;
} & Record<TextKey, string>;

const EMPTY_CREATE: CreateValues = {
  name: '',
  country_iso: '',
  base_currency: '',
  coa_id: null,
  city: '',
  address1: '',
  address2: '',
  postal_code: '',
  state: '',
  reg_number: '',
  vat_number: '',
  notes: '',
};

function CompanyCreate({
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
  const { coas } = useCoaList();
  const sections = useOptionalSections();
  const [values, setValues] = React.useState<CreateValues>(EMPTY_CREATE);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const set = <K extends keyof CreateValues>(field: K, value: CreateValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  /** The chart is preselected from the country (country default, else global default, else any global chart). */
  const changeCountry = (country: string) => {
    setValues((prev) => {
      const current = coas.find((coa) => coa.id === prev.coa_id);
      const keep = current && !(current.scope === 'COUNTRY' && current.country_iso !== country);
      const preselected = country
        ? defaultCoaFor(coas, country) ?? coas.find((coa) => coa.scope === 'GLOBAL')?.id ?? null
        : null;
      return { ...prev, country_iso: country, coa_id: keep ? prev.coa_id : preselected };
    });
  };

  const handleCreate = async () => {
    if (!canCreate || submitting) return;
    const name = values.name.trim();
    const city = values.city.trim();
    const nextErrors: FieldErrors = {};
    if (!name) nextErrors.name = t('companies.messages.nameRequired');
    if (!values.country_iso) nextErrors.country_iso = t('companies.messages.countryRequired');
    if (!values.base_currency) nextErrors.base_currency = t('companies.messages.currencyRequired');
    if (!city) nextErrors.city = t('companies.messages.cityRequired');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    setServerError(null);
    const optional = (value: string) => value.trim() || null;
    try {
      const res = await api.post<Company>('/companies', {
        name,
        coa_id: values.coa_id,
        country_iso: values.country_iso,
        city,
        postal_code: optional(values.postal_code),
        address1: optional(values.address1),
        address2: optional(values.address2),
        reg_number: optional(values.reg_number),
        vat_number: optional(values.vat_number),
        state: optional(values.state),
        base_currency: values.base_currency,
        status: STATUS_ENABLED,
        disabled_at: null,
        notes: optional(values.notes),
      });
      void queryClient.invalidateQueries({ queryKey: ['companies'] });
      onCreated(res.data.id);
    } catch (e) {
      const message = getApiErrorMessage(e, t, t('companies.messages.createFailed'));
      const field = companyRefusalField(e);
      if (field && field !== 'disabled_at') setErrors({ [field]: message });
      else setServerError(message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderTextRow = (row: AddressField) => (
    <PropertyRow key={row.field} label={row.label} required={row.required}>
      <TextField
        value={values[row.field]}
        onChange={(e) => set(row.field, e.target.value)}
        variant="standard"
        sx={drawerFieldValueSx}
        placeholder={row.placeholder}
        error={!!errors[row.field]}
        helperText={errors[row.field]}
        inputProps={{ 'aria-label': row.label, autoComplete: 'off' }}
      />
    </PropertyRow>
  );
  const city = sections.address.find((row) => row.field === 'city') as AddressField;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        activeTab="overview"
        tabs={[
          { key: 'overview', label: t('shared.labels.overview') },
          { key: 'details', label: t('shared.labels.details'), disabled: true },
        ]}
        onTabChange={() => undefined}
        drawerStorageKey="kanap.companies.drawerOpen"
        backLabel={t('companies.title')}
        onBack={onClose}
        title={values.name}
        titleFallback={t('companies.newCompany')}
        isCreate
        actions={(
          <Button variant="contained" size="small" onClick={() => void handleCreate()} disabled={!canCreate || submitting}>
            {t('common:buttons.create')}
          </Button>
        )}
      >
        <Stack spacing={3} sx={{ maxWidth: 560 }}>
          <Box>
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mb: 1.5 }}>{t('companies.detailsTabHint')}</Typography>
            <PropertyRow label={t('companies.fields.name')} required valueSx={{ maxWidth: 520 }}>
              <TextField
                value={values.name}
                onChange={(e) => set('name', e.target.value)}
                variant="standard"
                sx={drawerFieldValueSx}
                placeholder={t('companies.placeholders.name')}
                error={!!errors.name}
                helperText={errors.name}
                inputProps={{ 'aria-label': t('companies.fields.name'), autoComplete: 'off' }}
              />
            </PropertyRow>
            <Box sx={twoColumnsSx}>
              <PropertyRow label={t('companies.fields.country')} required>
                <CountryField value={values.country_iso} onChange={changeCountry} clearable error={errors.country_iso} />
              </PropertyRow>
              <PropertyRow label={t('companies.fields.baseCurrency')} required>
                <CurrencyField
                  value={values.base_currency}
                  onChange={(currency) => set('base_currency', currency)}
                  clearable
                  error={errors.base_currency}
                />
              </PropertyRow>
              <PropertyRow label={t('companies.fields.chartOfAccounts')}>
                <CoaField
                  coas={coas}
                  country={values.country_iso}
                  value={values.coa_id}
                  onChange={(coaId) => set('coa_id', coaId)}
                  clearable
                  error={errors.coa_id}
                />
              </PropertyRow>
              {renderTextRow(city)}
            </Box>
          </Box>
          <Box>
            <Typography sx={sectionLabelSx}>{t('companies.sections.address')}</Typography>
            <Box sx={twoColumnsSx}>{sections.address.filter((row) => row.field !== 'city').map(renderTextRow)}</Box>
          </Box>
          <Box>
            <Typography sx={sectionLabelSx}>{t('companies.sections.registration')}</Typography>
            <Box sx={twoColumnsSx}>{sections.registration.map(renderTextRow)}</Box>
          </Box>
          <PropertyRow label={t('companies.fields.notes')} valueSx={{ maxWidth: 560 }}>
            <TextField
              value={values.notes}
              onChange={(e) => set('notes', e.target.value)}
              multiline
              minRows={2}
              variant="standard"
              sx={drawerFieldValueSx}
              placeholder={t('companies.placeholders.notes')}
              error={!!errors.notes}
              helperText={errors.notes}
              inputProps={{ 'aria-label': t('companies.fields.notes') }}
            />
          </PropertyRow>
          {serverError && <Alert severity="error">{serverError}</Alert>}
        </Stack>
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}
