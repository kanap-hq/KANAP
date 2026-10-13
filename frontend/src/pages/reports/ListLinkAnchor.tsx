import React from 'react';
import { Link } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReportListLink } from './reportListLink';
import { openSavedListLink } from './ReportGroupLinkCell';

/**
 * A small text link opening a one-off OPEX or CAPEX list (`oneOffListLink`) in a new tab. Filters
 * too long for a URL are saved when the link is used, never before (saves are rate limited).
 */
export default function ListLinkAnchor({
  link,
  children,
  sx,
}: {
  link: ReportListLink;
  children: React.ReactNode;
  /** Replaces the default 12px text size, for a link that is the whole line it sits in. */
  sx?: SxProps<Theme>;
}) {
  const save = link.save;
  return (
    <Link
      href={link.href}
      target="_blank"
      rel="noopener noreferrer"
      sx={[{ fontSize: 12 }, ...(Array.isArray(sx) ? sx : [sx])]}
      onClick={save ? (event) => { event.preventDefault(); void openSavedListLink({ ...link, save }); } : undefined}
    >
      {children}
    </Link>
  );
}
