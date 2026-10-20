import React from 'react';
import { Alert, Box, Button, MenuItem, Paper, Select, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import { PropertyRow } from '../../components/design';
import { compactSelectMenuProps, drawerMenuItemSx, pageSelectSx } from '../../theme/formSx';
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

export default function AllocationDefaultPage() {
  const { t } = useTranslation(['ops', 'common']);
  const { hasLevel } = useAuth();
  const canManage = hasLevel('budget_ops', 'admin');
  const queryClient = useQueryClient();

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => currentYear - 1 + i);
  const [year, setYear] = React.useState(currentYear);
  const [savedFlash, setSavedFlash] = React.useState(false);
  const flashTimer = React.useRef<number | null>(null);

  // Local selection while the admin is still picking: the API rejects a manual mode
  // without companies, so an empty in-progress selection is never sent.
  const [pendingMode, setPendingMode] = React.useState<AllocationRuleMode | null>(null);
  const [pendingMethod, setPendingMethod] = React.useState<AllocationMethod | null>(null);
  const [selectedCompanies, setSelectedCompanies] = React.useState<string[]>([]);

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

  const applyResult = React.useCallback(
    (next: AllocationRuleResolution) => {
      queryClient.setQueryData(['allocation-rule', year], next);
      setSavedFlash(true);
      if (flashTimer.current) window.clearTimeout(flashTimer.current);
      flashTimer.current = window.setTimeout(() => setSavedFlash(false), 1500);
    },
    [queryClient, year],
  );

  React.useEffect(() => () => {
    if (flashTimer.current) window.clearTimeout(flashTimer.current);
  }, []);

  // Follow the stored setting whenever the year changes or a save lands.
  React.useEffect(() => {
    if (!data) return;
    setSelectedCompanies(data.company_ids ?? []);
    setPendingMode(null);
    setPendingMethod(null);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: (payload: { mode: AllocationRuleMode; method: AllocationMethod; companyIds: string[] | null }) =>
      saveAllocationRule(year, payload),
    onSuccess: applyResult,
    // A rejected save (unusable selection, lost permission…) must not leave the controls
    // showing a state the server refused: fall back to what is actually stored.
    onError: () => {
      const stored = queryClient.getQueryData<AllocationRuleResolution>(['allocation-rule', year]);
      setSelectedCompanies(stored?.company_ids ?? []);
      setPendingMode(null);
      setPendingMethod(null);
    },
  });

  const resetMutation = useMutation({
    mutationFn: () => resetAllocationRule(year),
    onSuccess: applyResult,
  });

  const methodLabel = React.useCallback(
    (method: AllocationMethod | null | undefined) =>
      method
        ? t(`operations.allocationDefault.methods.${METHOD_LABEL_KEYS[method] ?? METHOD_LABEL_KEYS.headcount}`)
        : '',
    [t],
  );

  const mode = pendingMode ?? data?.mode ?? 'auto';
  const method = pendingMethod ?? data?.method ?? 'headcount';
  const busy = saveMutation.isPending || resetMutation.isPending;
  const mutationError = saveMutation.error ?? resetMutation.error;
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
      saveMutation.mutate({ mode: 'auto', method, companyIds: null });
      return;
    }
    // Manual mode only becomes persistable once at least one company is selected.
    setPendingMode('manual_company');
    if (selectedCompanies.length > 0) {
      saveMutation.mutate({ mode: 'manual_company', method, companyIds: selectedCompanies });
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
    saveMutation.mutate({ mode: 'manual_company', method, companyIds: selectedCompanies });
  };

  const applyDriver = (next: AllocationMethod) => {
    setPendingMethod(next);
    if (mode === 'manual_company' && selectedCompanies.length === 0) {
      // Nothing persistable yet: the driver is stored with the first company selection.
      return;
    }
    saveMutation.mutate({
      mode: mode === 'manual_company' ? 'manual_company' : 'auto',
      method: next,
      companyIds: mode === 'manual_company' ? selectedCompanies : null,
    });
  };

  const shares = data?.shares ?? [];
  const manualPendingWithoutSelection = mode === 'manual_company' && selectedCompanies.length === 0;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t('operations.allocationDefault.title')} />
      <Typography variant="body1" sx={{ color: 'text.secondary' }}>
        {t('operations.allocationDefault.subtitle')}
      </Typography>

      {!canManage && <Alert severity="info">{t('operations.allocationDefault.noPermission')}</Alert>}
      {isError && <Alert severity="error">{t('operations.allocationDefault.loadError')}</Alert>}
      {mutationError && (
        <Alert severity="error">
          {mutationError instanceof Error ? mutationError.message : t('operations.allocationDefault.saveError')}
        </Alert>
      )}
      {data?.preview_error && (
        <Alert severity="warning">
          {t('operations.allocationDefault.previewError', { reason: data.preview_error })}
        </Alert>
      )}
      {data?.preview_warning && (
        <Alert severity="warning" sx={{ whiteSpace: 'pre-line' }}>{allocationWarningText(t, data.preview_warning)}</Alert>
      )}

      <Paper variant="outlined" sx={{ p: 2, maxWidth: 640 }}>
        <Stack spacing={1}>
          <PropertyRow label={t('operations.allocationDefault.year')}>
            <Select
              variant="standard"
              value={String(year)}
              onChange={(e) => setYear(Number(e.target.value))}
              sx={pageSelectSx}
              MenuProps={compactSelectMenuProps}
              disabled={busy}
            >
              {years.map((y) => (
                <MenuItem key={y} value={String(y)} sx={drawerMenuItemSx}>
                  {y}
                </MenuItem>
              ))}
            </Select>
          </PropertyRow>

          <PropertyRow
            label={t('operations.allocationDefault.mode')}
            helperText={mode === 'manual_company' ? t('operations.allocationDefault.modeManualHelp') : undefined}
          >
            {canManage ? (
              <Select
                variant="standard"
                value={mode}
                onChange={(e) => applyMode(e.target.value as AllocationRuleMode)}
                sx={pageSelectSx}
                MenuProps={compactSelectMenuProps}
                disabled={isLoading || busy}
              >
                {MODES.map((value) => (
                  <MenuItem key={value} value={value} sx={drawerMenuItemSx}>
                    {t(`operations.allocationDefault.${value === 'auto' ? 'modeAuto' : 'modeManual'}`)}
                  </MenuItem>
                ))}
              </Select>
            ) : (
              <Typography sx={{ fontSize: 13 }}>
                {isLoading ? '' : t(`operations.allocationDefault.${(data?.mode ?? 'auto') === 'auto' ? 'modeAuto' : 'modeManual'}`)}
              </Typography>
            )}
          </PropertyRow>

          {mode === 'manual_company' && (
            <PropertyRow label={t('operations.allocationDefault.companies')}>
              {canManage ? (
                <Select
                  multiple
                  variant="standard"
                  value={selectedCompanies}
                  onChange={(e) => applyCompanies(e.target.value as string[])}
                  onClose={commitCompanies}
                  sx={pageSelectSx}
                  MenuProps={compactSelectMenuProps}
                  disabled={isLoading || busy}
                  renderValue={(selected) => {
                    const ids = selected as string[];
                    const single = ids.length === 1 ? companyLabel(ids[0]) : null;
                    if (single) return single;
                    return ids.length === 0
                      ? t('operations.allocationDefault.companiesPlaceholder')
                      : t('operations.allocationDefault.companiesSelected', { count: ids.length });
                  }}
                >
                  {companies.map((company) => (
                    <MenuItem key={company.id} value={company.id} sx={drawerMenuItemSx}>
                      {company.name}
                    </MenuItem>
                  ))}
                </Select>
              ) : (
                <Typography sx={{ fontSize: 13 }}>
                  {selectedCompanies.map((id) => companyLabel(id) ?? '').filter(Boolean).join(', ')}
                </Typography>
              )}
            </PropertyRow>
          )}

          <PropertyRow
            label={t('operations.allocationDefault.method')}
            helperText={t('operations.allocationDefault.methodHelp')}
          >
            {canManage ? (
              <Select
                variant="standard"
                value={method}
                onChange={(e) => applyDriver(e.target.value as AllocationMethod)}
                sx={pageSelectSx}
                MenuProps={compactSelectMenuProps}
                disabled={isLoading || busy}
              >
                {METHODS.map((value) => (
                  <MenuItem key={value} value={value} sx={drawerMenuItemSx}>
                    {methodLabel(value)}
                  </MenuItem>
                ))}
              </Select>
            ) : (
              <Typography sx={{ fontSize: 13 }}>
                {isLoading ? '' : methodLabel(data?.method ?? 'headcount')}
              </Typography>
            )}
          </PropertyRow>

          {manualPendingWithoutSelection && canManage && (
            <Alert severity="info">{t('operations.allocationDefault.companiesHint')}</Alert>
          )}

          {data && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ minHeight: 28 }}>
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
                {isOverridden
                  ? t('operations.allocationDefault.overriddenNote', {
                      method: data.standard_mode === 'manual_company'
                        ? t('operations.allocationDefault.modeManual')
                        : methodLabel(data.standard_method),
                    })
                  : t('operations.allocationDefault.standardNote')}
              </Typography>
              {isOverridden && canManage && (
                <Button variant="action" onClick={() => resetMutation.mutate()} disabled={busy}>
                  {t('operations.allocationDefault.resetToStandard')}
                </Button>
              )}
            </Stack>
          )}

          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', minHeight: 18 }}>
            {saveMutation.isPending || resetMutation.isPending
              ? t('common:status.saving', 'Saving…')
              : savedFlash
                ? t('common:status.saved', 'Saved')
                : ''}
          </Typography>
        </Stack>
      </Paper>

      {mode === 'manual_company' && (
        <Paper variant="outlined" sx={{ p: 2, maxWidth: 640 }}>
          <Typography sx={{ fontSize: 13, fontWeight: 500, mb: 1 }}>
            {t('operations.allocationDefault.sharesTitle')}
          </Typography>
          {shares.length === 0 ? (
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
              {t('operations.allocationDefault.sharesEmpty')}
            </Typography>
          ) : (
            <Box component="table" sx={{ width: '100%', maxWidth: 520, borderCollapse: 'collapse', '& td, & th': { borderBottom: '1px solid', borderColor: 'kanap.border.soft' } }}>
              <Box component="thead">
                <Box component="tr">
                  <Box component="th" sx={{ textAlign: 'left', fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', px: 1, py: 0.75 }}>
                    {t('operations.allocationDefault.companyColumn')}
                  </Box>
                  <Box component="th" sx={{ textAlign: 'right', fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', px: 1.5, py: 0.75, whiteSpace: 'nowrap' }}>
                    {t('operations.allocationDefault.driverValue')}
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
        </Paper>
      )}

      <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', maxWidth: 720 }}>
        {t('operations.allocationDefault.scopeNote')}
      </Typography>
    </Box>
  );
}
