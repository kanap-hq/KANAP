import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useAccountNav } from '../../hooks/useAccountNav';
import type { ModuleItemNavResult } from '../../hooks/useModuleItemNav';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PropertyGroup, PropertyRow } from '../../components/design';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import { STATUS_ENABLED, deriveStatusFromDisabledAt, normalizeStatus } from '../../constants/status';
import { drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx, longFormSurfaceFieldSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { COA_LIST_QUERY_KEY, type CoaListItem, useCoaList } from '../coa/useCoaList';
import ConsolidationAccountField, { type ConsolidationStatus } from './ConsolidationAccountField';
import {
  type AccountLineCounts,
  type AccountNature,
  accountNatureConflict,
  parseAccountNature,
} from '../../constants/accountNature';
import LineTypeUsageSelect, { LineTypeUsageConflictNote } from '../../components/fields/LineTypeUsageSelect';
import { oneOffListLink } from '../reports/reportListLink';
import ListLinkAnchor from '../reports/ListLinkAnchor';
import { keepValues } from '../reports/reportAggregates';

const LIST_PATH = '/master-data/coa';
const ACCOUNT_PATH = '/master-data/accounts';
/** The charts of accounts page's state, carried to the workspace and back. */
const LIST_CONTEXT_KEYS = ['sort', 'q', 'filters', 'scope', 'selected', 'coaId', 'consolidation'];
/** Account numbers are stored as a 32-bit integer. */
const MAX_ACCOUNT_NUMBER = 2_147_483_647;

type Account = {
  id: string;
  coa_id: string | null;
  account_number: number | string;
  account_name: string;
  native_name: string | null;
  description: string | null;
  consolidation_account_number: number | null;
  consolidation_account_name: string | null;
  consolidation_account_description: string | null;
  /** Null when the tenant has no consolidation chart. */
  consolidation_status?: ConsolidationStatus | null;
  /** The lines that may use the account: null for OPEX and CAPEX lines. */
  nature?: AccountNature | null;
  /** The OPEX and CAPEX lines (all statuses) using the account; on `GET /accounts/:id` only. */
  line_counts?: AccountLineCounts;
  status: string;
  disabled_at: string | null;
};

type TextKey = 'native_name' | 'description';
/** Fields typed in place and saved on blur: a revert must reach the server even mid-save. */
type TypedField = TextKey | 'account_name' | 'account_number';
type AccountField = 'account_name' | 'account_number' | 'coa_id' | 'consolidation_account_number' | 'disabled_at' | 'nature' | TextKey;
type FieldErrors = Partial<Record<AccountField, string>>;

const ACCOUNT_FIELDS: ReadonlySet<string> = new Set<AccountField>([
  'account_name', 'account_number', 'coa_id', 'consolidation_account_number', 'disabled_at', 'nature', 'native_name', 'description',
]);

/** The field a refusal names in its 400 body (`{ message, field }`), when the form shows it. */
function accountRefusalField(error: unknown): AccountField | null {
  const raw = (error as { response?: { data?: { field?: unknown } } } | null)?.response?.data?.field;
  const field = raw === 'status' ? 'disabled_at' : raw;
  return typeof field === 'string' && ACCOUNT_FIELDS.has(field) ? (field as AccountField) : null;
}

function httpStatus(error: unknown): number | undefined {
  return (error as { response?: { status?: number } } | null)?.response?.status;
}

/** A positive whole number that fits the column, or null. */
function parseAccountNumber(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_ACCOUNT_NUMBER ? value : null;
}

function parseConsolidationFilter(raw: string | null): 'outside' | 'unmapped' | undefined {
  return raw === 'outside' || raw === 'unmapped' ? raw : undefined;
}

const sectionLabelSx = { fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 1 } as const;

export default function AccountWorkspacePage() {
  const { t } = useTranslation(['master-data', 'common']);
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const { coas, isLoading: coasLoading } = useCoaList();

  const id = String(params.id || '');
  const isCreate = id === 'new';
  const canEdit = hasLevel('accounts', 'manager');
  const coaId = searchParams.get('selected') || searchParams.get('coaId');
  const consolidationChart = coas.find((coa) => coa.is_consolidation);
  const consolidationChartId = consolidationChart?.id;
  // As on the charts page, the filter needs a consolidation chart: without one the list ignores it.
  const consolidationFilter = coasLoading || consolidationChart
    ? parseConsolidationFilter(searchParams.get('consolidation'))
    : undefined;

  const nav = useAccountNav({
    id,
    sort: searchParams.get('sort'),
    q: searchParams.get('q'),
    filters: searchParams.get('filters'),
    statusScope: searchParams.get('scope'),
    extraParams: { coaId: coaId || undefined, consolidationStatus: consolidationFilter },
    enabled: !isCreate,
  });
  // An account fixed while walking a filtered list (an unmapped account now mapped) leaves that
  // list: the position it had stays, so "next" still goes on to the following one.
  const lastNavRef = React.useRef<{ id: string; nav: ModuleItemNavResult } | null>(null);
  if (nav.total > 0) lastNavRef.current = { id, nav };
  const shownNav = nav.total > 0 ? nav : (lastNavRef.current?.id === id ? lastNavRef.current.nav : null);

  const { data, error: loadError } = useQuery({
    queryKey: ['accounts', id],
    queryFn: async () => (await api.get<Account>(`/accounts/${id}`)).data,
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
    for (const key of LIST_CONTEXT_KEYS) {
      const value = searchParams.get(key);
      if (value) sp.set(key, value);
    }
    return sp.toString();
  }, [searchParams]);
  const withContext = (path: string) => `${path}${listContext ? `?${listContext}` : ''}`;

  const handleClose = () => navigate(withContext(LIST_PATH));
  const goTo = (targetId: string | null) => {
    if (targetId) navigate(withContext(`${ACCOUNT_PATH}/${targetId}/overview`));
  };

  /** Refreshes what a write changes; `chartIds` are the account's charts before and after it. */
  const afterWrite = React.useCallback((chartIds: Array<string | null | undefined>) => {
    // The grid and this account (its consolidation status); the consolidation chart's accounts
    // only when the write touched that chart.
    const refreshOptions = !!consolidationChartId && chartIds.includes(consolidationChartId);
    void queryClient.invalidateQueries({
      queryKey: ['accounts'],
      predicate: (query) => refreshOptions || query.queryKey[1] !== 'consolidation-options',
    });
    void queryClient.invalidateQueries({ queryKey: ['accounts-ids'] });
    void queryClient.invalidateQueries({ queryKey: COA_LIST_QUERY_KEY });
  }, [consolidationChartId, queryClient]);

  const patch = React.useCallback(
    (body: Partial<Account>, field: AccountField): Promise<void> => {
      const recordId = data?.id;
      if (!recordId || !canEdit) return Promise.resolve();
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      const run = async () => {
        const chartBefore = queryClient.getQueryData<Account>(['accounts', recordId])?.coa_id;
        try {
          const res = await api.patch<Account>(`/accounts/${recordId}`, body);
          queryClient.setQueryData<Account>(['accounts', recordId], (prev) => ({ ...prev, ...res.data }));
          afterWrite([chartBefore, res.data?.coa_id]);
        } catch (e) {
          if (currentIdRef.current !== recordId) return;
          const message = getApiErrorMessage(e, t, t('accounts.messages.saveFailed'));
          const target = accountRefusalField(e) ?? field;
          if (target === 'account_name') setPageError(message);
          else setErrors((prev) => ({ ...prev, [target]: message }));
        }
      };
      const result = chainRef.current.then(run, run);
      chainRef.current = result.catch(() => undefined);
      return result;
    },
    [afterWrite, canEdit, data?.id, queryClient, t],
  );

  // The last value sent per field while its writes are in flight (keyed by account and field):
  // `data` shows the server's value only once they settle, so a field edited back to its stored
  // value before the first write returns is compared against what was sent, and sent too.
  const inFlightRef = React.useRef(new Map<string, { value: unknown; count: number }>());

  const commitTyped = (field: TypedField, next: string | number | null, stored: string | number | null) => {
    if (!data) return;
    const key = `${data.id}:${field}`;
    const inFlight = inFlightRef.current.get(key);
    if (next === (inFlight ? inFlight.value : stored)) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
      return;
    }
    inFlightRef.current.set(key, { value: next, count: (inFlight?.count ?? 0) + 1 });
    void patch({ [field]: next }, field).finally(() => {
      const entry = inFlightRef.current.get(key);
      if (!entry) return;
      if (entry.count <= 1) inFlightRef.current.delete(key);
      else inFlightRef.current.set(key, { ...entry, count: entry.count - 1 });
    });
  };

  const commitText = (field: TextKey, next: string | null) => {
    if (!data) return;
    commitTyped(field, next, data[field] ?? null);
  };

  const commitNumber = (raw: string) => {
    if (!data) return;
    const next = parseAccountNumber(raw);
    if (next == null) {
      setErrors((prev) => ({ ...prev, account_number: t('accounts.messages.numberInvalid') }));
      return;
    }
    commitTyped('account_number', next, Number(data.account_number));
  };

  if (isCreate) {
    return (
      <AccountCreate
        canCreate={canEdit}
        coas={coas}
        coasLoaded={!coasLoading}
        consolidationChart={consolidationChart}
        preselectedCoaId={coaId}
        onClose={handleClose}
        onCreated={(newId) => {
          const query = searchParams.toString();
          navigate(`${ACCOUNT_PATH}/${newId}/overview${query ? `?${query}` : ''}`);
        }}
      />
    );
  }

  const disabled = !canEdit;
  const reference = data ? String(data.account_number) : null;

  const properties = data ? (
    <>
      <PropertyGroup>
        <PropertyRow label={t('accounts.fields.chartOfAccounts')} required>
          <ChartSelect
            coas={coas}
            value={data.coa_id}
            disabled={disabled}
            error={errors.coa_id}
            onChange={(next) => {
              if (next && next !== data.coa_id) void patch({ coa_id: next }, 'coa_id');
            }}
          />
        </PropertyRow>
        <AccountNumberRow
          key={data.id}
          value={String(data.account_number)}
          disabled={disabled}
          error={errors.account_number}
          onCommit={commitNumber}
        />
        <PropertyRow label={t('accounts.fields.nature')}>
          <LineTypeUsageSelect
            value={parseAccountNature(data.nature)}
            label={t('accounts.fields.nature')}
            disabled={disabled}
            error={errors.nature}
            onChange={(next) => {
              if (next !== parseAccountNature(data.nature)) void patch({ nature: next }, 'nature');
            }}
          />
          <NatureConflictNote accountId={data.id} nature={parseAccountNature(data.nature)} lineCounts={data.line_counts} />
        </PropertyRow>
      </PropertyGroup>
      <PropertyGroup>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, py: '5px' }}>
          <Typography sx={{ fontSize: 12, lineHeight: 1.3, color: 'kanap.text.tertiary' }}>
            {t('accounts.fields.lifecycle')}
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
    </>
  ) : <Box />;

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {(pageError || loadError) && (
        <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={pageError ? () => setPageError(null) : undefined}>
          {pageError ?? t('accounts.loadError')}
        </Alert>
      )}
      <PortfolioDetailWorkspaceShell
        activeTab="overview"
        tabs={[{ key: 'overview', label: t('shared.labels.overview') }]}
        onTabChange={() => undefined}
        drawerStorageKey="kanap.accounts.drawerOpen"
        backLabel={t('coa.title')}
        onBack={handleClose}
        itemReference={reference}
        onCopyReference={reference ? () => { void navigator.clipboard?.writeText(reference); } : undefined}
        title={data?.account_name ?? ''}
        titleFallback={t('accounts.accountFallback')}
        canEditTitle={canEdit && !!data}
        onTitleSave={(next) => {
          if (data) commitTyped('account_name', next, data.account_name);
        }}
        nav={shownNav ? {
          currentIndex: shownNav.index + 1,
          totalCount: shownNav.total,
          hasPrev: shownNav.hasPrev,
          hasNext: shownNav.hasNext,
          onPrev: () => goTo(shownNav.prevId),
          onNext: () => goTo(shownNav.nextId),
          previousLabel: t('accounts.previous'),
          nextLabel: t('accounts.next'),
        } : undefined}
        properties={properties}
      >
        {data && (
          // Keyed by account: drafts start afresh on the next record.
          <Stack key={data.id} spacing={3} sx={{ maxWidth: 900 }}>
            <AccountTextRow
              label={t('accounts.fields.nativeName')}
              placeholder={t('accounts.placeholders.nativeName')}
              value={data.native_name ?? ''}
              disabled={disabled}
              error={errors.native_name}
              onCommit={(next) => commitText('native_name', next)}
            />
            <DescriptionField
              value={data.description ?? ''}
              disabled={disabled}
              error={errors.description}
              onCommit={(next) => commitText('description', next)}
            />
            <Box>
              <Typography sx={sectionLabelSx}>{t('accounts.sections.consolidation')}</Typography>
              <PropertyRow label={t('accounts.fields.consolidationAccount')} valueSx={{ maxWidth: 520 }}>
                <ConsolidationAccountField
                  value={data.consolidation_account_number}
                  storedName={data.consolidation_account_name}
                  storedDescription={data.consolidation_account_description}
                  serverStatus={data.consolidation_status}
                  chart={consolidationChart}
                  chartsLoaded={!coasLoading}
                  disabled={disabled}
                  error={errors.consolidation_account_number}
                  label={t('accounts.fields.consolidationAccount')}
                  onChange={(next) => void patch({ consolidation_account_number: next }, 'consolidation_account_number')}
                />
              </PropertyRow>
            </Box>
          </Stack>
        )}
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}

function ChartSelect({
  coas,
  value,
  disabled,
  error,
  onChange,
}: {
  coas: CoaListItem[];
  value: string | null;
  disabled?: boolean;
  error?: string;
  onChange: (next: string) => void;
}) {
  const { t } = useTranslation(['master-data']);
  const label = t('accounts.fields.chartOfAccounts');
  // The stored chart shows only once the charts are loaded, so the select never holds an unknown value.
  const known = !!value && coas.some((coa) => coa.id === value);
  return (
    <Box>
      <Select
        variant="standard"
        value={known ? (value as string) : ''}
        onChange={(event) => onChange(String(event.target.value))}
        displayEmpty
        disabled={disabled}
        error={!!error}
        sx={drawerSelectSx}
        SelectDisplayProps={{ 'aria-label': label } as React.HTMLAttributes<HTMLDivElement>}
        renderValue={(selected) => {
          const coa = coas.find((item) => item.id === selected);
          return coa
            ? `${coa.code} · ${coa.name}`
            : <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('accounts.placeholders.chartOfAccounts')}</Box>;
        }}
      >
        {coas.map((coa) => (
          <MenuItem key={coa.id} value={coa.id} sx={drawerMenuItemSx}>
            {`${coa.code} · ${coa.name}`}
          </MenuItem>
        ))}
      </Select>
      {error && (
        <Typography role="alert" sx={{ mt: '3px', fontSize: 12, lineHeight: 1.35, color: 'error.main' }}>{error}</Typography>
      )}
    </Box>
  );
}

/**
 * Lines of the other kind that still use the account (they keep it, new ones cannot choose it), with
 * a link opening them in the OPEX or CAPEX list in a new tab: every status, filtered on this account,
 * as a one-off view. Shown as long as the conflict exists.
 */
function NatureConflictNote({
  accountId,
  nature,
  lineCounts,
}: {
  accountId: string;
  nature: AccountNature | null;
  lineCounts: AccountLineCounts | null | undefined;
}) {
  const { t } = useTranslation(['master-data']);
  const conflict = accountNatureConflict(nature, lineCounts);
  if (!conflict) return null;
  const link = oneOffListLink(conflict.scope, { account_id: keepValues([accountId]) });
  return (
    <LineTypeUsageConflictNote testId="nature-conflict">
      {t(conflict.scope === 'capex' ? 'accounts.nature.conflictCapex' : 'accounts.nature.conflictOpex', { count: conflict.count })}{' '}
      <ListLinkAnchor link={link}>{t('accounts.nature.showLines')}</ListLinkAnchor>
    </LineTypeUsageConflictNote>
  );
}

function AccountNumberRow({
  value,
  disabled,
  error,
  onCommit,
}: {
  value: string;
  disabled: boolean;
  error?: string;
  onCommit: (raw: string) => void;
}) {
  const { t } = useTranslation(['master-data']);
  // A refused number stays in the field so it can be corrected.
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  const label = t('accounts.fields.accountNumber');
  return (
    <PropertyRow label={label} required>
      <TextField
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={onFocus}
        onBlur={() => {
          onBlur();
          onCommit(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
        variant="standard"
        fullWidth
        sx={drawerFieldValueSx}
        placeholder={t('accounts.placeholders.accountNumber')}
        disabled={disabled}
        error={!!error}
        helperText={error}
        inputProps={{ 'aria-label': label, inputMode: 'numeric', autoComplete: 'off', spellCheck: false }}
      />
    </PropertyRow>
  );
}

function AccountTextRow({
  label,
  placeholder,
  value,
  disabled,
  error,
  onCommit,
}: {
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  error?: string;
  onCommit: (next: string | null) => void;
}) {
  const { draft, setDraft, onFocus, onBlur } = useFieldDraft(value);
  return (
    // One-line content fields fill the row up to the width used on the company workspace.
    <PropertyRow label={label} valueSx={{ maxWidth: 520 }}>
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
        fullWidth
        sx={drawerFieldValueSx}
        placeholder={placeholder}
        disabled={disabled}
        error={!!error}
        helperText={error}
        inputProps={{ 'aria-label': label, autoComplete: 'off' }}
      />
    </PropertyRow>
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
  const label = t('accounts.fields.description');
  return (
    <Box>
      <Typography sx={sectionLabelSx}>{label}</Typography>
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
        placeholder={t('accounts.placeholders.description')}
        disabled={disabled}
        error={!!error}
        helperText={error}
        sx={longFormSurfaceFieldSx}
        inputProps={{ 'aria-label': label }}
      />
    </Box>
  );
}

type CreateValues = {
  /** Undefined until the user picks a chart: the list's chart is preselected meanwhile. */
  coa_id: string | null | undefined;
  account_number: string;
  account_name: string;
  native_name: string;
  description: string;
  consolidation_account_number: number | null;
  nature: AccountNature | null;
};

const EMPTY_CREATE: CreateValues = {
  coa_id: undefined,
  account_number: '',
  account_name: '',
  native_name: '',
  description: '',
  consolidation_account_number: null,
  nature: null,
};

function AccountCreate({
  canCreate,
  coas,
  coasLoaded,
  consolidationChart,
  preselectedCoaId,
  onClose,
  onCreated,
}: {
  canCreate: boolean;
  coas: CoaListItem[];
  coasLoaded: boolean;
  consolidationChart: CoaListItem | undefined;
  preselectedCoaId: string | null;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const { t } = useTranslation(['master-data', 'common']);
  const queryClient = useQueryClient();
  const [values, setValues] = React.useState<CreateValues>(EMPTY_CREATE);
  const [errors, setErrors] = React.useState<FieldErrors>({});
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const preselected = preselectedCoaId && coas.some((coa) => coa.id === preselectedCoaId) ? preselectedCoaId : null;
  const coaId = values.coa_id === undefined ? preselected : values.coa_id;

  const set = <K extends keyof CreateValues>(field: K, value: CreateValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
  };

  const handleCreate = async () => {
    if (!canCreate || submitting) return;
    const name = values.account_name.trim();
    const number = parseAccountNumber(values.account_number);
    const nextErrors: FieldErrors = {};
    if (!coaId) nextErrors.coa_id = t('accounts.messages.chartRequired');
    if (number == null) nextErrors.account_number = t('accounts.messages.numberInvalid');
    if (!name) nextErrors.account_name = t('accounts.messages.nameRequired');
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    setServerError(null);
    try {
      const res = await api.post<Account>('/accounts', {
        coa_id: coaId,
        account_number: number,
        account_name: name,
        native_name: values.native_name.trim() || null,
        description: values.description.trim() || null,
        consolidation_account_number: values.consolidation_account_number,
        nature: values.nature,
        status: STATUS_ENABLED,
        disabled_at: null,
      });
      void queryClient.invalidateQueries({ queryKey: ['accounts'] });
      void queryClient.invalidateQueries({ queryKey: ['accounts-ids'] });
      void queryClient.invalidateQueries({ queryKey: COA_LIST_QUERY_KEY });
      onCreated(res.data.id);
    } catch (e) {
      const message = getApiErrorMessage(e, t, t('accounts.messages.createFailed'));
      // The form checks everything else first: a 400 that names no field is the number already
      // used in the chosen chart.
      const field = accountRefusalField(e) ?? (httpStatus(e) === 400 ? 'account_number' : null);
      if (field && field !== 'disabled_at') setErrors({ [field]: message });
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
        drawerStorageKey="kanap.accounts.drawerOpen"
        backLabel={t('coa.title')}
        onBack={onClose}
        title={values.account_name}
        titleFallback={t('accounts.newAccount')}
        isCreate
        actions={(
          <Button variant="contained" size="small" onClick={() => void handleCreate()} disabled={!canCreate || submitting}>
            {t('accounts.actions.create')}
          </Button>
        )}
      >
        <Stack spacing={1.5} sx={{ maxWidth: 560 }}>
          <PropertyRow label={t('accounts.fields.chartOfAccounts')} required valueSx={{ maxWidth: 520 }}>
            <ChartSelect
              coas={coas}
              value={coaId}
              error={errors.coa_id}
              onChange={(next) => set('coa_id', next)}
            />
          </PropertyRow>
          <PropertyRow label={t('accounts.fields.accountNumber')} required valueSx={{ maxWidth: 520 }}>
            <TextField
              value={values.account_number}
              onChange={(e) => set('account_number', e.target.value)}
              variant="standard"
              fullWidth
              sx={drawerFieldValueSx}
              placeholder={t('accounts.placeholders.accountNumber')}
              error={!!errors.account_number}
              helperText={errors.account_number}
              inputProps={{
                'aria-label': t('accounts.fields.accountNumber'),
                inputMode: 'numeric',
                autoComplete: 'off',
                spellCheck: false,
              }}
            />
          </PropertyRow>
          <PropertyRow label={t('accounts.fields.accountName')} required valueSx={{ maxWidth: 520 }}>
            <TextField
              value={values.account_name}
              onChange={(e) => set('account_name', e.target.value)}
              variant="standard"
              fullWidth
              sx={drawerFieldValueSx}
              placeholder={t('accounts.placeholders.accountName')}
              error={!!errors.account_name}
              helperText={errors.account_name}
              inputProps={{ 'aria-label': t('accounts.fields.accountName'), autoComplete: 'off' }}
            />
          </PropertyRow>
          <PropertyRow label={t('accounts.fields.nature')} valueSx={{ maxWidth: 520 }}>
            <LineTypeUsageSelect
              value={values.nature}
              label={t('accounts.fields.nature')}
              error={errors.nature}
              onChange={(next) => set('nature', next)}
            />
          </PropertyRow>
          <PropertyRow label={t('accounts.fields.nativeName')} valueSx={{ maxWidth: 520 }}>
            <TextField
              value={values.native_name}
              onChange={(e) => set('native_name', e.target.value)}
              variant="standard"
              fullWidth
              sx={drawerFieldValueSx}
              placeholder={t('accounts.placeholders.nativeName')}
              inputProps={{ 'aria-label': t('accounts.fields.nativeName'), autoComplete: 'off' }}
            />
          </PropertyRow>
          <PropertyRow label={t('accounts.fields.description')} valueSx={{ maxWidth: 520 }}>
            <TextField
              value={values.description}
              onChange={(e) => set('description', e.target.value)}
              multiline
              minRows={2}
              variant="standard"
              fullWidth
              sx={drawerFieldValueSx}
              placeholder={t('accounts.placeholders.description')}
              inputProps={{ 'aria-label': t('accounts.fields.description') }}
            />
          </PropertyRow>
          <PropertyRow label={t('accounts.fields.consolidationAccount')} valueSx={{ maxWidth: 520 }}>
            <ConsolidationAccountField
              value={values.consolidation_account_number}
              storedName={null}
              storedDescription={null}
              chart={consolidationChart}
              chartsLoaded={coasLoaded}
              disabled={false}
              error={errors.consolidation_account_number}
              label={t('accounts.fields.consolidationAccount')}
              onChange={(next) => set('consolidation_account_number', next)}
            />
          </PropertyRow>
          {serverError && <Alert severity="error">{serverError}</Alert>}
        </Stack>
      </PortfolioDetailWorkspaceShell>
    </Box>
  );
}
