import React from 'react';
import { useTranslation } from 'react-i18next';
import ListLinkAnchor from '../reports/ListLinkAnchor';
import { oneOffListLink } from '../reports/reportListLink';
import type { ColumnFilters } from '../reports/reportAggregates';
import { linesUsageText } from './analyticsFields';

/**
 * "Used by 6 lines", a link opening the budget lines list of both natures, every status, filtered
 * on `filters` (exactly those lines), in a new tab; "Not used yet", plain text, without a line.
 */
export default function AnalyticsLinesUsage({
  kind,
  lineCount,
  filters,
}: {
  kind: 'dimension' | 'value';
  lineCount: number;
  /** The list filter keeping the lines counted; null shows the text without a link. */
  filters: ColumnFilters | null;
}) {
  const { t } = useTranslation(['master-data']);
  const text = linesUsageText(t, kind, lineCount);
  if (lineCount <= 0 || !filters) return <>{text}</>;
  return (
    <ListLinkAnchor link={oneOffListLink('all', filters)} sx={{ fontSize: 'inherit' }}>
      {text}
    </ListLinkAnchor>
  );
}
