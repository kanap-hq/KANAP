import React from 'react';
import type { ICellRendererParams } from 'ag-grid-community';
import { LinkCellRenderer } from '../../components/grid/renderers';
import { itemHref } from '../reports/useReportScope';

/** The page of a budget line: `/ops/budget/BL-n` when its number is known, its id otherwise. */
export function operationLineHref(row: { id?: string | null; itemNumber?: number | null } | null | undefined): string | null {
  return row ? itemHref('all', row.id, row.itemNumber) : null;
}

/**
 * The name of a budget line in an operation's table: a link to the line's page in a new tab, so the
 * preview stays where it is, then `notes` (what the operation says about the line).
 */
export default function OperationLineCell(props: ICellRendererParams & { notes?: React.ReactNode }) {
  const { notes, ...cell } = props;
  return <LinkCellRenderer {...cell} newTab getHref={operationLineHref} endAdornment={notes} />;
}
