import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Chip, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import BudgetLinesRelationField, { type LinkedBudgetLine } from '../../../components/finance/BudgetLinesRelationField';
import { denseTableFrameSx, denseTableSx } from '../../../components/EntityTasksSection';
import RelationsSectionTitle from '../../portfolio/components/RelationsSectionTitle';
import { budgetTypeChipSx } from '../../budget/budgetTypeChipSx';
import { formatItemRef } from '../../../utils/item-ref';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';

export type ContractBudgetLine = LinkedBudgetLine & { company_id: string | null; company_name: string | null };

export const contractBudgetLinesKey = (contractId: string) => ['contract-budget-lines', contractId] as const;

const sortLines = (lines: ContractBudgetLine[]) => [...lines].sort((a, b) => (a.item_number ?? Infinity) - (b.item_number ?? Infinity));

/**
 * The Budget tab of a contract, the part of the contract page: the budget lines it is linked to
 * (both natures), linked and removed with the budget lines picker. Each change saves at once.
 */
export default function ContractBudgetTab({ contractId, readOnly, onChanged }: { contractId: string; readOnly: boolean; onChanged: () => void }) {
  const { t } = useTranslation(['ops', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: contractBudgetLinesKey(contractId),
    queryFn: async ({ signal }) => (await api.get<{ items: ContractBudgetLine[] }>(`/contracts/${contractId}/budget-lines`, { signal })).data.items,
    staleTime: 0,
  });
  const [lines, setLines] = React.useState<ContractBudgetLine[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const chainRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = React.useRef(0);

  React.useEffect(() => {
    if (query.data && pendingRef.current === 0) setLines(query.data);
  }, [query.data]);

  const shown = lines ?? query.data ?? [];

  const save = (next: LinkedBudgetLine[]) => {
    const known = new Map(shown.map((line) => [line.id, line]));
    setLines(sortLines(next.map((line) => known.get(line.id) ?? { ...line, company_id: null, company_name: null })));
    setError(null);
    pendingRef.current += 1;
    const run = async () => {
      try {
        await api.post(`/contracts/${contractId}/budget-lines/bulk-replace`, { budget_line_ids: next.map((line) => line.id) });
        onChanged();
        // The lines' own Relations tabs read their contracts again.
        void queryClient.invalidateQueries({ queryKey: ['item-relations'] });
      } catch (e) {
        setError(getApiErrorMessage(e, t, t('contracts.messages.saveFailed')));
      } finally {
        pendingRef.current -= 1;
        if (pendingRef.current === 0) await queryClient.invalidateQueries({ queryKey: contractBudgetLinesKey(contractId) });
      }
    };
    chainRef.current = chainRef.current.then(run, run);
  };

  return (
    <Stack spacing={3} sx={{ pt: 1, maxWidth: 880 }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      <Stack spacing={1.25}>
        <RelationsSectionTitle>{t('contracts.budget.title')}</RelationsSectionTitle>
        {query.isFetched && shown.length === 0 && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{t('contracts.budget.empty')}</Typography>
        )}
        {shown.length > 0 && (
          <Box sx={denseTableFrameSx}>
            <Box component="table" sx={denseTableSx}>
              <thead>
                <tr>
                  <th>{t('contracts.budget.columns.ref')}</th>
                  <th>{t('contracts.budget.columns.line')}</th>
                  <th>{t('contracts.budget.columns.type')}</th>
                  <th>{t('contracts.budget.columns.company')}</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((line) => {
                  const reference = line.item_number != null ? formatItemRef('budget', line.item_number) : null;
                  const open = () => navigate(`/ops/budget/${reference ?? line.id}/overview`);
                  return (
                    <tr key={line.id} className="clickable" tabIndex={0} onClick={open} onKeyDown={(event) => { if (event.key === 'Enter') open(); }}>
                      <Box component="td" sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: '12px !important', color: 'kanap.text.tertiary !important' }}>{reference}</Box>
                      <Box component="td" sx={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }} title={line.product_name}>{line.product_name}</Box>
                      <td><Chip size="small" label={t(`budget.${line.nature}`)} sx={budgetTypeChipSx} /></td>
                      <td>{line.company_name ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Box>
          </Box>
        )}
      </Stack>
      <Stack spacing={1}>
        <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{t('contracts.budget.pickerLabel')}</Typography>
        <Box sx={{ maxWidth: 640 }}>
          <BudgetLinesRelationField
            value={shown}
            onChange={(next) => save(next)}
            disabled={readOnly || !query.isFetched}
          />
        </Box>
      </Stack>
    </Stack>
  );
}
