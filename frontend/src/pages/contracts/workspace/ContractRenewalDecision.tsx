import React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Button, Stack, TextField, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { StatusDot } from '../../../components/design';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import { neutralLinkSx } from '../../../theme/formSx';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { formatItemRef } from '../../../utils/item-ref';
import { getDotColor } from '../../../utils/statusColors';
import { renewalQueryKey, useContractRenewal, type ContractRenewal, type RenewalAction } from '../contractRenewal';
import ContractEndChoice, { isValidEnd } from './ContractEndChoice';

export { renewalQueryKey, useContractRenewal, confirmedRenewalOf, type ContractRenewal } from '../contractRenewal';

/**
 * The renewal decision box of a contract's overview (plan contracts-revamp §7): shown while a
 * decision is awaited (the cancellation deadline within the tenant's window) and, once one is
 * taken, as one line until the term ends. Orange marks the decision awaited only.
 */
export default function ContractRenewalDecision({
  contractId,
  startDate,
  canDecide,
  onDecided,
}: {
  contractId: string;
  /** The contract's start: no end may be chosen before it. */
  startDate?: string | null;
  canDecide: boolean;
  /** After an action: the contract, its tasks and its terms may have changed. */
  onDecided: () => void;
}) {
  const { t } = useTranslation(['ops', 'common']);
  const theme = useTheme();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const [reason, setReason] = React.useState('');
  const [confirmTerminate, setConfirmTerminate] = React.useState(false);
  /** The end of a termination, the proposed one at first (lot CR2, round 1). */
  const [endDate, setEndDate] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const { data } = useContractRenewal(contractId);

  const date = (ymd: string | null | undefined) => formatShortDate(ymd, locale, { year: 'always' });

  const act = async (action: RenewalAction) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = { reason: reason.trim() || null, ...(action === 'terminate' ? { end_date: endDate } : {}) };
      const res = await api.post<ContractRenewal>(`/contracts/${contractId}/renewal/${action}`, body);
      queryClient.setQueryData(renewalQueryKey(contractId), res.data);
      setReason('');
      setConfirmTerminate(false);
      onDecided();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('contracts.renewal.failed')));
      void queryClient.invalidateQueries({ queryKey: renewalQueryKey(contractId) });
    } finally {
      setBusy(false);
    }
  };

  if (!data || data.state === 'none' || !data.term) return null;
  const { term, task } = data;
  const taskRef = task?.item_number ? formatItemRef('task', task.item_number) : null;
  const taskLink = taskRef ? (
    <Box
      component={RouterLink}
      to={`/portfolio/tasks/${taskRef}/overview`}
      sx={{ fontFamily: MONO_FONT_FAMILY, color: 'inherit', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
    >
      {taskRef}
    </Box>
  ) : null;

  if (data.state === 'decided' && data.decision) {
    const { decision } = data;
    const terminated = decision.decision === 'terminate';
    const decidedAt = date(decision.decided_at.slice(0, 10));
    const who = decision.decided_by_name
      ? t(terminated ? 'contracts.renewal.terminatedBy' : 'contracts.renewal.renewedBy', { date: decidedAt, name: decision.decided_by_name })
      : t(terminated ? 'contracts.renewal.terminatedOn' : 'contracts.renewal.renewedOn', { date: decidedAt });
    const effect = terminated
      ? t('contracts.renewal.endsOn', { date: date(decision.end_date ?? term.term_end) })
      : t('contracts.renewal.renewsOn', { date: date(term.renews_on) });
    return (
      <Box data-testid="contract-renewal-decision" sx={{ ...boxSx, borderColor: 'kanap.border.default', bgcolor: 'kanap.bg.drawer' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px', fontSize: 13, color: 'kanap.text.primary' }}>
          <StatusDot size={8} color={getDotColor(terminated ? 'default' : 'success', theme.palette.mode)} />
          <span>{who} {effect}</span>
          {taskLink && <Box component="span" sx={{ color: 'kanap.text.secondary' }}>· {t('contracts.renewal.task')} {taskLink}</Box>}
        </Box>
        {decision.reason && (
          <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary', whiteSpace: 'pre-wrap' }}>
            {t('contracts.renewal.reasonShown', { reason: decision.reason })}
          </Typography>
        )}
        {terminated && data.can_undo && (
          <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>{t('contracts.renewal.noticeHint', { date: date(term.deadline) })}</Typography>
        )}
        {error && <Alert severity="error">{error}</Alert>}
        {canDecide && data.can_undo && (
          <Box>
            <Box component="button" type="button" disabled={busy} onClick={() => void act('undo')} sx={{ ...neutralLinkSx(false), fontSize: 13 }}>
              {t('contracts.renewal.undo')}
            </Box>
          </Box>
        )}
      </Box>
    );
  }

  const inDays = term.days_left === 0
    ? t('contracts.deadlines.today')
    : t('contracts.deadlines.inDays', { count: term.days_left });
  const owner = task?.assignee_name;
  const proposed = data.proposed_end_date ?? term.term_end;

  return (
    <Box data-testid="contract-renewal-decision" sx={{ ...boxSx, borderColor: 'kanap.orange', bgcolor: 'kanap.bg.primary' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', columnGap: '10px', rowGap: '2px' }}>
        <Typography component="h3" sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', m: 0 }}>
          {data.renegotiating ? t('contracts.renewal.renegotiating') : t('contracts.renewal.title')}
        </Typography>
        <Box component="span" sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>
          {t('contracts.renewal.dueBefore', { date: date(term.deadline) })} · {inDays}
          {taskLink && (
            <>
              {' · '}{t('contracts.renewal.task')} {taskLink}{owner ? ` ${t('contracts.renewal.taskFor', { name: owner })}` : ''}
            </>
          )}
        </Box>
      </Box>
      <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary', maxWidth: '72ch' }}>
        {data.renegotiating
          ? t('contracts.renewal.renegotiatingHint')
          : t('contracts.renewal.withoutDecision', { count: data.duration_months, date: date(term.renews_on) })}
      </Typography>
      {canDecide && (
        <TextField
          variant="standard"
          multiline
          minRows={2}
          maxRows={6}
          fullWidth
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('contracts.renewal.reasonPlaceholder')}
          inputProps={{ 'aria-label': t('contracts.renewal.reasonLabel'), maxLength: 2000 }}
        />
      )}
      {canDecide && confirmTerminate && (
        <ContractEndChoice
          contractId={contractId}
          startDate={startDate}
          proposed={proposed}
          noticeMonths={data.notice_period_months}
          value={endDate}
          onChange={setEndDate}
          proposedImpact={data.impact}
          disabled={busy}
        />
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {canDecide && (
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
          {confirmTerminate ? (
            <>
              <Button variant="action-danger" disabled={busy || !isValidEnd(endDate, startDate)} onClick={() => void act('terminate')}>{t('contracts.renewal.confirmTerminate')}</Button>
              <Button variant="action" disabled={busy} onClick={() => setConfirmTerminate(false)}>{t('common:buttons.cancel')}</Button>
            </>
          ) : (
            <>
              <Button variant="action" disabled={busy} onClick={() => void act('renew')}>{t('contracts.renewal.renew')}</Button>
              {!data.renegotiating && (
                <Button variant="action" disabled={busy} onClick={() => void act('renegotiate')}>{t('contracts.renewal.renegotiate')}</Button>
              )}
              <Button variant="action" disabled={busy} onClick={() => { setEndDate(proposed); setConfirmTerminate(true); }}>{t('contracts.renewal.terminate')}</Button>
            </>
          )}
        </Stack>
      )}
    </Box>
  );
}

const boxSx = {
  border: '1px solid',
  borderRadius: '8px',
  px: '14px',
  py: '12px',
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
} as const;
