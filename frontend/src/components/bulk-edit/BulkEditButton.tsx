import React from 'react';
import { Badge, Box, Button, Tooltip } from '@mui/material';
import EditNoteOutlined from '@mui/icons-material/EditNoteOutlined';
import { useTranslation } from 'react-i18next';

/** The count on the icon, as on the delete of the selection (`DeleteSelectedButton`), in neutral colours. */
const badgeSx = {
  '& .MuiBadge-badge': {
    bgcolor: 'kanap.text.secondary',
    color: 'kanap.bg.primary',
    fontSize: 9,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    height: 14,
    minWidth: 14,
    lineHeight: '14px',
    padding: '0 3px',
    top: 1,
    right: -2,
  },
};

/**
 * "Change the selection" in a list's action bar, drawn as the delete of the selection: the icon with
 * the rows chosen on a small badge, tooltip and accessible name "Change the selection (n)", disabled
 * at 0.
 */
export default function BulkEditButton({ count, onClick, disabled = false }: { count: number; onClick: () => void; disabled?: boolean }) {
  const { t } = useTranslation('common');
  const name = `${t('bulkEdit.title')} (${count})`;
  return (
    <Tooltip title={name} describeChild>
      {/* A disabled button fires no events: the wrapper keeps the tooltip working. */}
      <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
        <Button variant="action" aria-label={name} onClick={onClick} disabled={disabled || count === 0} sx={{ px: '11px' }}>
          <Badge badgeContent={count} max={9999} showZero slotProps={{ badge: { 'aria-hidden': true } }} sx={badgeSx}>
            <EditNoteOutlined sx={{ fontSize: '16px !important' }} />
          </Badge>
        </Button>
      </Box>
    </Tooltip>
  );
}
