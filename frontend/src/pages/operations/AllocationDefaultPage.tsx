import React from 'react';
import { Alert, Box, Button, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { SettingsPage } from '../../components/settings/SettingsPage';
import { SettingsSection } from '../../components/settings/SettingsSection';
import { SettingField } from '../../components/settings/SettingField';
import { useSettingsAutosave } from '../../components/settings/useSettingsAutosave';
import { autosaveErrorMessage, isTransientSaveFailure } from '../../hooks/useAutosave';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { compactSelectMenuProps, drawerMenuItemSx, pageSelectSx, selectPlaceholderSx } from '../../theme/formSx';
import { useAuth } from '../../auth/AuthContext';
import api from '../../api';
import {
  AllocationMethod,
  AllocationRuleMode,
  AllocationRuleResolution,
  fetchAllocationRule,
  resetAllocationRule,
  saveAllocationRule,
} from '../../services/allocationRules';
import { allocationWarningText } from '../../utils/allocationWarnings';

const METHODS: AllocationMethod[] = ['headcount', 'it_users', 'turnover'];
const MODES: AllocationRuleMode[] = ['auto', 'manual_company'];

/** Locale keys are camelCase while the API values are snake_case. */
const METHOD_LABEL_KEYS: Record<AllocationMethod, string> = {
  headcount: 'headcount',
  it_users: 'itUsers',
  turnover: 'turnover',
};

type Company = {
  id: string;
  name: string;
  /** The currency of `turnover_year`, entered in millions. */
  base_currency?: string | null;
  headcount_year?: number | null;
  it_users_year?: number | null;
  turnover_year?: number | null;
};

const A = 'operations.allocationDefault';

/** The control a save of the rule came from: its refusal shows under it. */
type RuleControl = 'mode' | 'companies' | 'method' | 'restore';

/**
 * The default allocation of a fiscal year. Every choice is saved when it is made, the companies
 * once their list closes; the manual mode stays on this screen until a company is chosen (the
 * server refuses it without one). A choice the server refuses shows the stored rule again, the
 * refusal under the field; a choice a busy server puts off stays on screen while it is sent again.
 * The year cannot change while a save of the rule is on its way or kept. A budget administration
 * reader sees the same fields, read-only.
 */
export default function AllocationDefaultPage() {
  const { t } = useTranslation(['ops', 'common']);
  const { hasLevel } = useAuth();
  const canManage = hasLevel('budget_ops', 'admin');
  const readOnly = !canManage;
  const queryClient = useQueryClient();
  const autosave = useSettingsAutosave();

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => currentYear - 1 + i);
  const [year, setYear] = React.useState(currentYear);

  // Local selection while the admin is still picking: the API rejects a manual mode
  // without companies, so an empty in-progress selection is never sent.
  const [pendingMode, setPendingMode] = React.useState<AllocationRuleMode | null>(null);
  const [pendingMethod, setPendingMethod] = React.useState<AllocationMethod | null>(null);
  const [selectedCompanies, setSelectedCompanies] = React.useState<string[]>([]);
  // The control of the last save of the rule, where its refusal shows.
  const [savedFrom, setSavedFrom] = React.useState<RuleControl | null>(null);

  const { data, isLoading, isError } = useQuery<AllocationRuleResolution>({
    queryKey: ['allocation-rule', year],
    queryFn: () => fetchAllocationRule(year),
    staleTime: 30_000,
  });

  const { data: companiesData } = useQuery({
    queryKey: ['companies', year, 'allocation-default'],
    queryFn: async () => {
      const res = await api.get<{ items: Company[] }>('/companies', {
        params: { year, page: 1, limit: 1000, sort: 'name:ASC' },
      });
      return res.data?.items ?? [];
    },
    staleTime: 60_000,
  });
  const companies = companiesData ?? [];

  // Follow the stored setting whenever the year changes or a save lands.
  React.useEffect(() => {
    if (!data) return;
    setSelectedCompanies(data.company_ids ?? []);
    setPendingMode(null);
    setPendingMethod(null);
  }, [data]);

  /**
   * Saves the year's rule (or drops the override). A refused save shows what is actually stored; a
   * save the busy server puts off keeps the choice on screen, and is sent again.
   */
  const saveRule = (from: RuleControl, run: (fiscalYear: number) => Promise<AllocationRuleResolution>) => {
    const fiscalYear = year;
    setSavedFrom(from);
    autosave.choose('rule', async () => {
      try {
        queryClient.setQueryData(['allocation-rule', fiscalYear], await run(fiscalYear));
      } catch (failure) {
        // A rejected save (unusable selection, lost permission…) must not leave the controls
        // showing a state the server refused: fall back to what is actually stored. The year
        // list stays off meanwhile, so the year shown is the year of the save.
        if (!isTransientSaveFailure(failure)) {
          const stored = queryClient.getQueryData<AllocationRuleResolution>(['allocation-rule', fiscalYear]);
          setSelectedCompanies(stored?.company_ids ?? []);
          setPendingMode(null);
          setPendingMethod(null);
        }
        throw failure;
      }
    });
  };
  const save = (from: RuleControl, payload: { mode: AllocationRuleMode; method: AllocationMethod; companyIds: string[] | null }) =>
    saveRule(from, (fiscalYear) => saveAllocationRule(fiscalYear, payload));

  const methodLabel = React.useCallback(
    (method: AllocationMethod | null | undefined) =>
      method
        ? t(`${A}.methods.${METHOD_LABEL_KEYS[method] ?? METHOD_LABEL_KEYS.headcount}`)
        : '',
    [t],
  );

  const mode = pendingMode ?? data?.mode ?? 'auto';
  const method = pendingMethod ?? data?.method ?? 'headcount';
  const isOverridden = data?.source === 'tenant';

  /** Company name, or null while the list is still loading (never expose a raw id). */
  const companyLabel = React.useCallback(
    (companyId: string): string | null => companies.find((c) => c.id === companyId)?.name ?? null,
    [companies],
  );

  const driverValue = React.useCallback(
    (company: Company): number | null => {
      const raw = method === 'it_users' ? company.it_users_year
        : method === 'turnover' ? company.turnover_year
        : company.headcount_year;
      if (raw == null) return null;
      const value = Number(raw);
      return Number.isFinite(value) ? value : null;
    },
    [method],
  );

  // A turnover is in millions of the company's base currency, while the percentages are computed in the
  // reporting currency: the currency is named next to it ("35 M USD").
  const driverLabel = (company: Company): string => {
    const value = driverValue(company);
    if (value == null) return '—';
    const currency = company.base_currency?.trim().toUpperCase();
    const formatted = value.toLocaleString();
    return method === 'turnover' && currency ? t('shared.turnoverMillions', { value: formatted, currency }) : formatted;
  };

  const applyMode = (next: AllocationRuleMode) => {
    if (next === 'auto') {
      setPendingMode(null);
      save('mode', { mode: 'auto', method, companyIds: null });
      return;
    }
    // Manual mode only becomes persistable once at least one company is selected.
    setPendingMode('manual_company');
    if (selectedCompanies.length > 0) {
      save('mode', { mode: 'manual_company', method, companyIds: selectedCompanies });
    }
  };

  // Picking companies only updates the local selection; it is saved once the menu closes,
  // so choosing five companies is one save (and one audit entry), not five.
  const applyCompanies = (next: string[]) => {
    setSelectedCompanies(next);
    setPendingMode('manual_company');
  };

  const commitCompanies = () => {
    if (selectedCompanies.length === 0) return;
    const stored = data?.mode === 'manual_company' ? data.company_ids ?? [] : null;
    const unchanged = stored !== null
      && stored.length === selectedCompanies.length
      && stored.every((id, idx) => id === selectedCompanies[idx])
      && data?.method === method;
    if (unchanged) return;
    save('companies', { mode: 'manual_company', method, companyIds: selectedCompanies });
  };

  const applyDriver = (next: AllocationMethod) => {
    setPendingMethod(next);
    if (mode === 'manual_company' && selectedCompanies.length === 0) {
      // Nothing persistable yet: the driver is stored with the first company selection.
      return;
    }
    save('method', {
      mode: mode === 'manual_company' ? 'manual_company' : 'auto',
      method: next,
      companyIds: mode === 'manual_company' ? selectedCompanies : null,
    });
  };

  const shares = data?.shares ?? [];
  const manualPendingWithoutSelection = mode === 'manual_company' && selectedCompanies.length === 0;
  // A save the busy server put off, kept once its retries are spent: it goes with the next change.
  const saveError = autosave.error ? autosaveErrorMessage(autosave.error, t, t(`${A}.saveError`)) : null;
  const refusal = autosave.errorOf('rule');
  const refusalOf = (control: RuleControl) => (refusal && savedFrom === control ? getApiErrorMessage(refusal, t, t(`${A}.saveError`)) : null);
  // A save of the rule on its way, waiting or kept: the year it is for stays on screen.
  const saving = autosave.status === 'pending' || autosave.status === 'saving' || !!autosave.error;
  // Not loaded: the standard values on screen would not be the year's rule, so nothing is offered.
  const loadFailed = isError && !data;

  return (
    <SettingsPage
      title={t(`${A}.title`)}
      status={autosave.status}
      readOnly={readOnly}
      error={loadFailed ? t(`${A}.loadError`) : undefined}
      actions={isOverridden ? (
        // Drops the organisation's setting of the year: the standard method applies again.
        <Button variant="action" onClick={() => saveRule('restore', resetAllocationRule)}>
          {t(`${A}.restoreDefault`)}
        </Button>
      ) : undefined}
    >
      <Stack spacing={1.5} sx={{ mb: 1 }}>
        {saveError && <Alert severity="error">{saveError}</Alert>}
        {refusalOf('restore') && <Alert severity="error">{refusalOf('restore')}</Alert>}
        {data?.preview_error && (
          <Alert severity="warning">
            {t(`${A}.previewError`, { reason: data.preview_error })}
          </Alert>
        )}
        {data?.preview_warning && (
          <Alert severity="warning" sx={{ whiteSpace: 'pre-line' }}>{allocationWarningText(t, data.preview_warning)}</Alert>
        )}
      </Stack>

      <SettingField label={t(`${A}.year`)}>
        {/* The year chooses what the page shows: a reader changes it too. */}
        <Select
          variant="standard"
          value={String(year)}
          onChange={(e) => setYear(Number(e.target.value))}
          disabled={saving}
          sx={pageSelectSx}
          MenuProps={compactSelectMenuProps}
          inputProps={{ 'aria-label': t(`${A}.year`) }}
        >
          {years.map((y) => (
            <MenuItem key={y} value={String(y)} sx={drawerMenuItemSx}>
              {y}
            </MenuItem>
          ))}
        </Select>
      </SettingField>

      <SettingField label={t(`${A}.mode`)} error={refusalOf('mode')}>
        {({ readOnly: fieldReadOnly, error: fieldError, aria }) => (
          <Select
            variant="standard"
            value={mode}
            onChange={(e) => applyMode(e.target.value as AllocationRuleMode)}
            readOnly={fieldReadOnly}
            sx={pageSelectSx}
            MenuProps={compactSelectMenuProps}
            disabled={isLoading}
            error={fieldError}
            inputProps={{ 'aria-label': t(`${A}.mode`) }}
            SelectDisplayProps={aria}
          >
            {MODES.map((value) => (
              <MenuItem key={value} value={value} sx={drawerMenuItemSx}>
                {t(`${A}.${value === 'auto' ? 'modeAuto' : 'modeManual'}`)}
              </MenuItem>
            ))}
          </Select>
        )}
      </SettingField>

      {mode === 'manual_company' && (
        <SettingField label={t(`${A}.companies`)} error={refusalOf('companies')}>
          {({ readOnly: fieldReadOnly, error: fieldError, aria }) => (
            <Select
              multiple
              variant="standard"
              value={selectedCompanies}
              onChange={(e) => applyCompanies(e.target.value as string[])}
              onClose={commitCompanies}
              readOnly={fieldReadOnly}
              sx={pageSelectSx}
              MenuProps={compactSelectMenuProps}
              disabled={isLoading}
              displayEmpty
              error={fieldError}
              inputProps={{ 'aria-label': t(`${A}.companies`) }}
              SelectDisplayProps={aria}
              renderValue={(selected) => {
                const ids = selected as string[];
                const single = ids.length === 1 ? companyLabel(ids[0]) : null;
                if (single) return single;
                return ids.length === 0
                  ? <Box component="span" sx={selectPlaceholderSx}>{t(`${A}.companiesPlaceholder`)}</Box>
                  : t(`${A}.companiesSelected`, { count: ids.length });
              }}
            >
              {companies.map((company) => (
                <MenuItem key={company.id} value={company.id} sx={drawerMenuItemSx}>
                  {company.name}
                </MenuItem>
              ))}
            </Select>
          )}
        </SettingField>
      )}

      <SettingField label={t(`${A}.method`)} hint={t(`${A}.methodHelp`)} error={refusalOf('method')}>
        {({ readOnly: fieldReadOnly, error: fieldError, aria }) => (
          <Select
            variant="standard"
            value={method}
            onChange={(e) => applyDriver(e.target.value as AllocationMethod)}
            readOnly={fieldReadOnly}
            sx={pageSelectSx}
            MenuProps={compactSelectMenuProps}
            disabled={isLoading}
            error={fieldError}
            inputProps={{ 'aria-label': t(`${A}.method`) }}
            SelectDisplayProps={aria}
          >
            {METHODS.map((value) => (
              <MenuItem key={value} value={value} sx={drawerMenuItemSx}>
                {methodLabel(value)}
              </MenuItem>
            ))}
          </Select>
        )}
      </SettingField>

      {manualPendingWithoutSelection && canManage && (
        <Alert severity="info" sx={{ mt: 1 }}>{t(`${A}.companiesHint`)}</Alert>
      )}

      {data && (
        <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', mt: 1 }}>
          {isOverridden
            ? t(`${A}.overriddenNote`, {
                method: data.standard_mode === 'manual_company'
                  ? t(`${A}.modeManual`)
                  : methodLabel(data.standard_method),
              })
            : t(`${A}.standardNote`)}
        </Typography>
      )}

      {mode === 'manual_company' && (
        <SettingsSection variant="flat" title={t(`${A}.sharesTitle`)}>
          {shares.length === 0 ? (
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
              {t(`${A}.sharesEmpty`)}
            </Typography>
          ) : (
            <Box component="table" sx={{ width: '100%', maxWidth: 520, borderCollapse: 'collapse', '& td, & th': { borderBottom: '1px solid', borderColor: 'kanap.border.soft' } }}>
              <Box component="thead">
                <Box component="tr">
                  <Box component="th" sx={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', px: 1, py: 0.75 }}>
                    {t(`${A}.companyColumn`)}
                  </Box>
                  <Box component="th" sx={{ textAlign: 'right', fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', px: 1.5, py: 0.75, whiteSpace: 'nowrap' }}>
                    {t(`${A}.driverValue`)}
                  </Box>
                  <Box component="th" sx={{ textAlign: 'right', fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', px: 1.5, py: 0.75 }}>
                    %
                  </Box>
                </Box>
              </Box>
              <Box component="tbody">
                {shares.map((share) => {
                  const company = companies.find((c) => c.id === share.company_id);
                  return (
                    <Box component="tr" key={share.company_id}>
                      <Box component="td" sx={{ px: 1, py: 0.5, fontSize: 13 }}>
                        {companyLabel(share.company_id) ?? '—'}
                      </Box>
                      <Box component="td" sx={{ px: 1.5, py: 0.5, fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'kanap.text.secondary' }}>
                        {company ? driverLabel(company) : '—'}
                      </Box>
                      <Box component="td" sx={{ px: 1.5, py: 0.5, fontSize: 13, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {Number(share.allocation_pct).toFixed(2)}
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}
        </SettingsSection>
      )}
    </SettingsPage>
  );
}
