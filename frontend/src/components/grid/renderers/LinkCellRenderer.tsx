import React from 'react';
import { Box, Link, Tooltip, Typography } from '@mui/material';
import { ICellRendererParams } from 'ag-grid-community';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { SxProps, Theme } from '@mui/material/styles';

/**
 * Link type for routing
 */
export type LinkType = 'internal' | 'external' | 'auto';

/**
 * Props for the LinkCellRenderer component
 */
export interface LinkCellRendererProps<T = unknown> extends ICellRendererParams<T> {
  /** Type of link (internal uses react-router, external opens in new tab) */
  linkType?: LinkType;
  /** Function to generate href from row data */
  getHref?: (data: T) => string | null | undefined;
  /** Static href prefix (combined with value) */
  hrefPrefix?: string;
  /** Static href suffix (combined with value) */
  hrefSuffix?: string;
  /** Field to use for the link URL (if different from value) */
  hrefField?: string;
  /** Field to use for the display text (if different from value) */
  labelField?: string;
  /** Show external link icon for external links */
  showExternalIcon?: boolean;
  /** Text to show when value is empty */
  emptyText?: string;
  /** Tooltip content (or function to generate it) */
  tooltip?: string | ((data: T, value: unknown) => string);
  /** Callback for internal navigation (use with react-router) */
  onNavigate?: (href: string, data: T) => void;
  /** Max width for text truncation */
  maxWidth?: number | string;
  /** Optional style overrides for the anchor itself */
  linkSx?: SxProps<Theme>;
  /** Content shown right after the link text, inside the cell (a status marker, for example) */
  endAdornment?: React.ReactNode;
  /**
   * Open an internal link in a new browser tab: a plain `<a target="_blank">`, without `onNavigate`
   * and without the external icon, underlined on hover.
   */
  newTab?: boolean;
}

/**
 * Detect if a URL is external
 */
function isExternalUrl(url: string): boolean {
  try {
    const urlObj = new URL(url, window.location.origin);
    return urlObj.origin !== window.location.origin;
  } catch {
    return false;
  }
}

function isPlainLeftClick(event: React.MouseEvent): boolean {
  return (
    event.button === 0
    && !event.metaKey
    && !event.ctrlKey
    && !event.shiftKey
    && !event.altKey
  );
}

function colIsRightAligned(colDef: ICellRendererParams['colDef']): boolean {
  if (!colDef) return false;
  const type = colDef.type;
  if (type === 'rightAligned') return true;
  if (Array.isArray(type) && type.includes('rightAligned')) return true;
  const cellClass = colDef.cellClass;
  if (typeof cellClass === 'string' && cellClass.split(/\s+/).includes('ag-right-aligned-cell')) return true;
  return false;
}

/**
 * Get value from a nested field path
 */
function getFieldValue(data: unknown, fieldPath: string): unknown {
  if (!data || typeof data !== 'object') return undefined;
  const parts = fieldPath.split('.');
  let result: unknown = data;
  for (const part of parts) {
    if (result && typeof result === 'object') {
      result = (result as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return result;
}

/**
 * LinkCellRenderer - Renders clickable links with navigation support
 *
 * Usage in column definition:
 * ```tsx
 * // Internal link
 * {
 *   field: 'name',
 *   headerName: 'Name',
 *   cellRenderer: LinkCellRenderer,
 *   cellRendererParams: {
 *     linkType: 'internal',
 *     getHref: (data) => `/items/${data.id}`,
 *     onNavigate: (href) => navigate(href),
 *   },
 * }
 *
 * // External link
 * {
 *   field: 'website',
 *   headerName: 'Website',
 *   cellRenderer: LinkCellRenderer,
 *   cellRendererParams: {
 *     linkType: 'external',
 *     showExternalIcon: true,
 *   },
 * }
 * ```
 */
export function LinkCellRenderer<T = unknown>(
  props: LinkCellRendererProps<T>
): React.ReactElement | null {
  const {
    value,
    data,
    linkType = 'auto',
    getHref,
    hrefPrefix = '',
    hrefSuffix = '',
    hrefField,
    labelField,
    showExternalIcon = true,
    emptyText = '',
    tooltip,
    onNavigate,
    maxWidth,
    linkSx,
    endAdornment,
    newTab = false,
    valueFormatted,
    colDef,
  } = props;

  const rightAligned = colIsRightAligned(colDef);
  const alignSx = rightAligned
    ? { width: '100%', textAlign: 'right' as const, fontVariantNumeric: 'tabular-nums' as const }
    : undefined;

  // Get display text
  const displayText = labelField && data
    ? String(getFieldValue(data, labelField) ?? '')
    : String(valueFormatted ?? value ?? '');

  if (!displayText && !emptyText) {
    return null;
  }

  if (!displayText) {
    return (
      <Typography variant="body2" color="text.secondary" sx={alignSx}>
        {emptyText}
      </Typography>
    );
  }

  // Get href
  let href: string | null | undefined = null;
  if (getHref && data) {
    href = getHref(data);
  } else if (hrefField && data) {
    const hrefValue = getFieldValue(data, hrefField);
    href = hrefValue ? String(hrefValue) : null;
  } else if (value) {
    href = `${hrefPrefix}${String(value)}${hrefSuffix}`;
  }

  // If no href, render as plain text
  if (!href) {
    return (
      <Typography variant="body2" sx={alignSx}>
        {displayText}
      </Typography>
    );
  }

  // Determine link type
  const isExternal = !newTab && (linkType === 'external' || (linkType === 'auto' && isExternalUrl(href)));
  const opensNewTab = isExternal || newTab;

  // Get tooltip content
  const tooltipContent = typeof tooltip === 'function' && data
    ? tooltip(data, value)
    : tooltip;

  // Handle click
  const handleClick = (e: React.MouseEvent) => {
    if (!isExternal && !newTab && onNavigate && data) {
      if (!isPlainLeftClick(e)) return;
      e.preventDefault();
      onNavigate(href!, data);
    }
  };

  const content = (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: rightAligned ? 'flex-end' : 'flex-start',
        gap: 0.5,
        width: '100%',
        minWidth: 0,
        maxWidth: maxWidth,
      }}
    >
      <Link
        href={href}
        onClick={handleClick}
        target={opensNewTab ? '_blank' : undefined}
        rel={opensNewTab ? 'noopener noreferrer' : undefined}
        underline={isExternal ? 'hover' : 'none'}
        sx={{
          display: 'block',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          textAlign: rightAligned ? 'right' : undefined,
          fontVariantNumeric: rightAligned ? 'tabular-nums' : undefined,
          color: isExternal ? undefined : 'inherit',
          textDecoration: 'none',
          cursor: 'pointer',
          '&:visited': {
            color: isExternal ? undefined : 'inherit',
          },
          '&:hover': {
            color: isExternal ? undefined : 'inherit',
            textDecoration: isExternal ? undefined : 'none',
          },
          // The grid strips text decoration from cell links (`ag-grid-overrides.css`): the
          // underline goes on the text inside the link.
          ...(newTab ? { '&:hover > span, &:focus-visible > span': { textDecoration: 'underline' } } : {}),
          ...linkSx,
        }}
      >
        {newTab ? <span>{displayText}</span> : displayText}
      </Link>
      {isExternal && showExternalIcon && (
        <OpenInNewIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
      )}
      {endAdornment}
    </Box>
  );

  if (typeof tooltipContent === 'string' && tooltipContent) {
    return (
      <Tooltip title={tooltipContent} placement="top">
        {content}
      </Tooltip>
    );
  }

  return content;
}

/**
 * Factory function to create a LinkCellRenderer with preset configurations
 */
export function createLinkCellRenderer<T = unknown>(
  config: Omit<LinkCellRendererProps<T>, keyof ICellRendererParams<T>>
): React.FC<ICellRendererParams<T>> {
  return function ConfiguredLinkCellRenderer(params: ICellRendererParams<T>) {
    return <LinkCellRenderer {...params} {...config} />;
  };
}

/**
 * Pre-configured renderer for external URLs
 */
export const ExternalLinkRenderer = createLinkCellRenderer({
  linkType: 'external',
  showExternalIcon: true,
});

/**
 * Pre-configured renderer for email links
 */
export const EmailLinkRenderer = createLinkCellRenderer({
  linkType: 'external',
  hrefPrefix: 'mailto:',
  showExternalIcon: false,
});

/**
 * Pre-configured renderer for phone links
 */
export const PhoneLinkRenderer = createLinkCellRenderer({
  linkType: 'external',
  hrefPrefix: 'tel:',
  showExternalIcon: false,
});

export default LinkCellRenderer;
