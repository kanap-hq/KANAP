import React, { useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import { Button, IconButton } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { IFloatingFilter, IFloatingFilterParams } from 'ag-grid-community';
import { formatShortDate } from '../lib/dateFormat';
import { useLocale } from '../i18n/useLocale';

type DateCondition = { filterType?: 'date'; type?: string | null; dateFrom?: string | null; dateTo?: string | null };
/** One condition, or two joined by AND or OR (End of validity opened from a report: "blank, or after …"). */
export type DateFilterModel = DateCondition & { operator?: 'AND' | 'OR'; conditions?: DateCondition[] };

type FloatingFilterProps = IFloatingFilterParams<any>;

/** A model date (`2024-12-31 00:00:00`) as the app shows dates: "31 Dec 2024". */
function day(value: string | null | undefined, locale: string): string {
  return value ? formatShortDate(value.slice(0, 10), locale, { year: 'always' }) : '';
}

function conditionText(t: TFunction, condition: DateCondition, locale: string): string {
  const date = day(condition.dateFrom, locale);
  switch (condition.type) {
    case 'blank': return t('filters.date.blank');
    case 'notBlank': return t('filters.date.notBlank');
    case 'equals': return t('filters.date.equals', { date });
    case 'notEqual': return t('filters.date.notEqual', { date });
    case 'lessThan': return t('filters.date.lessThan', { date });
    case 'greaterThan': return t('filters.date.greaterThan', { date });
    case 'inRange': return t('filters.date.inRange', { from: date, to: day(condition.dateTo, locale) });
    default: return date;
  }
}

/**
 * A date filter model in words, every condition of a combined model included: "Blank or after
 * 31 Dec 2024". Empty without a model.
 */
export function dateFilterText(t: TFunction, model: DateFilterModel | null | undefined, locale: string): string {
  if (!model) return '';
  const conditions = model.operator && Array.isArray(model.conditions) ? model.conditions : [model];
  const joiner = model.operator === 'AND' ? t('filters.date.and') : t('filters.date.or');
  const text = conditions.map((condition) => conditionText(t, condition, locale)).filter(Boolean).join(` ${joiner} `);
  return text ? text.charAt(0).toLocaleUpperCase(locale) + text.slice(1) : '';
}

/**
 * The box under a date column header: the filter in words (both conditions of a combined one), a
 * click opens the column's filter to change it, and a clear button removes it in one click, like the
 * set filters' boxes. It writes no model itself: the date filter of the menu does, with date models.
 */
const DateFloatingFilter = React.forwardRef<IFloatingFilter, FloatingFilterProps>((props, ref) => {
  const { t } = useTranslation('common');
  const locale = useLocale();
  const [model, setModel] = useState<DateFilterModel | null>(null);
  const colId = props.column?.getColId?.();
  const columnName = props.column?.getColDef?.().headerName ?? colId ?? '';

  useImperativeHandle(ref, () => ({
    onParentModelChanged(next: DateFilterModel | null) {
      setModel(next ?? null);
    },
  }));

  // The column's model at the start and after every change (set by a link, the menu, Reset columns).
  useEffect(() => {
    const api = props.api;
    if (!api || !colId) return;
    const follow = () => setModel((api.getFilterModel?.() ?? {})[colId] ?? null);
    follow();
    api.addEventListener?.('filterChanged', follow);
    return () => api.removeEventListener?.('filterChanged', follow);
  }, [props.api, colId]);

  const text = useMemo(() => dateFilterText(t, model, locale), [t, model, locale]);

  const handleClear = useCallback((event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const api = props.api;
    if (!api || !colId) return;
    const current = api.getFilterModel?.() ?? {};
    if (!Object.prototype.hasOwnProperty.call(current, colId)) return;
    const next = { ...current };
    delete next[colId];
    api.setFilterModel?.(next);
  }, [props.api, colId]);

  return (
    // A grid whose text track may shrink to nothing: a long filter ("Blank or after 31 Dec 2024") ends
    // in an ellipsis and the clear button stays in the box (a flex row grew to the text's width and
    // pushed it out of the column).
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', alignItems: 'center', gap: 4, width: '100%' }}>
      <Button
        size="small"
        variant="text"
        title={text || undefined}
        aria-label={[t('filters.filterColumn', { column: columnName }).trim(), text].filter(Boolean).join(': ')}
        onClick={() => props.showParentFilter?.()}
        sx={{
          textTransform: 'none',
          minWidth: 0,
          px: 0.5,
          justifyContent: 'flex-start',
          overflow: 'hidden',
          whiteSpace: 'nowrap',
          textOverflow: 'ellipsis',
          display: 'block',
          textAlign: 'left',
          color: text ? undefined : 'kanap.text.tertiary',
        }}
      >
        {text || t('filters.columnPlaceholder')}
      </Button>
      {model && (
        <IconButton
          size="small"
          onClick={handleClear}
          aria-label={t('filters.clearFilter')}
          sx={{ p: 0.25 }}
        >
          <CloseIcon fontSize="inherit" />
        </IconButton>
      )}
    </div>
  );
});

DateFloatingFilter.displayName = 'DateFloatingFilter';

export default DateFloatingFilter;
