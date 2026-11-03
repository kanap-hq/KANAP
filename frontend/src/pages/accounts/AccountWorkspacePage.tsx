import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { CreationActions, useCreationLeave, useCreationTitle } from '../../components/workspace/creation';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { useAccountNav } from '../../hooks/useAccountNav';
import type { ModuleItemNavResult } from '../../hooks/useModuleItemNav';
import { useFieldDraft } from '../../hooks/useFieldDraft';
import PortfolioDetailWorkspaceShell from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import { PropertyGroup, PropertyRow } from '../../components/design';
import StatusLifecycleField from '../../components/fields/StatusLifecycleField';
import { STATUS_DISABLED, STATUS_ENABLED, deriveStatusFromDisabledAt, normalizeStatus } from '../../constants/status';
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
import { ACCOUNT_NUMBER_MAX_DIGITS, parseAccountNumber, toAccountNumber } from '../../constants/accountNumber';

const LIST_PATH = '/master-data/coa';
const ACCOUNT_PATH = '/master-data/accounts';
/** The charts of accounts page's state, carried to the workspace and back. */
const LIST_CONTEXT_KEYS = ['sort', 'q', 'filters', 'scope', 'selected', 'coaId', 'consolidation'];

type Account = {
  id: string;
  coa_id: string | null;
  account_number: number | string;
  account_name: string;
  native_name: string | null;
  description: string | null;
  /** A number; text when the server sends a large number as text (bigint column). */
  consolidation_account_number: number | string | null;
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

/** What a new account starts from; its chart comes from the page it was opened on. */
const NEW_ACCOUNT: Account = {
  id: '', coa_id: null, account_number: '', account_name: '', native_name: null, description: null,
  consolidation_account_number: null, consolidation_account_name: null, consolidation_account_description: null,
  nature: null, status: STATUS_ENABLED, disabled_at: null,
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

  const { data: stored, error: loadError } = useQuery({
    queryKey: ['accounts', id],
    queryFn: async () => (await api.get<Account>(`/accounts/${id}`)).data,
    enabled: !isCreate && !!id,
  });
  // The new page is the account's own page on a draft: the fields write here, Create sends it.
  const [draft, setDraft] = React.useState<Account>(NEW_ACCOUNT);
  const draftRef = React.useRef(draft);
  const preselectedCoaId = coaId && coas.some((coa) => coa.id === coaId) ? coaId : null;
  const newCoaId = draft.coa_id ?? preselectedCoaId;
  const data = isCreate ? { ...draft, coa_id: newCoaId } : stored;

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
    [afterWrite, canEdit, data?.id, isCreate, queryClient, t],
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
    // A new account's number is checked on Create.
    if (isCreate) {
      void patch({ account_number: raw.trim() }, 'account_number');
      return;
    }
    const next = parseAccountNumber(raw);
    if (next == null) {
      setErrors((prev) => ({ ...prev, account_number: t('accounts.messages.numberInvalid', { max: ACCOUNT_NUMBER_MAX_DIGITS }) }));
      return;
    }
    commitTyped('account_number', next, Number(data.account_number));
  };

  // Create sends the draft with the header's name, then goes back where the creation started.
  const leave = useCreationLeave(handleClose);
  const title = useCreationTitle({ requiredMessage: t('accounts.messages.nameRequired'), onCancel: leave });
  const [creating, setCreating] = React.useState(false);
  const handleCreate = async () => {
    if (!canEdit || creating) return;
    const name = title.require();
    const values = draftRef.current;
    const number = parseAccountNumber(String(values.account_number));
    const nextErrors: FieldErrors = {};
    if (!newCoaId) nextErrors.coa_id = t('accounts.messages.chartRequired');
    if (number == null) nextErrors.account_number = t('accounts.messages.numberInvalid', { max: ACCOUNT_NUMBER_MAX_DIGITS });
    setErrors((prev) => ({ ...prev, ...nextErrors }));
    if (!name || Object.keys(nextErrors).length > 0) return;
    setCreating(true);
    setPageError(null);
    try {
      const { data: created } = await api.post<Account>('/accounts', {
        coa_id: newCoaId,
        account_number: number,
        account_name: name,
        native_name: values.native_name,
        description: values.description,
        consolidation_account_number: values.consolidation_account_number,
        nature: values.nature,
        status: values.status,
        disabled_at: values.disabled_at,
      });
      afterWrite([newCoaId]);
      // The new account opens in place, every tab available.
      navigate(withContext(`${ACCOUNT_PATH}/${created.id}/overview`), { replace: true });
    } catch (e) {
      const message = getApiErrorMessage(e, t, t('accounts.messages.createFailed'));
      // The page checks everything else first: a 400 that names no field is the number already
      // used in the chosen chart.
      const field = accountRefusalField(e) ?? (httpStatus(e) === 400 ? 'account_number' : null);
      if (field === 'account_name') title.refuse(message);
      else if (field) setErrors((prev) => ({ ...prev, [field]: message }));
      else setPageError(message);
    } finally {
      setCreating(false);
    }
  };

  const disabled = !canEdit;
  const reference = data && !isCreate ? String(data.account_number) : null;

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
          {!isCreate && <NatureConflictNote accountId={data.id} nature={parseAccountNature(data.nature)} lineCounts={data.line_counts} />}
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
            // Disable now: the status alone, the server sets the end of validity from its own clock.
            onDisableNow={() => void patch({ status: STATUS_DISABLED }, 'disabled_at')}
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
      <PortfolioDetailWorkspaceShell
        notices={(pageError || loadError) ? (
          <Alert severity="error" onClose={pageError ? () => setPageError(null) : undefined}>
            {pageError ?? t('accounts.loadError')}
          </Alert>
        ) : undefined}
        activeTab="overview"
        tabs={[{ key: 'overview', label: t('shared.labels.overview') }]}
        onTabChange={() => undefined}
        drawerStorageKey="kanap.accounts.drawerOpen"
        backLabel={t('coa.title')}
        onBack={isCreate ? leave : handleClose}
        itemReference={reference}
        onCopyReference={reference ? () => { void navigator.clipboard?.writeText(reference); } : undefined}
        {...(isCreate ? title.shellProps : {
          title: data?.account_name ?? '',
          canEditTitle: canEdit && !!data,
          onTitleSave: (next: string) => {
            if (data) commitTyped('account_name', next, data.account_name);
          },
        })}
        titleFallback={isCreate ? t('accounts.newAccount') : t('accounts.accountFallback')}
        isCreate={isCreate}
        // A new record's required fields sit in the drawer: it stays open.
        forceDrawerOpen={isCreate}
        actions={isCreate ? (
          <CreationActions onCreate={() => void handleCreate()} onCancel={leave} busy={!canEdit || creating} />
        ) : undefined}
        nav={!isCreate && shownNav ? {
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
        history={id && !isCreate ? { table: 'accounts', recordId: id } : undefined}
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
                  value={toAccountNumber(data.consolidation_account_number)}
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

