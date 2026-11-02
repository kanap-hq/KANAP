import React from 'react';
import { Box, Typography } from '@mui/material';
import TableIcon from '@mui/icons-material/TableChartOutlined';

/** Bytes as the chat shows them: "840 B", "12 KB", "1.4 MB". */
export function formatAttachmentSize(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size >= 1024 * 1024) return `${Math.round((size / (1024 * 1024)) * 10) / 10} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

type AttachmentFileChipProps = {
  name: string;
  size: number;
  /** Matches the image thumbnails of the row it sits in. */
  height?: number;
  /** A control laid over the chip (the composer's remove button). */
  children?: React.ReactNode;
};

/** A spreadsheet attached to a Plaid message: icon, file name and size. */
export default function AttachmentFileChip({ name, size, height = 56, children }: AttachmentFileChipProps) {
  return (
    <Box
      title={name}
      sx={(theme) => ({
        position: 'relative',
        height,
        maxWidth: 220,
        minWidth: 140,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        pl: 1.25,
        pr: children ? 3 : 1.25,
        borderRadius: '8px',
        border: `1px solid ${theme.palette.kanap.border.default}`,
        bgcolor: theme.palette.kanap.bg.composer,
      })}
    >
      <TableIcon sx={{ fontSize: 20, color: 'kanap.text.tertiary', flexShrink: 0 }} />
      <Box sx={{ minWidth: 0 }}>
        <Typography
          sx={{ fontSize: 13, fontWeight: 500, color: 'kanap.text.primary', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {name}
        </Typography>
        <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{formatAttachmentSize(size)}</Typography>
      </Box>
      {children}
    </Box>
  );
}
