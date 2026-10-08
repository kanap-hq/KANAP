import React, { useCallback, useMemo } from 'react';
import { MenuItem, TextField } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ReportFilter, reportFilterMenuProps, reportFilterSelectSx } from '../../components/reports/ReportLayout';
import type { AnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import type { AnalyticsAxis } from '../../services/analytics';
import { drawerMenuItemSx } from '../../theme/formSx';
import type { StaffingGroup, StaffingLabels } from './reportAggregates';

/**
 * The "Group by" of the FTE reports (Staffing by month, Cost per FTE): a cost center (default), an
 * item, a supplier or the value on an analytics dimension, kept in the address.
 */

/** `?group=`: `item`, `supplier` or `axis:<dimension id>`; absent (or `costCenter`): by cost center. */
export const GROUP_PARAM = 'group';
const AXIS_PREFIX = 'axis:';

export type GroupKind = StaffingGroup['kind'];
const GROUP_KINDS: readonly GroupKind[] = ['costCenter', 'item', 'supplier', 'axis'];

/** The grouping in a downloaded file's name. */
export const GROUP_FILE_NAME: Record<GroupKind, string> = { costCenter: 'cost-center', item: 'item', supplier: 'supplier', axis: 'dimension' };

export type ReportGroupState = {
  kind: GroupKind;
  axis: AnalyticsAxis | null;
  /** What the request groups on; null while the dimensions load (nothing is asked yet). */
  group: StaffingGroup | null;
  setKind: (kind: GroupKind) => void;
  setAxis: (id: string) => void;
  axes: AnalyticsAxes;
  /** The group as the first column names it ("Cost center", or the dimension's name). */
  header: string;
  /** The group as a sentence names it ("cost center"). */
  inSentence: string;
  /** The rows without a key ("No cost center") and the dimension values without a name. */
  labels: StaffingLabels;
};

/**
 * The grouping in the address. A dimension that is unknown or disabled reads as the default one, and
 * as cost center when no dimension is enabled.
 */
export function useReportGroup(axes: AnalyticsAxes): ReportGroupState {
  const { t } = useTranslation(['ops']);
  const [params, setParams] = useSearchParams();
  const raw = params.get(GROUP_PARAM) ?? '';
  const wantsAxis = raw.startsWith(AXIS_PREFIX);
  const axisId = wantsAxis ? raw.slice(AXIS_PREFIX.length) : null;
  const axis = wantsAxis ? axes.enabled.find((candidate) => candidate.id === axisId) ?? axes.defaultAxis ?? axes.enabled[0] ?? null : null;
  const kind: GroupKind = wantsAxis ? (axis || !axes.ready ? 'axis' : 'costCenter') : raw === 'item' || raw === 'supplier' ? raw : 'costCenter';
  const groupAxisId = kind === 'axis' ? axis?.id ?? null : null;
  const group = useMemo<StaffingGroup | null>(() => {
    if (kind !== 'axis') return { kind };
    return groupAxisId ? { kind: 'axis', axisId: groupAxisId } : null;
  }, [kind, groupAxisId]);

  const write = useCallback((value: string | null) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(GROUP_PARAM, value);
      else next.delete(GROUP_PARAM);
      return next;
    }, { replace: true });
  }, [setParams]);
  const fallbackAxisId = axis?.id ?? axes.defaultAxis?.id ?? axes.enabled[0]?.id ?? null;
  const setKind = useCallback((next: GroupKind) => {
    if (next === 'axis') {
      if (fallbackAxisId) write(`${AXIS_PREFIX}${fallbackAxisId}`);
    } else write(next === 'costCenter' ? null : next);
  }, [write, fallbackAxisId]);
  const setAxis = useCallback((id: string) => write(`${AXIS_PREFIX}${id}`), [write]);

  const header = kind === 'axis' && axis ? axes.label(axis) : t(`reports.staffing.groups.${kind}`);
  const inSentence = kind === 'axis'
    ? axis?.name?.trim() || t('reports.analyticsCategory.defaultDimensionInSentence')
    : t(`reports.staffing.groupsInSentence.${kind}`);
  const labels = useMemo<StaffingLabels>(() => ({
    none: kind === 'item' ? '' : t(`reports.staffing.none.${kind}`),
    unnamed: t('reports.analyticsCategory.unnamed'),
  }), [kind, t]);

  return { kind, axis, group, setKind, setAxis, axes, header, inSentence, labels };
}

/** The "Group by" select and, grouped on a dimension with several enabled, the "Dimension" select. */
export function ReportGroupFilters({ state }: { state: ReportGroupState }) {
  const { t } = useTranslation(['ops']);
  const { kind, axis, axes, setKind, setAxis } = state;
  const kinds = GROUP_KINDS.filter((option) => option !== 'axis' || axes.enabled.length > 0 || kind === 'axis');
  return (
    <>
      <ReportFilter label={t('reports.staffing.groupBy')} width={180}>
        <TextField
          select
          size="small"
          value={kind}
          onChange={(e) => setKind(e.target.value as GroupKind)}
          SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('reports.staffing.groupBy') } }}
          sx={reportFilterSelectSx}
        >
          {kinds.map((option) => (
            <MenuItem key={option} value={option} sx={drawerMenuItemSx}>{t(`reports.staffing.groups.${option}`)}</MenuItem>
          ))}
        </TextField>
      </ReportFilter>
      {kind === 'axis' && axis && axes.enabled.length >= 2 && (
        <ReportFilter label={t('reports.filters.dimension')} width={200}>
          <TextField
            select
            size="small"
            value={axis.id}
            onChange={(e) => setAxis(String(e.target.value))}
            SelectProps={{ MenuProps: reportFilterMenuProps, inputProps: { 'aria-label': t('reports.filters.dimension') } }}
            sx={reportFilterSelectSx}
          >
            {axes.enabled.map((option) => (
              <MenuItem key={option.id} value={option.id} sx={drawerMenuItemSx}>{axes.label(option)}</MenuItem>
            ))}
          </TextField>
        </ReportFilter>
      )}
    </>
  );
}
