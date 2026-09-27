import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  FormGroup,
  InputLabel,
  MenuItem,
  Select,
  SelectChangeEvent,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import PageHeader from '../../components/PageHeader';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { FreezeColumn, FreezeScope, freezeTargets, FreezeTarget, unfreezeTargets, FreezeStateResponse } from '../../services/freeze';
import { useFreezeState } from '../../hooks/useFreezeState';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';

const YEAR_RANGE = 6;

function useYearOptions() {
  const currentYear = new Date().getFullYear();
  return React.useMemo(() => Array.from({ length: YEAR_RANGE }, (_, i) => currentYear - 1 + i), [currentYear]);
}

/** The user's column choice per scope; null means every listed column (the default). */
type ScopedColumns = {
  opex: FreezeColumn[] | null;
  capex: FreezeColumn[] | null;
};

export default function BudgetFreezePage() {
  const { t } = useTranslation(['ops']);
  const budgetColumns = useBudgetColumns();
  const years = useYearOptions();
  const { hasLevel } = useAuth();
  const canModify = hasLevel('budget_ops', 'admin');
  const [year, setYear] = React.useState<number>(years[1] ?? years[0] ?? new Date().getFullYear());
  const [selectedScopes, setSelectedScopes] = React.useState<FreezeScope[]>([]);
  const [pickedColumns, setColumnsByScope] = React.useState<ScopedColumns>({ opex: null, capex: null });
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error } = useFreezeState(year);

  // Every column of each scope, hidden ones marked, all preselected: freezing a year freezes
  // hidden columns too, since they still accept imports and API writes.
  const allColumns = React.useMemo(() => budgetColumns.all.map((c) => c.freezeKey), [budgetColumns.all]);
  const columnsByScope = React.useMemo(() => ({
    opex: pickedColumns.opex ?? allColumns,
    capex: pickedColumns.capex ?? allColumns,
  }), [allColumns, pickedColumns]);
  const noColumnChosen = selectedScopes.some((scope) => (scope === 'opex' || scope === 'capex') && columnsByScope[scope].length === 0);

  const freezeMutation = useMutation({
    mutationFn: async (targets: FreezeTarget[]) => freezeTargets(year, targets),
    onSuccess: (res: FreezeStateResponse) => {
      queryClient.setQueryData(['freeze-state', year], res);
      setFeedback({ type: 'success', message: t('operations.freeze.frozenSuccess') });
    },
    onError: (err: any) => {
      setFeedback({ type: 'error', message: err?.response?.data?.message || err?.message || t('operations.freeze.freezeError') });
    }
  });

  const unfreezeMutation = useMutation({
    mutationFn: async (targets: FreezeTarget[]) => unfreezeTargets(year, targets),
    onSuccess: (res: FreezeStateResponse) => {
      queryClient.setQueryData(['freeze-state', year], res);
      setFeedback({ type: 'success', message: t('operations.freeze.unfrozenSuccess') });
    },
    onError: (err: any) => {
      setFeedback({ type: 'error', message: err?.response?.data?.message || err?.message || t('operations.freeze.unfreezeError') });
    }
  });

  const [feedback, setFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const toggleScope = (scope: FreezeScope) => (event: React.ChangeEvent<HTMLInputElement>) => {
    setFeedback(null);
    setSelectedScopes((prev) => {
      if (event.target.checked) {
        return prev.includes(scope) ? prev : [...prev, scope];
      }
      return prev.filter((s) => s !== scope);
    });
  };

  const handleColumnsChange = (scope: 'opex' | 'capex') => (event: SelectChangeEvent<FreezeColumn[]>) => {
    const value = event.target.value as FreezeColumn[];
    setFeedback(null);
    setColumnsByScope((prev) => ({ ...prev, [scope]: value }));
  };

  const buildTargets = (): FreezeTarget[] => {
    const targets: FreezeTarget[] = [];
    for (const scope of selectedScopes) {
      if (scope === 'opex' || scope === 'capex') {
        targets.push({ scope, columns: columnsByScope[scope] });
      }
    }
    return targets;
  };

  const handleFreeze = async () => {
    const targets = buildTargets();
    if (targets.length === 0) return;
    await freezeMutation.mutateAsync(targets);
  };

  const handleUnfreeze = async () => {
    const targets = buildTargets();
    if (targets.length === 0) return;
    await unfreezeMutation.mutateAsync(targets);
  };

  const columnLabel = (col: FreezeColumn) => budgetColumns.label(col);
  const isHidden = (col: FreezeColumn) => !budgetColumns.get(col).enabled;

  const summary = data?.summary;
  const scopeSummary = summary?.scopes;
  const loading = isLoading || isFetching || freezeMutation.isPending || unfreezeMutation.isPending;

  const renderScopeStatus = () => {
    if (!scopeSummary) return null;
    const columnStatus = (col: FreezeColumn, info: { frozen: boolean; frozenAt: string | null; frozenBy: string | null } | undefined) => (
      <Box key={col} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.5 }}>
        <Typography variant="body2">
          {columnLabel(col)}
          {isHidden(col) && (
            <Typography component="span" sx={{ ml: 1, fontSize: 12, color: 'kanap.text.tertiary' }}>{t('operations.freeze.hidden')}</Typography>
          )}
        </Typography>
        <Typography variant="body2" color={info?.frozen ? 'error.main' : 'text.secondary'}>
          {info?.frozen ? t('operations.freeze.frozen') : t('operations.freeze.editable')}
        </Typography>
      </Box>
    );

    return (
      <Stack spacing={2}>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('operations.freeze.opexColumns')}</Typography>
            {budgetColumns.all.map((c) => columnStatus(c.freezeKey, scopeSummary.opex[c.freezeKey]))}
          </CardContent>
        </Card>
        <Card variant="outlined">
          <CardContent>
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('operations.freeze.capexColumns')}</Typography>
            {budgetColumns.all.map((c) => columnStatus(c.freezeKey, scopeSummary.capex[c.freezeKey]))}
          </CardContent>
        </Card>
      </Stack>
    );
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t('operations.freeze.title')} breadcrumbTitle={t('operations.freeze.title')} />
      {!canModify && (
        <Alert severity="info" sx={{ maxWidth: 600 }}>
          {t('operations.budgetAdminOnly')}
        </Alert>
      )}
      {feedback && (
        <Alert severity={feedback.type} onClose={() => setFeedback(null)}>{feedback.message}</Alert>
      )}
      {error && (
        <Alert severity="error">{t('operations.freeze.loadError')}</Alert>
      )}
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={3}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
              <TextField
                select
                size="small"
                label={t('operations.freeze.year')}
                value={year}
                onChange={(e) => { setYear(Number(e.target.value)); setFeedback(null); }}
                sx={{ width: 160 }}
              >
                {years.map((y) => (
                  <MenuItem key={y} value={y}>{y}</MenuItem>
                ))}
              </TextField>
              <FormGroup row>
                <FormControlLabel
                  control={<Checkbox checked={selectedScopes.includes('opex')} onChange={toggleScope('opex')} disabled={!canModify} />}
                  label="OPEX"
                />
                <FormControlLabel
                  control={<Checkbox checked={selectedScopes.includes('capex')} onChange={toggleScope('capex')} disabled={!canModify} />}
                  label="CAPEX"
                />
              </FormGroup>
            </Stack>

            {(selectedScopes.includes('opex') || selectedScopes.includes('capex')) && (
              <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
                {selectedScopes.includes('opex') && (
                  <FormControl size="small" sx={{ minWidth: 220 }} disabled={!canModify}>
                    <InputLabel id="opex-columns-label">{t('operations.freeze.opexColumns')}</InputLabel>
                    <Select
                      labelId="opex-columns-label"
                      multiple
                      value={columnsByScope.opex}
                      label={t('operations.freeze.opexColumns')}
                      onChange={handleColumnsChange('opex')}
                      renderValue={(selected) => selected.map(columnLabel).join(', ')}
                    >
                      {budgetColumns.all.map(({ freezeKey: col }) => (
                        <MenuItem key={col} value={col}>
                          <Checkbox checked={columnsByScope.opex.includes(col)} />
                          <Typography sx={{ ml: 1 }}>{columnLabel(col)}</Typography>
                          {isHidden(col) && <Typography sx={{ ml: 1, fontSize: 12, color: 'kanap.text.tertiary' }}>{t('operations.freeze.hidden')}</Typography>}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
                {selectedScopes.includes('capex') && (
                  <FormControl size="small" sx={{ minWidth: 220 }} disabled={!canModify}>
                    <InputLabel id="capex-columns-label">{t('operations.freeze.capexColumns')}</InputLabel>
                    <Select
                      labelId="capex-columns-label"
                      multiple
                      value={columnsByScope.capex}
                      label={t('operations.freeze.capexColumns')}
                      onChange={handleColumnsChange('capex')}
                      renderValue={(selected) => selected.map(columnLabel).join(', ')}
                    >
                      {budgetColumns.all.map(({ freezeKey: col }) => (
                        <MenuItem key={col} value={col}>
                          <Checkbox checked={columnsByScope.capex.includes(col)} />
                          <Typography sx={{ ml: 1 }}>{columnLabel(col)}</Typography>
                          {isHidden(col) && <Typography sx={{ ml: 1, fontSize: 12, color: 'kanap.text.tertiary' }}>{t('operations.freeze.hidden')}</Typography>}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
              </Stack>
            )}

            <Stack direction="row" spacing={2}>
              <Button
                variant="contained"
                onClick={handleFreeze}
                disabled={!canModify || selectedScopes.length === 0 || noColumnChosen || loading}
                startIcon={freezeMutation.isPending ? <CircularProgress size={16} /> : undefined}
              >
                {freezeMutation.isPending ? t('operations.freeze.freezing') : t('operations.freeze.freezeData')}
              </Button>
              <Button
                variant="outlined"
                onClick={handleUnfreeze}
                disabled={!canModify || selectedScopes.length === 0 || noColumnChosen || loading}
                startIcon={unfreezeMutation.isPending ? <CircularProgress size={16} /> : undefined}
              >
                {unfreezeMutation.isPending ? t('operations.freeze.unfreezing') : t('operations.freeze.unfreezeData')}
              </Button>
            </Stack>

            {loading && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={18} />
                <Typography variant="body2">{t('operations.freeze.updating')}</Typography>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>

      {renderScopeStatus()}
    </Box>
  );
}
