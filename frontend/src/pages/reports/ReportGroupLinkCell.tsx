import React, { useReducer } from 'react';
import { Box } from '@mui/material';
import type { ICellRendererParams } from 'ag-grid-community';
import { LinkCellRenderer } from '../../components/grid/renderers';
import type { ReportListLink } from './reportListLink';

export type ReportGroupLinkParams = {
  /** The row's link (an item page, or the filtered list), null for a row that stays plain text (totals). */
  getLink: (row: any) => ReportListLink | null;
};

/**
 * The group name of a report row, opening its link in a new tab. Filters too long for a URL are
 * saved when the pointer or the focus reaches the link, so it opens on a short `ctx` address.
 */
export default function ReportGroupLinkCell(props: ICellRendererParams & ReportGroupLinkParams) {
  const { getLink, ...cell } = props;
  const link = props.data ? getLink(props.data) : null;
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const prepare = link?.save ? () => { link.save!().then(refresh, () => undefined); } : undefined;
  return (
    <Box
      component="span"
      sx={{ display: 'flex', alignItems: 'center', width: '100%', minWidth: 0, height: '100%' }}
      onMouseEnter={prepare}
      onFocus={prepare}
    >
      <LinkCellRenderer {...cell} newTab getHref={() => link?.href ?? null} />
    </Box>
  );
}
