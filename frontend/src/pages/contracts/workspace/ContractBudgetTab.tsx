import React from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Chip, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { MONO_FONT_FAMILY } from '../../../config/ThemeContext';
import BudgetLinesRelationField, { type LinkedBudgetLine } from '../../../components/finance/BudgetLinesRelationField';
import ContractLineMismatchMark, { type ContractLineMismatch } from '../../../components/finance/ContractLineMismatchMark';
import type { AmountMeasure } from '../../../components/finance/roundPeriod';
import { denseTableFrameSx, denseTableSx } from '../../../components/EntityTasksSection';
import YearTabs from '../../../components/navigation/YearTabs';
import FxMissingNotice, { FxMissingLocalAmount } from '../../../components/finance/FxMissingNotice';
import RelationsSectionTitle from '../../portfolio/components/RelationsSectionTitle';
import { budgetTypeChipSx } from '../../budget/budgetTypeChipSx';
import { formatItemRef } from '../../../utils/item-ref';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { formatAmount } from '../../../i18n/formatters';
import { useLocale } from '../../../i18n/useLocale';
import { formatShortDate } from '../../../lib/dateFormat';
import { compactSelectMenuProps, drawerMenuItemSx, drawerSelectSx, inlineControlSx } from '../../../theme/formSx';
import {
  contractBudgetKey,
  formatSignedAmount,
  offeredBudgetYears,
  useContractBudgetChoice,
  type ContractBudgetCoverage,
  type ContractBudgetLineAmount,
} from '../contractBudget';
import ContractBudgetStateLabel from '../ContractBudgetStateLabel';

export type ContractBudgetLine = LinkedBudgetLine & {
  company_id: string | null;
  company_name: string | null;
  mismatches?: ContractLineMismatch[];
};

export const contractBudgetLinesKey = (contractId: string) => ['contract-budget-lines', contractId] as const;

/** What the commitment hint reads from the contract, and its revision (the figures follow its edits). */
export type ContractBudgetTerms = {
  auto_renewal: boolean;
  disabled_at: string | null;
  current_term_end?: string | null;
  updated_at?: string | null;
};

const sortLines = (lines: ContractBudgetLine[]) => [...lines].sort((a, b) => (a.item_number ?? Infinity) - (b.item_number ?? Infinity));

const amountCellSx = { textAlign: 'right' } as const;
const tertiarySx = { color: 'kanap.text.tertiary' } as const;
/** The totals row of a dense table: the same cells, a firmer rule above, weight 500. */
const totalsRowSx = {
  '& tfoot td': {
    fontSize: 13,
    fontWeight: 500,
    color: 'kanap.text.primary',
    py: '6px',
    px: '12px',
    borderTop: '1px solid',
    borderColor: 'kanap.border.default',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
} as const;

/** An amount, a zero in tertiary (nothing budgeted there). */
function Amount({ value }: { value: number | null | undefined }) {
  if (value == null) return null;
  return value === 0 ? <Box component="span" sx={tertiarySx}>0</Box> : <>{formatAmount(value)}</>;
}

/** A linked line's amount; without a rate that year, its amount in its own currency with the mark. */
function LineAmount({ line, year }: { line: ContractBudgetLineAmount | undefined; year: number }) {
  if (line?.amount == null && line?.fx_missing) {
    return <FxMissingLocalAmount amount={line.fx_missing.amount} currency={line.fx_missing.currency} year={year} />;
  }
  return <Amount value={line?.amount} />;
}

/**
 * The Budget tab of a contract, the part of the contract page: the budget lines it is linked to
 * (both natures), linked and removed with the budget lines picker; each change saves at once.
 * For a reader of the budget, a year and a budget column (kept per user, shared with the list):
 * each line's amount there with their total, and the contract's commitment against its lines for
 * every year (`GET /contracts/:id/budget`). The lines outside a limited person's data access are
 * counted under the list, never named; without the budget right, the tab gives the number of
 * linked lines only, with no picker.
 */
export default function ContractBudgetTab({ contractId, readOnly, onChanged, terms }: {
  contractId: string;
  readOnly: boolean;
  onChanged: () => void;
  terms?: ContractBudgetTerms | null;
}) {
  const { t } = useTranslation(['ops', 'common', 'it']);
  const navigate = useNavigate();
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const canReadBudget = hasLevel('budget', 'reader');
  const choice = useContractBudgetChoice();
  const query = useQuery({
    queryKey: contractBudgetLinesKey(contractId),
    // `hidden`: the linked lines the list leaves out, counted (outside the data access, or all without the budget right).
    queryFn: async ({ signal }) => (await api.get<{ items: ContractBudgetLine[]; hidden?: number }>(`/contracts/${contractId}/budget-lines`, { signal })).data,
    staleTime: 0,
  });
  const coverage = useQuery({
    queryKey: [...contractBudgetKey(contractId, choice.year, choice.column), terms?.updated_at ?? null],
    enabled: canReadBudget,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => (await api.get<ContractBudgetCoverage>(`/contracts/${contractId}/budget`, {
      params: { year: choice.year, column: choice.column },
      signal,
    })).data,
  });
  const [lines, setLines] = React.useState<ContractBudgetLine[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const chainRef = React.useRef<Promise<unknown>>(Promise.resolve());
  const pendingRef = React.useRef(0);

  React.useEffect(() => {
    if (query.data && pendingRef.current === 0) setLines(query.data.items);
  }, [query.data]);

  const shown = lines ?? query.data?.items ?? [];
  const hidden = query.data?.hidden ?? 0;
  // Without the budget right: the number of linked lines only, never their names.
  const outside = !hidden ? null : t(`it:workspace.application.relations.outside.${!canReadBudget ? 'count' : shown.length === 0 ? 'only' : 'and'}`, { count: hidden });

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
        if (pendingRef.current === 0) {
          await queryClient.invalidateQueries({ queryKey: contractBudgetLinesKey(contractId) });
          void queryClient.invalidateQueries({ queryKey: ['contract-budget', contractId] });
        }
      }
    };
    chainRef.current = chainRef.current.then(run, run);
  };

  // Figures of another year or column stay on screen while the chosen ones load, never under their header.
  const figures = coverage.data;
  const sameColumn = figures?.column === choice.column;
  const amountOf = React.useMemo(() => {
    if (!figures || figures.year !== choice.year || !sameColumn) return null;
    return new Map(figures.lines.map((line) => [line.id, line]));
  }, [figures, choice.year, sameColumn]);
  const showAmounts = canReadBudget;
  const amountHeader = t('contracts.budget.amountHeader', { column: choice.columnLabel, year: choice.year });
  // A line without a rate is left out of the total (the notice under the coverage names it).
  const total = amountOf ? shown.reduce((sum, line) => sum + (amountOf.get(line.id)?.amount ?? 0), 0) : null;
  const years = offeredBudgetYears(figures?.years.map((row) => row.year), choice.year);

  const hint = React.useMemo(() => {
    const currency = figures?.reporting_currency ?? '';
    const parts = [t('contracts.budget.coverage.hint', { currency })];
    if (terms?.disabled_at) {
      parts.push(t('contracts.budget.coverage.hintEndOfValidity', { date: formatShortDate(terms.disabled_at.slice(0, 10), locale, { year: 'always' }) }));
    } else if (terms && !terms.auto_renewal && terms.current_term_end) {
      parts.push(t('contracts.budget.coverage.hintEnds', { date: formatShortDate(terms.current_term_end, locale, { year: 'always' }) }));
    } else if (terms?.auto_renewal) {
      parts.push(t('contracts.budget.coverage.hintRenewal'));
    }
    return parts.join(' ');
  }, [figures?.reporting_currency, locale, t, terms]);

  return (
    <Stack spacing={3} sx={{ pt: 1, maxWidth: 880 }}>
      {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
      {canReadBudget && (
        <Box sx={{ display: 'flex', alignItems: 'center', columnGap: 3, rowGap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ flex: '0 0 auto' }}>
            <YearTabs currentYear={choice.year} availableYears={years} onYearChange={choice.setYear} />
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontSize: 13, color: 'kanap.text.secondary' }}>
            {t('contracts.budget.column')}
            <Select
              variant="standard"
              value={choice.column}
              onChange={(event) => choice.setColumn(event.target.value as AmountMeasure)}
              sx={[drawerSelectSx, inlineControlSx, { width: 'auto', minWidth: 110 }]}
              MenuProps={compactSelectMenuProps}
              inputProps={{ 'aria-label': t('contracts.budget.column') }}
            >
              {choice.columns.map((column) => (
                <MenuItem key={column.measure} value={column.measure} sx={drawerMenuItemSx}>{column.label}</MenuItem>
              ))}
            </Select>
          </Box>
        </Box>
      )}
      <Stack spacing={1.25}>
        <RelationsSectionTitle>{t('contracts.budget.title')}</RelationsSectionTitle>
        {query.isFetched && (shown.length === 0 || !canReadBudget) && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{outside ?? t('contracts.budget.empty')}</Typography>
        )}
        {canReadBudget && shown.length > 0 && (
          <Box sx={denseTableFrameSx}>
            <Box component="table" sx={[denseTableSx, totalsRowSx]}>
              <thead>
                <tr>
                  <th>{t('contracts.budget.columns.ref')}</th>
                  <th>{t('contracts.budget.columns.line')}</th>
                  <th>{t('contracts.budget.columns.type')}</th>
                  <th>{t('contracts.budget.columns.company')}</th>
                  {showAmounts && <Box component="th" sx={amountCellSx}>{amountHeader}</Box>}
                </tr>
              </thead>
              <tbody>
                {shown.map((line) => {
                  const reference = line.item_number != null ? formatItemRef('budget', line.item_number) : null;
                  const open = () => navigate(`/ops/budget/${reference ?? line.id}/overview`);
                  return (
                    <tr key={line.id} className="clickable" tabIndex={0} onClick={open} onKeyDown={(event) => { if (event.key === 'Enter') open(); }}>
                      <Box component="td" sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: '12px !important', color: 'kanap.text.tertiary !important' }}>{reference}</Box>
                      <Box component="td" sx={{ maxWidth: 420, overflow: 'hidden', textOverflow: 'ellipsis' }} title={line.product_name}>
                        {line.product_name}
                        {line.mismatches && line.mismatches.length > 0 ? <ContractLineMismatchMark mismatches={line.mismatches} /> : null}
                      </Box>
                      <td><Chip size="small" label={t(`budget.${line.nature}`)} sx={budgetTypeChipSx} /></td>
                      <td>{line.company_name ?? ''}</td>
                      {showAmounts && <Box component="td" sx={amountCellSx}><LineAmount line={amountOf?.get(line.id)} year={choice.year} /></Box>}
                    </tr>
                  );
                })}
              </tbody>
              {showAmounts && (
                <tfoot>
                  <tr>
                    <td colSpan={4}>{t('contracts.budget.total', { count: shown.length })}</td>
                    <Box component="td" sx={amountCellSx}>{total == null ? null : formatAmount(total)}</Box>
                  </tr>
                </tfoot>
              )}
            </Box>
          </Box>
        )}
        {canReadBudget && shown.length > 0 && outside && (
          <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>{outside}</Typography>
        )}
      </Stack>
      {canReadBudget && (
        <Stack spacing={1}>
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{t('contracts.budget.pickerLabel')}</Typography>
          <Box sx={{ maxWidth: 640 }}>
            <BudgetLinesRelationField
              value={shown}
              onChange={(next) => save(next)}
              disabled={readOnly || !query.isFetched}
              contractId={contractId}
            />
          </Box>
        </Stack>
      )}
      {canReadBudget && figures && sameColumn && (
        <Stack spacing={1.25}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, flexWrap: 'wrap' }}>
            <RelationsSectionTitle>{t('contracts.budget.coverage.title')}</RelationsSectionTitle>
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
              {t('contracts.budget.coverage.subtitle', { column: choice.columnLabel, currency: figures.reporting_currency })}
            </Typography>
          </Box>
          <Box sx={denseTableFrameSx}>
            <Box component="table" sx={denseTableSx}>
              <thead>
                <tr>
                  <th>{t('contracts.budget.coverage.columns.year')}</th>
                  <Box component="th" sx={amountCellSx}>{t('contracts.budget.coverage.columns.committed')}</Box>
                  <Box component="th" sx={amountCellSx}>{t('contracts.budget.coverage.columns.linked')}</Box>
                  <Box component="th" sx={amountCellSx}>{t('contracts.budget.coverage.columns.gap')}</Box>
                  <th>{t('contracts.budget.coverage.columns.state')}</th>
                </tr>
              </thead>
              <tbody>
                {figures.years.map((row) => {
                  const selected = row.year === choice.year;
                  const select = () => choice.setYear(row.year);
                  return (
                    <Box
                      component="tr"
                      key={row.year}
                      className="clickable"
                      tabIndex={0}
                      aria-selected={selected}
                      onClick={select}
                      onKeyDown={(event: React.KeyboardEvent) => { if (event.key === 'Enter') select(); }}
                      sx={selected ? { '& td': { bgcolor: 'kanap.bg.hover' } } : undefined}
                    >
                      <Box component="td" sx={{ fontWeight: selected ? 500 : 400 }}>{row.year}</Box>
                      <Box component="td" sx={amountCellSx}>
                        {row.committed == null
                          ? <Box component="span" sx={tertiarySx}>{t('contracts.budget.noRate', { currency: figures.currency })}</Box>
                          : <Amount value={row.committed} />}
                      </Box>
                      <Box component="td" sx={amountCellSx}><Amount value={row.linked} /></Box>
                      <Box component="td" sx={amountCellSx}>{row.gap == null ? null : formatSignedAmount(row.gap)}</Box>
                      <td>
                        {row.linked_fx_missing && row.committed != null && row.state == null
                          ? <Box component="span" sx={[tertiarySx, { fontSize: 13 }]}>{t('contracts.budget.unknownFx')}</Box>
                          : <ContractBudgetStateLabel state={row.state} />}
                      </td>
                    </Box>
                  );
                })}
              </tbody>
            </Box>
          </Box>
          <FxMissingNotice items={figures.lines_fx_missing} />
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{hint}</Typography>
        </Stack>
      )}
    </Stack>
  );
}
