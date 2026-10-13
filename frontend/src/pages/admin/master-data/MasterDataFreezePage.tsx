import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  FormGroup,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import PageHeader from '../../../components/PageHeader';
import { useAuth } from '../../../auth/AuthContext';
import { FreezeScope, FreezeTarget, freezeTargets, unfreezeTargets, FreezeStateResponse } from '../../../services/freeze';
import { useFreezeState } from '../../../hooks/useFreezeState';
import { useMutation, useQueryClient } from '@tanstack/react-query';

const YEAR_RANGE = 6;
const MASTER_SCOPES: FreezeScope[] = ['companies', 'departments'];

function useYearOptions() {
  const currentYear = new Date().getFullYear();
  return React.useMemo(() => Array.from({ length: YEAR_RANGE }, (_, i) => currentYear - 1 + i), [currentYear]);
}

export default function MasterDataFreezePage() {
  const years = useYearOptions();
  const { t } = useTranslation(['master-data', 'common']);
  const { hasLevel } = useAuth();
  const canFreezeCompanies = hasLevel('budget_ops', 'admin') || hasLevel('companies', 'admin');
  const canFreezeDepartments = hasLevel('budget_ops', 'admin') || hasLevel('departments', 'admin');
  const canModify = canFreezeCompanies || canFreezeDepartments;
  const [year, setYear] = React.useState<number>(years[1] ?? years[0] ?? new Date().getFullYear());
  const [selectedScopes, setSelectedScopes] = React.useState<FreezeScope[]>([]);
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error } = useFreezeState(year);

  const freezeMutation = useMutation({
    mutationFn: async (targets: FreezeTarget[]) => freezeTargets(year, targets),
    onSuccess: (res: FreezeStateResponse) => {
      queryClient.setQueryData(['freeze-state', year], res);
      setFeedback({ type: 'success', message: t('admin.freeze.frozenSuccessfully') });
    },
    onError: (err: any) => {
      setFeedback({ type: 'error', message: err?.response?.data?.message || err?.message || t('admin.freeze.unableToFreeze') });
    },
  });

  const unfreezeMutation = useMutation({
    mutationFn: async (targets: FreezeTarget[]) => unfreezeTargets(year, targets),
    onSuccess: (res: FreezeStateResponse) => {
      queryClient.setQueryData(['freeze-state', year], res);
      setFeedback({ type: 'success', message: t('admin.freeze.unfrozenSuccessfully') });
    },
    onError: (err: any) => {
      setFeedback({ type: 'error', message: err?.response?.data?.message || err?.message || t('admin.freeze.unableToUnfreeze') });
    },
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

  const buildTargets = (): FreezeTarget[] => {
    return selectedScopes.map((scope) => ({ scope }));
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

  const summary = data?.summary;
  const scopeSummary = summary?.scopes;
  const loading = isLoading || isFetching || freezeMutation.isPending || unfreezeMutation.isPending;

  const renderScopeStatus = () => {
    if (!scopeSummary) return null;

    const card = (label: string, info: { frozen: boolean; frozenAt: string | null; frozenBy: string | null } | undefined) => (
      <Card variant="outlined" key={label}>
        <CardContent>
          <Typography variant="subtitle2" sx={{ mb: 1 }}>{label}</Typography>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color={info?.frozen ? 'error.main' : 'text.secondary'}>
              {info?.frozen ? t('admin.freeze.frozen') : t('admin.freeze.editable')}
            </Typography>
            {info?.frozenBy && (
              <Typography variant="caption" color="text.secondary">
                by {info.frozenBy}
              </Typography>
            )}
          </Box>
        </CardContent>
      </Card>
    );

    return (
      <Stack spacing={2}>
        {card(t('admin.freeze.companiesMetrics'), scopeSummary.companies)}
        {card(t('admin.freeze.departmentsMetrics'), scopeSummary.departments)}
      </Stack>
    );
  };

  const disabledScopes: Record<FreezeScope, boolean> = {
    companies: !canFreezeCompanies,
    departments: !canFreezeDepartments,
    opex: true,
    capex: true,
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t('admin.freeze.title')} />
      {!canModify && (
        <Alert severity="info" sx={{ maxWidth: 600 }}>
          {t('admin.freeze.noPermission')}
        </Alert>
      )}
      {feedback && (
        <Alert severity={feedback.type} onClose={() => setFeedback(null)}>{feedback.message}</Alert>
      )}
      {error && (
        <Alert severity="error">{t('admin.freeze.loadError')}</Alert>
      )}
      <Card variant="outlined">
        <CardContent>
          <Stack spacing={3}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
              <TextField
                select
                size="small"
                label="Year"
                value={year}
                onChange={(e) => { setYear(Number(e.target.value)); setFeedback(null); }}
                sx={{ width: 160 }}
              >
                {years.map((y) => (
                  <MenuItem key={y} value={y}>{y}</MenuItem>
                ))}
              </TextField>
              <FormGroup row>
                {MASTER_SCOPES.map((scope) => (
                  <FormControlLabel
                    key={scope}
                    control={(
                      <Checkbox
                        checked={selectedScopes.includes(scope)}
                        onChange={toggleScope(scope)}
                        disabled={!canModify || disabledScopes[scope]}
                      />
                    )}
                    label={scope === 'companies' ? t('admin.freeze.scopeCompanies') : t('admin.freeze.scopeDepartments')}
                  />
                ))}
              </FormGroup>
            </Stack>

            <Stack direction="row" spacing={2}>
              <Button
                variant="contained"
                onClick={handleFreeze}
                disabled={!canModify || selectedScopes.length === 0 || loading}
                startIcon={freezeMutation.isPending ? <CircularProgress size={16} /> : undefined}
              >
                {freezeMutation.isPending ? t('admin.freeze.freezingBtn') : t('admin.freeze.freezeBtn')}
              </Button>
              <Button
                variant="outlined"
                onClick={handleUnfreeze}
                disabled={!canModify || selectedScopes.length === 0 || loading}
                startIcon={unfreezeMutation.isPending ? <CircularProgress size={16} /> : undefined}
              >
                {unfreezeMutation.isPending ? t('admin.freeze.unfreezingBtn') : t('admin.freeze.unfreezeBtn')}
              </Button>
            </Stack>

            {loading && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <CircularProgress size={18} />
                <Typography variant="body2">{t('admin.freeze.updatingStatus')}</Typography>
              </Box>
            )}
          </Stack>
        </CardContent>
      </Card>

      {renderScopeStatus()}
    </Box>
  );
}
