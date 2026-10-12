import React from 'react';
import {
  Alert, Box, Button, Checkbox, CircularProgress, MenuItem, Select, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import PageHeader from '../../components/PageHeader';
import { PropertyRow } from '../../components/design/PropertyRow';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { FreezeColumn, freezeTargets, FreezeTarget, unfreezeTargets, FreezeStateResponse } from '../../services/freeze';
import { useFreezeState } from '../../hooks/useFreezeState';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

const NATURES = ['opex', 'capex'] as const;
type Selection = Record<(typeof NATURES)[number], FreezeColumn[]>;

export default function BudgetFreezePage() {
  const { t } = useTranslation(['ops']);
  const budgetColumns = useBudgetColumns();
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - 1 + i);
  const { hasLevel } = useAuth();
  const canModify = hasLevel('budget_ops', 'admin');
  const [year, setYear] = React.useState(currentYear);
  const [selection, setSelection] = React.useState<Selection>({ opex: [], capex: [] });
  const [feedback, setFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const queryClient = useQueryClient();
  const { data, isLoading, isFetching, error } = useFreezeState(year);

  const onSuccess = (res: FreezeStateResponse, message: string) => {
    queryClient.setQueryData(['freeze-state', res.year], res);
    setFeedback({ type: 'success', message });
  };
  const freezeMutation = useMutation({
    mutationFn: (targets: FreezeTarget[]) => freezeTargets(year, targets),
    onSuccess: (res) => onSuccess(res, t('operations.freeze.frozenSuccess')),
    onError: (err) => setFeedback({ type: 'error', message: getApiErrorMessage(err, t, t('operations.freeze.freezeError')) }),
  });
  const unfreezeMutation = useMutation({
    mutationFn: (targets: FreezeTarget[]) => unfreezeTargets(year, targets),
    onSuccess: (res) => onSuccess(res, t('operations.freeze.unfrozenSuccess')),
    onError: (err) => setFeedback({ type: 'error', message: getApiErrorMessage(err, t, t('operations.freeze.unfreezeError')) }),
  });
  const loading = isLoading || isFetching || freezeMutation.isPending || unfreezeMutation.isPending;
  const targets: FreezeTarget[] = NATURES.flatMap((scope) => {
    const columns = budgetColumns.all.map((c) => c.freezeKey).filter((key) => selection[scope].includes(key));
    return columns.length ? [{ scope, columns }] : [];
  });
  const toggle = (col: FreezeColumn, scopes: readonly (typeof NATURES)[number][], checked: boolean) => {
    setFeedback(null);
    setSelection((prev) => {
      const next = { ...prev };
      for (const scope of scopes) {
        next[scope] = checked ? [...new Set([...prev[scope], col])] : prev[scope].filter((key) => key !== col);
      }
      return next;
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t('operations.freeze.title')} breadcrumbTitle={t('operations.freeze.title')} />
      {!canModify && <Alert severity="info">{t('operations.budgetAdminOnly')}</Alert>}
      {feedback && <Alert severity={feedback.type} onClose={() => setFeedback(null)}>{feedback.message}</Alert>}
      {error && <Alert severity="error">{t('operations.freeze.loadError')}</Alert>}
      <Stack direction="row" spacing={2} alignItems="center" useFlexGap flexWrap="wrap">
        <PropertyRow label={t('operations.freeze.year')}>
          <Select
            variant="standard" sx={{ ...drawerSelectSx, width: 120 }} value={year}
            SelectDisplayProps={{ 'aria-label': t('operations.freeze.year') }} disabled={loading}
            onChange={(e) => { setYear(Number(e.target.value)); setFeedback(null); }}
          >
            {years.map((y) => <MenuItem key={y} value={y} sx={drawerMenuItemSx}>{y}</MenuItem>)}
          </Select>
        </PropertyRow>
        <Button variant="action-primary" disabled={!canModify || !budgetColumns.ready || !targets.length || loading}
          onClick={() => freezeMutation.mutate(targets)}>
          {freezeMutation.isPending ? t('operations.freeze.freezing') : t('operations.freeze.freezeData')}
        </Button>
        <Button variant="action" disabled={!canModify || !budgetColumns.ready || !targets.length || loading}
          onClick={() => unfreezeMutation.mutate(targets)}>
          {unfreezeMutation.isPending ? t('operations.freeze.unfreezing') : t('operations.freeze.unfreezeData')}
        </Button>
        {loading && <CircularProgress size={18} aria-label={t('operations.freeze.updating')} />}
      </Stack>
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" aria-label={t('operations.freeze.title')} sx={{
          maxWidth: 700,
          '& th': { fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', borderColor: 'kanap.border.default' },
          '& tbody th': { fontSize: 13, fontWeight: 400, color: 'kanap.text.primary', borderColor: 'kanap.border.soft' },
          '& td': { fontSize: 13, fontWeight: 400, color: 'kanap.text.primary', borderColor: 'kanap.border.soft' },
        }}>
          <TableHead><TableRow>
            <TableCell>{t('operations.freeze.column')}</TableCell>
            {NATURES.map((nature) => <TableCell key={nature}>{t(`budget.${nature}`)}</TableCell>)}
            <TableCell>{t('operations.freeze.both')}</TableCell>
          </TableRow></TableHead>
          <TableBody>
            {budgetColumns.all.map(({ freezeKey: col, label, enabled }) => {
              const both = NATURES.every((scope) => selection[scope].includes(col));
              const some = NATURES.some((scope) => selection[scope].includes(col));
              return <TableRow key={col}>
                <TableCell component="th" scope="row">
                  {label}
                  {!enabled && <Typography component="span" sx={{ ml: 1, fontSize: 12, color: 'kanap.text.tertiary' }}>{t('operations.freeze.hidden')}</Typography>}
                </TableCell>
                {NATURES.map((scope) => {
                  const frozen = data?.summary.scopes[scope]?.[col]?.frozen;
                  return <TableCell key={scope}>
                    <Stack direction="row" alignItems="center" spacing={0.5}>
                      <Checkbox size="small" checked={selection[scope].includes(col)} disabled={!canModify || loading || !budgetColumns.ready}
                        inputProps={{ 'aria-label': t('operations.freeze.selectCell', { column: label, nature: t(`budget.${scope}`) }) }}
                        onChange={(e) => toggle(col, [scope], e.target.checked)} />
                      {data && <Tooltip title={frozen ? t('operations.freeze.frozen') : t('operations.freeze.editable')}>
                        {frozen ? <LockOutlinedIcon fontSize="small" aria-label={t('operations.freeze.frozen')} sx={{ color: 'kanap.text.secondary' }} />
                          : <LockOpenOutlinedIcon fontSize="small" aria-label={t('operations.freeze.editable')} sx={{ color: 'kanap.text.tertiary' }} />}
                      </Tooltip>}
                    </Stack>
                  </TableCell>;
                })}
                <TableCell>
                  <Checkbox size="small" checked={both} indeterminate={some && !both} disabled={!canModify || loading || !budgetColumns.ready}
                    inputProps={{ 'aria-label': t('operations.freeze.selectCell', { column: label, nature: t('operations.freeze.both') }) }}
                    onChange={(e) => toggle(col, NATURES, e.target.checked)} />
                </TableCell>
              </TableRow>;
            })}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}
