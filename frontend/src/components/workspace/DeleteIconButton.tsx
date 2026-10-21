import { Box, Button, Tooltip } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';

type DeleteIconButtonProps = {
  onClick: () => void;
  disabled?: boolean;
};

/**
 * The Delete action of a workspace title row: an icon-only danger pill (the trash) with the
 * "Delete" tooltip and accessible name, the same size as the other actions of the row. The caller
 * keeps the rights check, the confirmation and what happens after the delete.
 */
export default function DeleteIconButton({ onClick, disabled = false }: DeleteIconButtonProps) {
  const { t } = useTranslation();
  const label = t('common:buttons.delete');
  return (
    <Tooltip title={label} describeChild>
      {/* A disabled button fires no events: the wrapper keeps the tooltip working. */}
      <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
        <Button
          variant="action-danger"
          aria-label={label}
          onClick={onClick}
          disabled={disabled}
          sx={{ px: '8px' }}
        >
          <DeleteIcon sx={{ fontSize: '16px !important' }} />
        </Button>
      </Box>
    </Tooltip>
  );
}
