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
 * Opens a link whose filters are too long for a URL: a new tab at once (still inside the click, so no
 * popup blocker stops it), cut from this page (`opener`), then sent to the short `ctx` address once
 * the filters are saved; to the inline address when the save fails. Returns the save, for `refresh`.
 */
export function openSavedListLink(link: ReportListLink & { save: NonNullable<ReportListLink['save']> }): Promise<unknown> {
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  return link.save().then(
    (href) => { if (tab) tab.location.href = href; },
    () => { if (tab) tab.location.href = link.href; },
  );
}

/**
 * The group name of a report row, opening its link in a new tab. Short filters are a plain link. Long
 * ones are saved only when the link is used (click, middle click, Enter): saves are rate limited, so
 * never on hover. Until then the href carries them inline, so copying the link still works.
 */
export default function ReportGroupLinkCell(props: ICellRendererParams & ReportGroupLinkParams) {
  const { getLink, ...cell } = props;
  const link = props.data ? getLink(props.data) : null;
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const save = link?.save;
  // Enter on a link dispatches a click: the click handler covers the keyboard too.
  const activate = save && link
    ? (event: React.MouseEvent) => {
      if (event.type === 'auxclick' && event.button !== 1) return;
      if (!(event.target as HTMLElement | null)?.closest?.('a')) return;
      event.preventDefault();
      openSavedListLink({ ...link, save }).finally(refresh);
    }
    : undefined;
  return (
    <Box
      component="span"
      sx={{ display: 'flex', alignItems: 'center', width: '100%', minWidth: 0, height: '100%' }}
      onClick={activate}
      onAuxClick={activate}
    >
      <LinkCellRenderer {...cell} newTab getHref={() => link?.href ?? null} />
    </Box>
  );
}
