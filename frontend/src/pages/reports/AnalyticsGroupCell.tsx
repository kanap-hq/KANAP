import React from 'react';
import { Box } from '@mui/material';
import type { ICellRendererParams } from 'ag-grid-community';
import ReportGroupLinkCell, { type ReportGroupLinkParams } from './ReportGroupLinkCell';

export type AnalyticsGroupCellParams = ICellRendererParams & ReportGroupLinkParams;

/**
 * The group column of the analytics table: a value keeps its link to the filtered list; a line of
 * the detail (row `level` 1) is indented under its value and stays plain text, its reference being
 * the link. The print view renders this same component, so paper keeps the indentation.
 */
export default function AnalyticsGroupCell(props: AnalyticsGroupCellParams) {
  if (Number(props.data?.level ?? 0) > 0) {
    return (
      <Box
        component="span"
        sx={{ display: 'block', pl: 3, color: 'kanap.text.secondary', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {props.value ?? ''}
      </Box>
    );
  }
  const { getLink, ...cell } = props;
  return <ReportGroupLinkCell {...cell} getLink={getLink} />;
}
