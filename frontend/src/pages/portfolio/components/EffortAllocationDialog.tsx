import React from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

export interface EligibleUser {
  user_id: string;
  email: string;
  first_name: string;
  last_name: string;
  is_lead: boolean;
  allocation_pct?: number;
}

interface EffortAllocationDialogProps {
  open: boolean;
  onClose: () => void;
  projectId: string;
  effortType: 'it' | 'business';
  eligibleUsers: EligibleUser[];
  estimatedEffort: number;
  onSuccess: () => void;
}

export default function EffortAllocationDialog({
  open,
  onClose,
  projectId,
  effortType,
  eligibleUsers,
  estimatedEffort,
  onSuccess,
}: EffortAllocationDialogProps) {
  const { t } = useTranslation(['portfolio', 'common', 'errors']);
  const [allocations, setAllocations] = React.useState<Record<string, number>>({});
  const [pinnedUserIds, setPinnedUserIds] = React.useState<Set<string>>(() => new Set());
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const initialAllocationsRef = React.useRef<Record<string, number>>({});
  const effortTypeLabel = t(`portfolio:dialogs.effortAllocation.effortTypes.${effortType}`);

  // Sort users: lead first, then alphabetically
  const sortedUsers = React.useMemo(() => {
    return [...eligibleUsers].sort((a, b) => {
      if (a.is_lead && !b.is_lead) return -1;
      if (!a.is_lead && b.is_lead) return 1;
      const nameA = `${a.first_name} ${a.last_name}`.toLowerCase();
      const nameB = `${b.first_name} ${b.last_name}`.toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [eligibleUsers]);

  // Initialize allocations when dialog opens
  React.useEffect(() => {
    if (open) {
      const initial: Record<string, number> = {};
      for (const user of eligibleUsers) {
        initial[user.user_id] = user.allocation_pct ?? 0;
      }
      initialAllocationsRef.current = initial;
      setAllocations(initial);
      setPinnedUserIds(new Set());
      setError(null);
    }
  }, [open, eligibleUsers]);

  const total = Object.values(allocations).reduce((sum, v) => sum + (v || 0), 0);
  const isValid = total === 100;
  const hasPinnedRows = pinnedUserIds.size > 0;

  const distributeEvenly = React.useCallback((userIds: string[], totalPct: number): Record<string, number> => {
    if (userIds.length === 0) return {};
    const base = Math.floor(totalPct / userIds.length);
    const remainder = totalPct - base * userIds.length;
    return Object.fromEntries(userIds.map((id, index) => [id, base + (index < remainder ? 1 : 0)]));
  }, []);

  const distributeByCurrentWeights = React.useCallback((
    userIds: string[],
    totalPct: number,
    weights: Record<string, number>,
  ): Record<string, number> => {
    if (userIds.length === 0) return {};
    const weightTotal = userIds.reduce((sum, id) => sum + Math.max(0, weights[id] || 0), 0);
    if (weightTotal <= 0) return distributeEvenly(userIds, totalPct);

    const rows = userIds.map((id) => {
      const exact = (Math.max(0, weights[id] || 0) / weightTotal) * totalPct;
      return {
        id,
        value: Math.floor(exact),
        remainder: exact - Math.floor(exact),
      };
    });
    let remainder = totalPct - rows.reduce((sum, row) => sum + row.value, 0);
    rows
      .sort((a, b) => b.remainder - a.remainder || a.id.localeCompare(b.id))
      .forEach((row) => {
        if (remainder <= 0) return;
        row.value += 1;
        remainder -= 1;
      });
    return Object.fromEntries(rows.map((row) => [row.id, row.value]));
  }, [distributeEvenly]);

  const redistributeWithPins = React.useCallback((
    nextAllocations: Record<string, number>,
    nextPinnedUserIds: Set<string>,
    redistributionWeights: Record<string, number>,
  ): Record<string, number> => {
    const userIds = sortedUsers.map((user) => user.user_id);
    const pinnedTotal = userIds
      .filter((id) => nextPinnedUserIds.has(id))
      .reduce((sum, id) => sum + (nextAllocations[id] || 0), 0);

    if (pinnedTotal > 100) {
      setError(t('portfolio:dialogs.effortAllocation.validation.pinnedTotalExceeded'));
      return nextAllocations;
    }

    const flexibleUserIds = userIds.filter((id) => !nextPinnedUserIds.has(id));
    const flexibleAllocations = distributeByCurrentWeights(
      flexibleUserIds,
      100 - pinnedTotal,
      redistributionWeights,
    );
    setError(null);
    return {
      ...nextAllocations,
      ...flexibleAllocations,
    };
  }, [distributeByCurrentWeights, sortedUsers, t]);

  const handleChange = (userId: string, value: string) => {
    const numValue = value === '' ? 0 : parseInt(value, 10);
    if (isNaN(numValue) || numValue < 0 || numValue > 100) return;
    const nextPinnedUserIds = new Set(pinnedUserIds);
    nextPinnedUserIds.add(userId);
    setAllocations(redistributeWithPins(
      { ...allocations, [userId]: numValue },
      nextPinnedUserIds,
      allocations,
    ));
    setPinnedUserIds(nextPinnedUserIds);
  };

  const handleClearPins = () => {
    setPinnedUserIds(new Set());
    setAllocations(initialAllocationsRef.current);
    setError(null);
  };

  const handleSplitEqually = () => {
    setPinnedUserIds(new Set());
    setAllocations(distributeEvenly(sortedUsers.map((user) => user.user_id), 100));
    setError(null);
  };

  const handleSubmit = async () => {
    if (!isValid) {
      setError(t('portfolio:dialogs.effortAllocation.validation.totalMustEqual100'));
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const allocationsList = Object.entries(allocations)
        .filter(([, pct]) => pct > 0)
        .map(([user_id, allocation_pct]) => ({ user_id, allocation_pct }));

      await api.post(`/portfolio/projects/${projectId}/effort-allocations/${effortType}`, {
        allocations: allocationsList,
      });

      onSuccess();
      onClose();
    } catch (e: any) {
      setError(getApiErrorMessage(
        e,
        t,
        t('portfolio:dialogs.effortAllocation.messages.saveFailed'),
      ));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (!saving) {
      onClose();
    }
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        {t(`portfolio:dialogs.effortAllocation.title.${effortType}`)}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <Typography variant="body2" color="text.secondary">
            {t('portfolio:dialogs.effortAllocation.description')}
          </Typography>

          {sortedUsers.length > 0 && (
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', sm: 'center' }}
              spacing={1}
            >
              <Stack direction="row" spacing={1}>
                <Button size="small" onClick={handleSplitEqually}>
                  {t('portfolio:dialogs.effortAllocation.actions.splitEqually')}
                </Button>
                <Button size="small" onClick={handleClearPins} disabled={!hasPinnedRows}>
                  {t('portfolio:dialogs.effortAllocation.actions.clearManualPins')}
                </Button>
              </Stack>
              <Typography variant="caption" color="text.secondary">
                {t('portfolio:dialogs.effortAllocation.helper.autoRedistribution')}
              </Typography>
            </Stack>
          )}

          {sortedUsers.length === 0 ? (
            <Alert severity="info">
              {t('portfolio:dialogs.effortAllocation.messages.noEligibleUsers', {
                effortType: effortTypeLabel,
              })}
            </Alert>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 500 }}>
                    {t('portfolio:dialogs.effortAllocation.table.contributor')}
                  </TableCell>
                  <TableCell align="right" sx={{ fontWeight: 500, width: 100 }}>%</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 500, width: 80 }}>MD</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {sortedUsers.map((user) => {
                  const pct = allocations[user.user_id] || 0;
                  const md = estimatedEffort > 0
                    ? Math.round((pct / 100) * estimatedEffort * 10) / 10
                    : 0;
                  const displayName = `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email;

                  return (
                    <TableRow key={user.user_id}>
                      <TableCell>
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Typography variant="body2">{displayName}</Typography>
                          {user.is_lead && (
                            <Typography variant="body2" color="text.secondary">
                              {t('portfolio:dialogs.effortAllocation.chips.lead')}
                            </Typography>
                          )}
                          {pinnedUserIds.has(user.user_id) && (
                            <Typography variant="body2" color="text.secondary">
                              {t('portfolio:dialogs.effortAllocation.chips.manual')}
                            </Typography>
                          )}
                        </Stack>
                      </TableCell>
                      <TableCell align="right">
                        <TextField
                          type="number"
                          size="small"
                          value={pct}
                          onChange={(e) => handleChange(user.user_id, e.target.value)}
                          inputProps={{ min: 0, max: 100, step: 1, style: { textAlign: 'right' } }}
                          sx={{ width: 80 }}
                        />
                      </TableCell>
                      <TableCell align="right">
                        <Typography variant="body2" color="text.secondary">{md}</Typography>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          <Stack direction="row" justifyContent="flex-end" alignItems="center" spacing={2}>
            <Typography
              variant="body1"
              sx={{
                fontWeight: 500,
                color: isValid ? 'success.main' : 'error.main',
              }}
            >
              {t('portfolio:dialogs.effortAllocation.total', { total })}
            </Typography>
            {!isValid && (
              <Typography variant="caption" color="error.main">
                {t('portfolio:dialogs.effortAllocation.validation.totalDisplay')}
              </Typography>
            )}
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={handleClose} disabled={saving}>
          {t('common:buttons.cancel')}
        </Button>
        <Button
          variant="action-primary"
          onClick={handleSubmit}
          disabled={saving || !isValid || sortedUsers.length === 0}
        >
          {saving ? t('common:status.saving') : t('common:buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
