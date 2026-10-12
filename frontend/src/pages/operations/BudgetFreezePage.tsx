import React from 'react';
import {
  Alert, Box, Button, Stack,
  Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import LockOpenOutlinedIcon from '@mui/icons-material/LockOpenOutlined';
import PageHeader from '../../components/PageHeader';
import { PropertyRow } from '../../components/design/PropertyRow';
import YearTabs from '../../components/navigation/YearTabs';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import { FreezeColumn, freezeTargets, FreezeTarget, unfreezeTargets } from '../../services/freeze';
import { useFreezeState } from '../../hooks/useFreezeState';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

const NATURES = ['opex', 'capex'] as const;
type Nature = (typeof NATURES)[number];
type Change = { freeze: boolean; targets: FreezeTarget[] };

const cellKey = (nature: Nature, col: FreezeColumn) => `${nature}:${col}`;

// One budget column of one nature: a compact toggle, frozen drawn stronger than open.
const cellSx = (frozen: boolean) => ({
  height: 26, minWidth: 92, px: 1, gap: 0.5, justifyContent: 'flex-start',
  borderRadius: '5px', border: '1px solid', fontSize: 12, fontWeight: frozen ? 500 : 400,
  textTransform: 'none', boxShadow: 'none', whiteSpace: 'nowrap',
  color: frozen ? 'kanap.text.primary' : 'kanap.text.tertiary',
  borderColor: frozen ? 'kanap.border.strong' : 'kanap.border.default',
  backgroundColor: frozen ? 'kanap.pill.hoverBg' : 'transparent',
  '&:hover': { backgroundColor: 'kanap.pill.hoverBg', borderColor: 'kanap.border.strong', boxShadow: 'none' },
  '&.Mui-disabled': { color: frozen ? 'kanap.text.secondary' : 'kanap.text.tertiary', opacity: 0.6 },
  '& .MuiSvgIcon-root': { fontSize: 14 },
});

const rowActionSx = {
  height: 24, minWidth: 0, px: 0.75, borderRadius: '5px', fontSize: 12, fontWeight: 400,
  textTransform: 'none', color: 'kanap.text.secondary', whiteSpace: 'nowrap',
  '&:hover': { backgroundColor: 'kanap.bg.hover' },
};

export default function BudgetFreezePage() {
  const { t } = useTranslation(['ops']);
  const budgetColumns = useBudgetColumns();
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 6 }, (_, i) => currentYear - 1 + i);
  const { hasLevel } = useAuth();
  const canModify = hasLevel('budget_ops', 'admin');
  const [year, setYear] = React.useState(currentYear);
  const [pending, setPending] = React.useState<ReadonlySet<string>>(new Set());
  const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
  const queryClient = useQueryClient();
  const { data, error } = useFreezeState(year);

  const mutation = useMutation({
    mutationFn: ({ freeze, targets }: Change) => (freeze ? freezeTargets : unfreezeTargets)(year, targets),
    onSuccess: (res) => queryClient.setQueryData(['freeze-state', res.year], res),
    onError: (err, { freeze }) => setErrorMessage(
      getApiErrorMessage(err, t, t(freeze ? 'operations.freeze.freezeError' : 'operations.freeze.unfreezeError')),
    ),
  });

  const keysOf = (targets: FreezeTarget[]) =>
    targets.flatMap(({ scope, columns }) => (columns ?? []).map((col) => cellKey(scope as Nature, col)));
  const change = (freeze: boolean, natures: readonly Nature[], col: FreezeColumn) => {
    const targets = natures.map((scope) => ({ scope, columns: [col] }));
    const keys = keysOf(targets);
    setErrorMessage(null);
    setPending((prev) => new Set([...prev, ...keys]));
    mutation.mutate({ freeze, targets }, {
      onSettled: () => setPending((prev) => new Set([...prev].filter((key) => !keys.includes(key)))),
    });
  };
  const isFrozen = (nature: Nature, col: FreezeColumn) => !!data?.summary.scopes[nature]?.[col]?.frozen;
  const editable = canModify && budgetColumns.ready && !!data;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <PageHeader title={t('operations.freeze.title')} breadcrumbTitle={t('operations.freeze.title')} />
      {!canModify && <Alert severity="info">{t('operations.budgetAdminOnly')}</Alert>}
      {errorMessage && <Alert severity="error" onClose={() => setErrorMessage(null)}>{errorMessage}</Alert>}
      {error && <Alert severity="error">{t('operations.freeze.loadError')}</Alert>}
      {/* The year tabs sit centred over the matrix, which keeps its width. */}
      <Box sx={{ maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <YearTabs currentYear={year} availableYears={years} disabled={pending.size > 0}
          onYearChange={(y) => { setYear(y); setErrorMessage(null); }} />
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small" aria-label={t('operations.freeze.title')} sx={{
            maxWidth: 640,
            '& th': { fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', borderColor: 'kanap.border.default' },
            '& tbody th': { fontSize: 13, fontWeight: 400, color: 'kanap.text.primary', borderColor: 'kanap.border.soft' },
            '& td': { fontSize: 13, fontWeight: 400, color: 'kanap.text.primary', borderColor: 'kanap.border.soft' },
          }}>
            <TableHead><TableRow>
              <TableCell>{t('operations.freeze.column')}</TableCell>
              {NATURES.map((nature) => <TableCell key={nature}>{t(`budget.${nature}`)}</TableCell>)}
              {canModify && <TableCell />}
            </TableRow></TableHead>
            <TableBody>
              {budgetColumns.all.map(({ freezeKey: col, label, enabled }) => {
                const allFrozen = NATURES.every((nature) => isFrozen(nature, col));
                const rowPending = NATURES.some((nature) => pending.has(cellKey(nature, col)));
                return <TableRow key={col}>
                  <TableCell component="th" scope="row">
                    {label}
                    {!enabled && <Typography component="span" sx={{ ml: 1, fontSize: 12, color: 'kanap.text.tertiary' }}>{t('operations.freeze.hidden')}</Typography>}
                  </TableCell>
                  {NATURES.map((nature) => {
                    const frozen = isFrozen(nature, col);
                    const stateLabel = frozen ? t('operations.freeze.frozen') : t('operations.freeze.open');
                    const icon = frozen ? <LockOutlinedIcon /> : <LockOpenOutlinedIcon />;
                    const cellLabel = t('operations.freeze.cell', { column: label, nature: t(`budget.${nature}`) });
                    return <TableCell key={nature}>
                      {!data ? null : canModify ? (
                        <Button
                          size="small" aria-label={cellLabel} aria-pressed={frozen} sx={cellSx(frozen)}
                          startIcon={icon} disabled={!editable || pending.has(cellKey(nature, col))}
                          onClick={() => change(!frozen, [nature], col)}
                        >
                          {stateLabel}
                        </Button>
                      ) : (
                        <Stack direction="row" alignItems="center" spacing={0.5} aria-label={`${cellLabel}: ${stateLabel}`}
                          sx={{ fontSize: 12, fontWeight: frozen ? 500 : 400, color: frozen ? 'kanap.text.primary' : 'kanap.text.tertiary', '& .MuiSvgIcon-root': { fontSize: 14 } }}>
                          {icon}<span>{stateLabel}</span>
                        </Stack>
                      )}
                    </TableCell>;
                  })}
                  {canModify && <TableCell>
                    {data && <Button
                      variant="text" size="small" sx={rowActionSx} disabled={!editable || rowPending}
                      // Only the natures to change: freezing a frozen Budget again would pin the latest FX rates.
                      onClick={() => change(!allFrozen, NATURES.filter((nature) => isFrozen(nature, col) === allFrozen), col)}
                    >
                      {allFrozen ? t('operations.freeze.unfreezeBoth') : t('operations.freeze.freezeBoth')}
                    </Button>}
                  </TableCell>}
                </TableRow>;
              })}
            </TableBody>
          </Table>
        </Box>
      </Box>
    </Box>
  );
}
